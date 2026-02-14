/**
 * Action Step Executor
 * Executes on-chain actions using the wallet executor when provided.
 */

import type {
  Action,
  ActionAmount,
  ActionChainId,
  ActionConstraints,
  ActionConstraintsResolved,
  CustomActionValue,
} from "../../types/actions.js";
import type { ExecutionContext, StepResult } from "../../types/execution.js";
import type { Expression } from "../../types/expressions.js";
import type { Address, VenueAlias } from "../../types/primitives.js";
import type { PlannedAction, ValueDelta } from "../../types/receipt.js";
import type { ActionStep } from "../../types/steps.js";
import type {
  VenueAdapterContext,
  VenueBuildMetadata,
  VenueBuildResult,
  VenueConstraint,
  VenueQuoteMetadata,
  VenueRegistry,
} from "../../venues/types.js";
import type { Executor } from "../../wallet/executor.js";
import type { ExecutionMode } from "../../wallet/executor.js";
import type { CircuitBreakerManager } from "../circuit-breaker.js";
import { addGasUsed, incrementActions, setBinding } from "../context.js";
import type { InMemoryLedger } from "../context.js";
import { classifyError } from "../error-classifier.js";
import { type EvalValue, createEvalContext, evaluateAsync } from "../expression-evaluator.js";
import { FEE_BUCKET_ADDRESS, LOSS_BUCKET_ADDRESS } from "../value-flow.js";

export interface ActionExecutionOptions {
  mode: ExecutionMode;
  executor?: Executor;
  circuitBreakerManager?: CircuitBreakerManager;
  adapterRegistry?: VenueRegistry;
  previewAdapterContext?: Omit<VenueAdapterContext, "mode" | "vault">;
  crossChain?: {
    enabled: boolean;
    runId: string;
    trackId: string;
    role: "source" | "destination";
    morphoMarketIds?: Record<string, string>;
  };
  warningCallback?: (message: string) => void;
}

const EXPRESSION_KINDS = new Set([
  "literal",
  "param",
  "state",
  "binding",
  "item",
  "index",
  "binary",
  "unary",
  "ternary",
  "call",
  "array_access",
  "property_access",
]);

const CONSTRAINT_FIELD_TO_META: Array<[keyof ActionConstraintsResolved, VenueConstraint]> = [
  ["maxSlippageBps", "max_slippage"],
  ["minOutput", "min_output"],
  ["maxInput", "max_input"],
  ["deadline", "deadline"],
  ["maxPriceImpactBps", "max_price_impact"],
  ["minLiquidity", "min_liquidity"],
  ["requireQuote", "require_quote"],
  ["requireSimulation", "require_simulation"],
  ["maxGas", "max_gas"],
];

export async function executeActionStep(
  step: ActionStep,
  ctx: ExecutionContext,
  ledger: InMemoryLedger,
  options: ActionExecutionOptions
): Promise<StepResult> {
  ledger.emit({ type: "step_started", stepId: step.id, kind: "action" });
  incrementActions(ctx);

  // Circuit breaker pre-check
  if (options.circuitBreakerManager) {
    const cbCheck = options.circuitBreakerManager.check();
    if (!cbCheck.allowed) {
      for (const blocker of cbCheck.blockedBy) {
        ledger.emit({
          type: "circuit_breaker_action",
          breakerId: blocker.id,
          action: blocker.action,
        });
      }
      const firstBlocker = cbCheck.blockedBy[0];
      if (firstBlocker?.action === "pause") {
        ledger.emit({
          type: "step_skipped",
          stepId: step.id,
          reason: `Circuit breaker '${firstBlocker.id}' is open`,
        });
        return {
          success: true,
          stepId: step.id,
          skipped: true,
          output: { skippedByCircuitBreaker: firstBlocker.id },
        };
      }
      // halt or unwind
      const breakerLabel = firstBlocker?.id ?? "unknown";
      ledger.emit({
        type: "step_failed",
        stepId: step.id,
        error: `Circuit breaker '${breakerLabel}' is open`,
      });
      return {
        success: false,
        stepId: step.id,
        error: `Circuit breaker '${breakerLabel}' is open`,
      };
    }
  }

  try {
    const evalCtx = createEvalContext(ctx);
    const explicitSkill = step.skill
      ? ctx.spell.skills.find((s) => s.name === step.skill)
      : undefined;
    const actionVenue = hasVenue(step.action) ? step.action.venue : undefined;
    const inferredSkill =
      !explicitSkill && actionVenue
        ? ctx.spell.skills.find((s) => s.name === actionVenue)
        : undefined;
    const skill = explicitSkill ?? inferredSkill;
    const skillName = skill?.name;

    const actionWithVenue = resolveActionVenue(step.action, skill, ctx, skillName);
    const resolvedAction = await resolveAction(actionWithVenue, evalCtx);
    const crossChainAdjustedAction = applyCrossChainActionOverrides(
      resolvedAction,
      step.id,
      options
    );
    maybeWarnMorphoImplicitMarket(crossChainAdjustedAction, step.id, options);

    const mergedConstraints = applySkillDefaults(step.constraints, skill);
    const resolvedConstraints = await resolveConstraints(mergedConstraints, evalCtx);
    const actionWithConstraints = {
      ...crossChainAdjustedAction,
      constraints: resolvedConstraints,
    } as Action;
    assertConstraintSupport(actionWithConstraints, options.adapterRegistry);

    ledger.emit({
      type: "constraint_evaluated",
      stepId: step.id,
      constraints: resolvedConstraints,
    });

    if (options.mode === "simulate") {
      const amountValue =
        "amount" in actionWithConstraints
          ? (actionWithConstraints as { amount?: unknown }).amount
          : undefined;
      const amountText = amountValue !== undefined ? String(amountValue) : "";

      ledger.emit({
        type: "action_simulated",
        action: actionWithConstraints,
        venue: resolveVenueAlias(actionWithConstraints, ctx),
        result: {
          success: true,
          input: {
            asset: "asset" in resolvedAction ? String(resolvedAction.asset ?? "") : "",
            amount: amountText,
          },
          output: {
            asset: "asset" in resolvedAction ? String(resolvedAction.asset ?? "") : "",
            amount: amountText,
          },
          gasEstimate: "0",
        },
      });

      ledger.emit({
        type: "step_completed",
        stepId: step.id,
        result: { simulated: true, action: actionWithConstraints },
      });

      if (step.outputBinding) {
        setBinding(ctx, step.outputBinding, { simulated: true, action: actionWithConstraints });
      }

      return {
        success: true,
        stepId: step.id,
        output: { simulated: true, action: actionWithConstraints },
      };
    }

    if (!options.executor) {
      throw new Error("No executor configured for action execution");
    }

    const result = await options.executor.executeAction(actionWithConstraints);

    if (!result.success) {
      const failError = result.error ?? "Action execution failed";

      // Feed failure to circuit breaker
      if (options.circuitBreakerManager) {
        const errorType = classifyError(failError);
        const eventType: "revert" | "slippage" | "gas" =
          errorType === "slippage_exceeded"
            ? "slippage"
            : errorType === "gas_exceeded"
              ? "gas"
              : "revert";
        const cbResult = options.circuitBreakerManager.recordEvent({
          timestamp: Date.now(),
          type: eventType,
        });
        if (cbResult) {
          ledger.emit({
            type: "circuit_breaker_triggered",
            breakerId: cbResult.breakerId,
            trigger: cbResult.trigger,
          });
        }
      }

      ledger.emit({
        type: "step_failed",
        stepId: step.id,
        error: failError,
      });

      if (result.hash) {
        ledger.emit({
          type: "action_reverted",
          txHash: result.hash,
          reason: failError,
        });
      }

      return {
        success: false,
        stepId: step.id,
        error: failError,
      };
    }

    if (result.hash) {
      ledger.emit({
        type: "action_submitted",
        action: actionWithConstraints,
        txHash: result.hash,
      });
    }

    if (result.receipt) {
      addGasUsed(ctx, result.receipt.gasUsed);
      ledger.emit({
        type: "action_confirmed",
        txHash: result.receipt.hash,
        gasUsed: result.receipt.gasUsed.toString(),
      });
    }

    // Record success for circuit breaker tracking
    if (options.circuitBreakerManager) {
      options.circuitBreakerManager.recordSuccess();
    }

    const output = {
      action: actionWithConstraints,
      hash: result.hash,
      receipt: result.receipt,
      gasUsed: result.gasUsed,
    };

    if (step.outputBinding) {
      setBinding(ctx, step.outputBinding, output);
    }

    ledger.emit({
      type: "step_completed",
      stepId: step.id,
      result: serializeValue(output),
    });

    return {
      success: true,
      stepId: step.id,
      output,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    ledger.emit({
      type: "step_failed",
      stepId: step.id,
      error: message,
    });

    return {
      success: false,
      stepId: step.id,
      error: message,
    };
  }
}

function hasVenue(action: Action): action is Action & { venue: string } {
  return "venue" in action;
}

function resolveActionVenue(
  action: Action,
  skill: { adapters: string[] } | undefined,
  ctx: ExecutionContext,
  skillName?: string
): Action {
  if (!skill || !skill.adapters.length) {
    return action;
  }

  const hasAlias = (venue?: string): boolean =>
    !!venue && ctx.spell.aliases.some((a) => a.alias === venue);

  const venue = (action as { venue?: string }).venue;
  const isSkillNamedVenue = !!skillName && venue === skillName;

  if (!isSkillNamedVenue && hasAlias(venue)) {
    return action;
  }

  const selected = skill.adapters.find((adapter) => hasAlias(adapter));
  if (!selected) {
    return action;
  }

  return { ...action, venue: selected } as Action;
}

function applySkillDefaults(
  constraints: ActionConstraints | undefined,
  skill: { defaultConstraints?: { maxSlippage?: number } } | undefined
): ActionConstraints | undefined {
  if (!skill?.defaultConstraints) return constraints;

  const merged: ActionConstraints = { ...(constraints ?? {}) };
  if (merged.maxSlippageBps === undefined && skill.defaultConstraints.maxSlippage !== undefined) {
    merged.maxSlippageBps = skill.defaultConstraints.maxSlippage;
  }

  return merged;
}

async function resolveAction(
  action: Action,
  evalCtx: ReturnType<typeof createEvalContext>
): Promise<Action> {
  switch (action.type) {
    case "swap":
      return {
        ...action,
        amount: await resolveAmount(action.amount, evalCtx),
      } as Action;

    case "lend":
      return {
        ...action,
        amount: await resolveAmount(action.amount, evalCtx),
      } as Action;

    case "withdraw":
      return {
        ...action,
        amount: await resolveAmount(action.amount, evalCtx),
      } as Action;

    case "borrow":
      return {
        ...action,
        amount: await resolveAmount(action.amount, evalCtx),
      } as Action;

    case "repay":
      return {
        ...action,
        amount: await resolveAmount(action.amount, evalCtx),
      } as Action;

    case "stake":
      return {
        ...action,
        amount: await resolveAmount(action.amount, evalCtx),
      } as Action;

    case "unstake":
      return {
        ...action,
        amount: await resolveAmount(action.amount, evalCtx),
      } as Action;

    case "bridge":
      return {
        ...action,
        amount: await resolveAmount(action.amount, evalCtx),
        toChain: await resolveChainId(action.toChain, evalCtx),
      } as Action;

    case "transfer":
      return {
        ...action,
        amount: await resolveAmount(action.amount, evalCtx),
        to: await resolveAddress(action.to, evalCtx),
      } as Action;

    case "approve":
      return {
        ...action,
        amount: await resolveAmount(action.amount, evalCtx),
      } as Action;

    case "claim":
      return action;

    case "custom":
      return {
        ...action,
        args: await resolveCustomArgs(action.args, evalCtx),
      } as Action;

    default:
      return action;
  }
}

async function resolveCustomArgs(
  args: Record<string, CustomActionValue>,
  evalCtx: ReturnType<typeof createEvalContext>
): Promise<Record<string, CustomActionValue>> {
  const resolved: Record<string, CustomActionValue> = {};
  for (const [key, value] of Object.entries(args)) {
    resolved[key] = await resolveCustomValue(value, evalCtx);
  }
  return resolved;
}

async function resolveCustomValue(
  value: CustomActionValue,
  evalCtx: ReturnType<typeof createEvalContext>
): Promise<CustomActionValue> {
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => resolveCustomValue(item, evalCtx)));
  }

  if (isExpressionValue(value)) {
    const evaluated = await evaluateAsync(value, evalCtx);
    return evaluated as CustomActionValue;
  }

  if (value && typeof value === "object") {
    const nested: Record<string, CustomActionValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      nested[key] = await resolveCustomValue(entry as CustomActionValue, evalCtx);
    }
    return nested;
  }

  return value;
}

function isExpressionValue(value: CustomActionValue): value is Expression {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    EXPRESSION_KINDS.has((value as { kind?: unknown }).kind as string)
  );
}

async function resolveAmount(
  amount: ActionAmount | "max" | null | undefined,
  evalCtx: ReturnType<typeof createEvalContext>
): Promise<bigint | "max" | null | undefined> {
  if (amount === undefined || amount === null || amount === "max") {
    return amount;
  }

  if (typeof amount === "bigint") {
    return amount;
  }

  if (typeof amount === "number") {
    return BigInt(Math.floor(amount));
  }

  if (typeof amount === "string") {
    return BigInt(amount);
  }

  const value = await evaluateAsync(amount, evalCtx);
  return toBigInt(value);
}

async function resolveChainId(
  toChain: ActionChainId,
  evalCtx: ReturnType<typeof createEvalContext>
): Promise<number> {
  if (typeof toChain === "number") {
    return toChain;
  }

  if (typeof toChain === "bigint") {
    return toNumber(toChain);
  }

  if (typeof toChain === "string") {
    return toNumber(toChain);
  }

  const value = await evaluateAsync(toChain, evalCtx);
  return toNumber(value);
}

async function resolveAddress(
  to: string | { kind: string },
  evalCtx: ReturnType<typeof createEvalContext>
): Promise<string> {
  if (typeof to === "string") {
    return to;
  }

  const value = await evaluateAsync(to as Parameters<typeof evaluateAsync>[0], evalCtx);
  if (typeof value !== "string") {
    throw new Error(`Expected address string, got ${typeof value}`);
  }
  return value;
}

async function resolveConstraints(
  constraints: ActionConstraints | undefined,
  evalCtx: ReturnType<typeof createEvalContext>
): Promise<ActionConstraintsResolved> {
  const active = constraints ?? {};
  const minOutput = active.minOutput
    ? toBigInt(await evaluateAsync(active.minOutput, evalCtx))
    : undefined;
  const maxInput = active.maxInput
    ? toBigInt(await evaluateAsync(active.maxInput, evalCtx))
    : undefined;
  const minLiquidity = active.minLiquidity
    ? toBigInt(await evaluateAsync(active.minLiquidity, evalCtx))
    : undefined;
  const maxGas = active.maxGas ? toBigInt(await evaluateAsync(active.maxGas, evalCtx)) : undefined;
  const requireQuote = active.requireQuote
    ? Boolean(await evaluateAsync(active.requireQuote, evalCtx))
    : undefined;
  const requireSimulation = active.requireSimulation
    ? Boolean(await evaluateAsync(active.requireSimulation, evalCtx))
    : undefined;

  return {
    maxSlippageBps: active.maxSlippageBps,
    maxPriceImpactBps: active.maxPriceImpactBps,
    deadline: active.deadline,
    minOutput,
    maxInput,
    minLiquidity,
    requireQuote,
    requireSimulation,
    maxGas,
  };
}

function toBigInt(value: EvalValue): bigint {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number") {
    return BigInt(Math.floor(value));
  }

  if (typeof value === "string") {
    try {
      return BigInt(value);
    } catch {
      throw new Error(`Cannot convert string '${value}' to bigint`);
    }
  }

  throw new Error(`Unsupported amount type: ${typeof value}`);
}

function toNumber(value: EvalValue): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Chain id must be a finite number");
    }
    return Math.floor(value);
  }

  if (typeof value === "bigint") {
    const numeric = Number(value);
    if (!Number.isSafeInteger(numeric)) {
      throw new Error("Chain id is too large to fit in a number");
    }
    return numeric;
  }

  if (typeof value === "string") {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      throw new Error(`Cannot convert string '${value}' to number`);
    }
    return Math.floor(numeric);
  }

  throw new Error(`Unsupported chain id type: ${typeof value}`);
}

function resolveVenueAlias(action: Action, ctx: ExecutionContext): VenueAlias {
  if ("venue" in action) {
    const alias = ctx.spell.aliases.find((entry) => entry.alias === action.venue);
    if (alias) {
      return alias;
    }
  }

  return {
    alias: "unknown",
    chain: ctx.chain,
    address: "0x0000000000000000000000000000000000000000",
  };
}

function buildActionRef(options: ActionExecutionOptions, stepId: string): string | undefined {
  if (!options.crossChain?.enabled) {
    return undefined;
  }
  return `${options.crossChain.role}:${stepId}`;
}

function buildCrossChainContext(
  options: ActionExecutionOptions,
  stepId: string
): VenueAdapterContext["crossChain"] {
  if (!options.crossChain?.enabled) {
    return undefined;
  }

  return {
    enabled: true,
    runId: options.crossChain.runId,
    trackId: options.crossChain.trackId,
    role: options.crossChain.role,
    stepId,
    actionRef: buildActionRef(options, stepId),
    morphoMarketIds: options.crossChain.morphoMarketIds,
  };
}

function isMorphoValueMovingAction(action: Action): boolean {
  return (
    "venue" in action &&
    action.venue === "morpho_blue" &&
    (action.type === "lend" ||
      action.type === "withdraw" ||
      action.type === "borrow" ||
      action.type === "repay")
  );
}

function applyCrossChainActionOverrides(
  action: Action,
  stepId: string,
  options: ActionExecutionOptions
): Action {
  if (!isMorphoValueMovingAction(action)) {
    return action;
  }

  const explicitMarketId =
    "marketId" in action && typeof action.marketId === "string" && action.marketId.length > 0
      ? action.marketId
      : undefined;

  if (!options.crossChain?.enabled) {
    return action;
  }

  const actionRef = buildActionRef(options, stepId);
  const mappedMarketId =
    actionRef && options.crossChain.morphoMarketIds
      ? options.crossChain.morphoMarketIds[actionRef]
      : undefined;
  const marketId = explicitMarketId ?? mappedMarketId;

  if (!marketId) {
    throw new Error(
      `Cross-chain Morpho action '${stepId}' is missing explicit market_id (actionRef '${actionRef ?? "unknown"}').`
    );
  }

  return { ...action, marketId } as Action;
}

function maybeWarnMorphoImplicitMarket(
  action: Action,
  stepId: string,
  options: ActionExecutionOptions
): void {
  if (!isMorphoValueMovingAction(action)) {
    return;
  }
  if (options.crossChain?.enabled) {
    return;
  }
  const hasExplicitMarket =
    "marketId" in action && typeof action.marketId === "string" && action.marketId.length > 0;
  if (hasExplicitMarket) {
    return;
  }
  options.warningCallback?.(
    `Step '${stepId}' uses Morpho without explicit market_id. Set market_id to avoid ambiguous market routing.`
  );
}

function deriveSimulationInput(
  action: Action,
  amountText: string
): { asset: string; amount: string } {
  switch (action.type) {
    case "swap":
      return { asset: String(action.assetIn), amount: amountText };
    case "lend":
    case "withdraw":
    case "borrow":
    case "repay":
    case "stake":
    case "unstake":
    case "bridge":
    case "transfer":
    case "approve":
      return { asset: String(action.asset), amount: amountText };
    default:
      return { asset: "", amount: amountText };
  }
}

function deriveSimulationOutput(
  action: Action,
  amountText: string
): { asset: string; amount: string } {
  switch (action.type) {
    case "swap":
      return { asset: String(action.assetOut), amount: amountText };
    case "withdraw":
    case "borrow":
    case "unstake":
    case "bridge":
    case "transfer":
    case "approve":
      return { asset: String(action.asset), amount: amountText };
    case "lend":
    case "repay":
    case "stake":
      return { asset: String(action.asset), amount: "0" };
    default:
      return { asset: "", amount: "0" };
  }
}

function buildValueDeltas(input: {
  stepId: string;
  vault: Address;
  venueAddress: Address;
  simulationResult: {
    input: { asset: string; amount: string };
    output: { asset: string; amount: string };
  };
}): ValueDelta[] {
  const deltas: ValueDelta[] = [];
  const inputAmount = parseAmount(input.simulationResult.input.amount);
  const outputAmount = parseAmount(input.simulationResult.output.amount);
  const inputAsset = input.simulationResult.input.asset;
  const outputAsset = input.simulationResult.output.asset;

  if (inputAmount > 0n && inputAsset.length > 0) {
    deltas.push({
      asset: inputAsset,
      amount: inputAmount,
      from: input.vault,
      to: input.venueAddress,
      reason: `action:${input.stepId}:input`,
    });
  }

  if (outputAmount > 0n && outputAsset.length > 0) {
    deltas.push({
      asset: outputAsset,
      amount: outputAmount,
      from: input.venueAddress,
      to: input.vault,
      reason: `action:${input.stepId}:output`,
    });
  }

  if (inputAsset.length > 0 && outputAsset.length > 0 && inputAsset === outputAsset) {
    const difference = inputAmount - outputAmount;
    if (difference > 0n) {
      deltas.push({
        asset: inputAsset,
        amount: difference,
        from: input.vault,
        to: LOSS_BUCKET_ADDRESS,
        reason: `loss:${input.stepId}:slippage`,
      });
    } else if (difference < 0n) {
      deltas.push({
        asset: inputAsset,
        amount: -difference,
        from: input.venueAddress,
        to: FEE_BUCKET_ADDRESS,
        reason: `fee:${input.stepId}:rebate`,
      });
    }
  }

  return deltas;
}

function parseAmount(value: string): bigint {
  const trimmed = value.trim();
  if (!trimmed || !/^[-+]?\d+$/.test(trimmed)) {
    return 0n;
  }
  try {
    const parsed = BigInt(trimmed);
    return parsed > 0n ? parsed : 0n;
  } catch {
    return 0n;
  }
}

type ActionSimulationResult = {
  success: boolean;
  gasEstimate: string;
  input: { asset: string; amount: string };
  output: { asset: string; amount: string };
};

function assertConstraintSupport(action: Action, adapterRegistry: VenueRegistry | undefined): void {
  if (!adapterRegistry) {
    return;
  }
  if (!("venue" in action) || !action.venue) {
    return;
  }

  const adapter = adapterRegistry.get(action.venue);
  if (!adapter) {
    return;
  }

  const constraints = action.constraints;
  if (!constraints) {
    return;
  }

  const supported = new Set(adapter.meta.supportedConstraints);
  for (const [field, constraint] of CONSTRAINT_FIELD_TO_META) {
    if (constraints[field] === undefined || supported.has(constraint)) {
      continue;
    }
    throw new Error(
      `Adapter '${adapter.meta.name}' does not support constraint '${constraint}' for action '${action.type}'`
    );
  }
}

function assertPreviewAdapterAvailability(
  action: Action,
  ctx: ExecutionContext,
  options: ActionExecutionOptions
): void {
  if (!("venue" in action) || !action.venue) {
    return;
  }

  if (!options.adapterRegistry) {
    throw new Error(
      `Preview requires a venue adapter registry for venue action '${action.venue}'.`
    );
  }

  const adapter = options.adapterRegistry.get(action.venue);
  if (!adapter) {
    throw new Error(`Adapter '${action.venue}' is not registered`);
  }

  if (!adapter.meta.supportedChains.includes(ctx.chain)) {
    throw new Error(`Adapter '${adapter.meta.name}' does not support chain ${ctx.chain}.`);
  }
}

async function deriveAdapterSimulationResult(
  action: Action,
  ctx: ExecutionContext,
  options: ActionExecutionOptions,
  amountText: string,
  stepId: string
): Promise<ActionSimulationResult | null> {
  if (!("venue" in action) || !action.venue) {
    return null;
  }

  const adapterRegistry = options.adapterRegistry;
  const previewAdapterContext = options.previewAdapterContext;
  const requiresQuote = action.constraints?.requireQuote === true;
  const requiresSimulation =
    action.constraints?.requireSimulation === true || action.constraints?.maxGas !== undefined;

  if (!adapterRegistry) {
    if (requiresQuote || requiresSimulation) {
      throw new Error(
        `Cannot enforce quote/simulation constraints for venue '${action.venue}' without an adapter registry`
      );
    }
    return null;
  }
  if (!previewAdapterContext) {
    if (requiresQuote || requiresSimulation) {
      throw new Error(
        `Cannot enforce quote/simulation constraints for venue '${action.venue}' without preview adapter context`
      );
    }
    return null;
  }

  const adapter = adapterRegistry.get(action.venue);
  if (!adapter) {
    if (requiresQuote || requiresSimulation) {
      throw new Error(
        `Adapter '${action.venue}' is required to enforce quote/simulation constraints but is not registered`
      );
    }
    return null;
  }
  if (!adapter.meta.supportedChains.includes(ctx.chain)) {
    if (requiresQuote || requiresSimulation) {
      throw new Error(
        `Adapter '${adapter.meta.name}' does not support chain ${ctx.chain} required for quote/simulation constraints`
      );
    }
    return null;
  }

  if (!adapter.buildAction) {
    if (requiresQuote || requiresSimulation) {
      throw new Error(
        `Adapter '${adapter.meta.name}' cannot build preview simulation while quote/simulation constraints are enabled`
      );
    }
    return null;
  }
  if (!adapter.meta.supportsQuote && !adapter.meta.supportsSimulation) {
    if (requiresQuote || requiresSimulation) {
      throw new Error(
        `Adapter '${adapter.meta.name}' does not provide preview quote/simulation support required by constraints`
      );
    }
    return null;
  }

  try {
    const crossChainContext = buildCrossChainContext(options, stepId);
    const buildResult = await adapter.buildAction(action, {
      ...previewAdapterContext,
      chainId: ctx.chain,
      vault: ctx.vault,
      mode: "simulate",
      crossChain: crossChainContext,
      onWarning: options.warningCallback,
    });
    const built = normalizeVenueBuildResult(buildResult);
    const primary = built[built.length - 1];
    if (!primary) {
      return null;
    }
    return buildSimulationFromBuildResult(action, primary, amountText);
  } catch (error) {
    if (requiresQuote || requiresSimulation) {
      throw error;
    }
    return null;
  }
}

function normalizeVenueBuildResult(result: VenueBuildResult): Array<{
  gasEstimate?: { gasLimit: bigint };
  metadata?: VenueBuildMetadata;
}> {
  const normalized = Array.isArray(result) ? result : [result];
  return normalized.map((tx) => ({
    gasEstimate: tx.gasEstimate ? { gasLimit: tx.gasEstimate.gasLimit } : undefined,
    metadata: tx.metadata,
  }));
}

function buildSimulationFromBuildResult(
  action: Action,
  built: {
    gasEstimate?: { gasLimit: bigint };
    metadata?: VenueBuildMetadata;
  },
  amountText: string
): ActionSimulationResult {
  const fallbackInput = deriveSimulationInput(action, amountText);
  const fallbackOutput = deriveSimulationOutput(action, amountText);
  const quotedIO = applyQuoteToSimulation(
    action,
    built.metadata?.quote,
    fallbackInput,
    fallbackOutput
  );
  const routeGas = readGasFromRouteMetadata(built.metadata?.route);
  const resolvedGasEstimate = built.gasEstimate?.gasLimit ?? routeGas;
  if (action.constraints?.maxGas !== undefined && resolvedGasEstimate === undefined) {
    const venue = "venue" in action && action.venue ? action.venue : "unknown";
    throw new Error(
      `Adapter '${venue}' could not provide gas estimate while max_gas is enabled for action '${action.type}'`
    );
  }
  const gasEstimate = resolvedGasEstimate ?? 0n;

  return {
    success: true,
    gasEstimate: gasEstimate.toString(),
    input: quotedIO.input,
    output: quotedIO.output,
  };
}

function applyQuoteToSimulation(
  action: Action,
  quote: VenueQuoteMetadata | undefined,
  fallbackInput: { asset: string; amount: string },
  fallbackOutput: { asset: string; amount: string }
): { input: { asset: string; amount: string }; output: { asset: string; amount: string } } {
  if (!quote) {
    return { input: fallbackInput, output: fallbackOutput };
  }

  const input = { ...fallbackInput };
  const output = { ...fallbackOutput };

  if (action.type === "swap") {
    if (action.mode === "exact_out") {
      if (quote.maxIn !== undefined) input.amount = quote.maxIn.toString();
      else if (quote.expectedIn !== undefined) input.amount = quote.expectedIn.toString();
      if (quote.expectedOut !== undefined) output.amount = quote.expectedOut.toString();
    } else {
      if (quote.expectedIn !== undefined) input.amount = quote.expectedIn.toString();
      if (quote.minOut !== undefined) output.amount = quote.minOut.toString();
      else if (quote.expectedOut !== undefined) output.amount = quote.expectedOut.toString();
    }
    return { input, output };
  }

  if (quote.expectedIn !== undefined) input.amount = quote.expectedIn.toString();
  if (quote.minOut !== undefined) output.amount = quote.minOut.toString();
  else if (quote.expectedOut !== undefined) output.amount = quote.expectedOut.toString();

  return { input, output };
}

function readGasFromRouteMetadata(route: Record<string, unknown> | undefined): bigint | undefined {
  if (!route) {
    return undefined;
  }
  const candidate = route.gasEstimate;
  if (typeof candidate === "bigint") {
    return candidate;
  }
  if (typeof candidate === "number") {
    if (!Number.isFinite(candidate) || candidate <= 0) return undefined;
    return BigInt(Math.floor(candidate));
  }
  if (typeof candidate === "string") {
    try {
      return BigInt(candidate);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function serializeValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }
  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = serializeValue(v);
    }
    return result;
  }
  return value;
}

// =============================================================================
// PREVIEW ACTION STEP
// =============================================================================

export interface PreviewActionResult {
  stepResult: StepResult;
  plannedAction?: PlannedAction;
  valueDeltas?: ValueDelta[];
}

/**
 * Preview an action step — resolves the action and simulates it,
 * returning a PlannedAction instead of executing a real transaction.
 */
export async function previewActionStep(
  step: ActionStep,
  ctx: ExecutionContext,
  ledger: InMemoryLedger,
  options: ActionExecutionOptions
): Promise<PreviewActionResult> {
  ledger.emit({ type: "step_started", stepId: step.id, kind: "action" });
  incrementActions(ctx);

  try {
    const evalCtx = createEvalContext(ctx);
    const explicitSkill = step.skill
      ? ctx.spell.skills.find((s) => s.name === step.skill)
      : undefined;
    const actionVenue = hasVenue(step.action) ? step.action.venue : undefined;
    const inferredSkill =
      !explicitSkill && actionVenue
        ? ctx.spell.skills.find((s) => s.name === actionVenue)
        : undefined;
    const skill = explicitSkill ?? inferredSkill;
    const skillName = skill?.name;

    const actionWithVenue = resolveActionVenue(step.action, skill, ctx, skillName);
    const resolvedAction = await resolveAction(actionWithVenue, evalCtx);
    const crossChainAdjustedAction = applyCrossChainActionOverrides(
      resolvedAction,
      step.id,
      options
    );
    maybeWarnMorphoImplicitMarket(crossChainAdjustedAction, step.id, options);

    const mergedConstraints = applySkillDefaults(step.constraints, skill);
    const resolvedConstraints = await resolveConstraints(mergedConstraints, evalCtx);
    const actionWithConstraints = {
      ...crossChainAdjustedAction,
      constraints: resolvedConstraints,
    } as Action;
    assertConstraintSupport(actionWithConstraints, options.adapterRegistry);
    assertPreviewAdapterAvailability(actionWithConstraints, ctx, options);

    ledger.emit({
      type: "constraint_evaluated",
      stepId: step.id,
      constraints: resolvedConstraints,
    });

    const venue = resolveVenueAlias(actionWithConstraints, ctx);
    const amountValue =
      "amount" in actionWithConstraints
        ? (actionWithConstraints as { amount?: unknown }).amount
        : undefined;
    const amountText = amountValue !== undefined ? String(amountValue) : "";
    const fallbackSimulationResult = {
      success: true,
      gasEstimate: "0",
      input: deriveSimulationInput(actionWithConstraints, amountText),
      output: deriveSimulationOutput(actionWithConstraints, amountText),
    };
    const adapterSimulationResult = await deriveAdapterSimulationResult(
      actionWithConstraints,
      ctx,
      options,
      amountText,
      step.id
    );
    if (
      adapterSimulationResult === null &&
      actionWithConstraints.constraints?.maxGas !== undefined
    ) {
      const venue = "venue" in actionWithConstraints ? actionWithConstraints.venue : "unknown";
      throw new Error(
        `Cannot enforce max_gas for action '${actionWithConstraints.type}' on venue '${venue}' without adapter simulation`
      );
    }
    const simulationResult = adapterSimulationResult ?? fallbackSimulationResult;

    ledger.emit({
      type: "action_simulated",
      action: actionWithConstraints,
      venue,
      result: simulationResult,
    });

    const valueDeltas = buildValueDeltas({
      stepId: step.id,
      vault: ctx.vault,
      venueAddress: venue.address,
      simulationResult,
    });

    const plannedAction: PlannedAction = {
      stepId: step.id,
      action: actionWithConstraints,
      venue: venue.alias,
      constraints: resolvedConstraints,
      onFailure: step.onFailure,
      simulationResult,
      valueDeltas,
    };

    ledger.emit({
      type: "step_completed",
      stepId: step.id,
      result: { simulated: true, action: actionWithConstraints },
    });

    if (step.outputBinding) {
      setBinding(ctx, step.outputBinding, { simulated: true, action: actionWithConstraints });
    }

    return {
      stepResult: {
        success: true,
        stepId: step.id,
        output: { simulated: true, action: actionWithConstraints },
      },
      plannedAction,
      valueDeltas,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    ledger.emit({ type: "step_failed", stepId: step.id, error: message });

    return {
      stepResult: { success: false, stepId: step.id, error: message },
    };
  }
}

// =============================================================================
// COMMIT ACTION STEP
// =============================================================================

export interface CommitActionResult {
  success: boolean;
  hash?: string;
  gasUsed?: bigint;
  error?: string;
}

/**
 * Commit a planned action — takes a PlannedAction from the receipt
 * and executes the real transaction via the executor.
 */
export async function commitActionStep(
  planned: PlannedAction,
  executor: Executor
): Promise<CommitActionResult> {
  try {
    const result = await executor.executeAction(planned.action);

    if (!result.success) {
      return {
        success: false,
        hash: result.hash,
        error: result.error ?? "Action execution failed",
      };
    }

    return {
      success: true,
      hash: result.hash,
      gasUsed: result.receipt?.gasUsed ?? result.gasUsed,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}
