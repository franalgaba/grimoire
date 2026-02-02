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
} from "../../types/actions.js";
import type { ExecutionContext, StepResult } from "../../types/execution.js";
import type { VenueAlias } from "../../types/primitives.js";
import type { ActionStep } from "../../types/steps.js";
import type { Executor } from "../../wallet/executor.js";
import type { ExecutionMode } from "../../wallet/executor.js";
import type { CircuitBreakerManager } from "../circuit-breaker.js";
import { addGasUsed, incrementActions, setBinding } from "../context.js";
import type { InMemoryLedger } from "../context.js";
import { classifyError } from "../error-classifier.js";
import { type EvalValue, createEvalContext, evaluateAsync } from "../expression-evaluator.js";

export interface ActionExecutionOptions {
  mode: ExecutionMode;
  executor?: Executor;
  circuitBreakerManager?: CircuitBreakerManager;
}

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
    const resolvedAction = await resolveAction(step.action, evalCtx);
    const resolvedConstraints = await resolveConstraints(step.constraints, evalCtx);
    const actionWithConstraints = { ...resolvedAction, constraints: resolvedConstraints } as Action;

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

    default:
      return action;
  }
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
  constraints: ActionConstraints,
  evalCtx: ReturnType<typeof createEvalContext>
): Promise<ActionConstraintsResolved> {
  const minOutput = constraints.minOutput
    ? toBigInt(await evaluateAsync(constraints.minOutput, evalCtx))
    : undefined;
  const maxInput = constraints.maxInput
    ? toBigInt(await evaluateAsync(constraints.maxInput, evalCtx))
    : undefined;

  return {
    maxSlippageBps: constraints.maxSlippageBps,
    deadline: constraints.deadline,
    minOutput,
    maxInput,
    maxGas: constraints.maxGas,
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
