/**
 * Spell Interpreter
 * Executes compiled SpellIR via preview/commit model (SPEC-004)
 */

import type { ExecutionContext, ExecutionResult, StepResult } from "../types/execution.js";
import type { AdvisorDef, Guard, GuardDef, SpellIR } from "../types/ir.js";
import type { PolicySet } from "../types/policy.js";
import type { Address, ChainId } from "../types/primitives.js";
import type {
  AdvisoryResult,
  CommitResult,
  DriftCheckResult,
  DriftPolicy,
  GuardResult,
  PlannedAction,
  PreviewResult,
  Receipt,
  ReceiptStatus,
  ValueDelta,
} from "../types/receipt.js";
import type { Step } from "../types/steps.js";
import type { VenueAdapter } from "../venues/types.js";
import { type ExecutionMode, createExecutor } from "../wallet/executor.js";
import { type Provider, createProvider } from "../wallet/provider.js";
import type { Wallet } from "../wallet/types.js";
import { CircuitBreakerManager } from "./circuit-breaker.js";
import {
  InMemoryLedger,
  createContext,
  getPersistentStateObject,
  incrementAdvisoryCalls,
  markStepExecuted,
} from "./context.js";
import { type EvalContext, createEvalContext, evaluateAsync } from "./expression-evaluator.js";
import { resolveAdvisorSkill } from "./skills/registry.js";

// Step executors
import {
  type ActionExecutionOptions,
  commitActionStep,
  executeActionStep,
  previewActionStep,
} from "./steps/action.js";
import { type AdvisoryHandler, executeAdvisoryStep } from "./steps/advisory.js";
import { executeComputeStep } from "./steps/compute.js";
import { executeConditionalStep } from "./steps/conditional.js";
import { executeEmitStep } from "./steps/emit.js";
import { executeHaltStep } from "./steps/halt.js";
import { executeLoopStep } from "./steps/loop.js";
import { executeParallelStep } from "./steps/parallel.js";
import { executePipelineStep } from "./steps/pipeline.js";
import { executeTryStep } from "./steps/try.js";
import { executeWaitStep } from "./steps/wait.js";

// =============================================================================
// EXECUTE OPTIONS (backward-compat)
// =============================================================================

/**
 * Options for executing a spell
 */
export interface ExecuteOptions {
  /** The compiled spell */
  spell: SpellIR;
  /** Vault address */
  vault: Address;
  /** Chain ID */
  chain: ChainId;
  /** Parameter overrides */
  params?: Record<string, unknown>;
  /** Initial persistent state */
  persistentState?: Record<string, unknown>;
  /** Simulation mode (no actual transactions) */
  simulate?: boolean;
  /** Execution mode override */
  executionMode?: ExecutionMode;
  /** Wallet for signing and sending transactions */
  wallet?: Wallet;
  /** Provider override (optional) */
  provider?: Provider;
  /** RPC URL override */
  rpcUrl?: string;
  /** Gas multiplier */
  gasMultiplier?: number;
  /** Skip confirmation for testnets */
  skipTestnetConfirmation?: boolean;
  /** Confirmation prompt callback */
  confirmCallback?: (message: string) => Promise<boolean>;
  /** Progress updates callback */
  progressCallback?: (message: string) => void;
  /** Venue adapters */
  adapters?: VenueAdapter[];
  /** Policy set with risk controls (circuit breakers, etc.) */
  policy?: PolicySet;
  /** Advisor skill search directories */
  advisorSkillsDirs?: string[];
  /** Optional advisory handler for agent execution */
  onAdvisory?: AdvisoryHandler;
}

// =============================================================================
// PREVIEW OPTIONS & FUNCTION
// =============================================================================

/**
 * Options for previewing a spell (simulation / receipt generation)
 */
export interface PreviewOptions {
  spell: SpellIR;
  vault: Address;
  chain: ChainId;
  params?: Record<string, unknown>;
  persistentState?: Record<string, unknown>;
  adapters?: VenueAdapter[];
  policy?: PolicySet;
  advisorSkillsDirs?: string[];
  onAdvisory?: AdvisoryHandler;
  progressCallback?: (message: string) => void;
}

/**
 * Preview a spell — runs the full step loop in simulation mode,
 * collects PlannedActions and ValueDeltas, and assembles a Receipt.
 */
export async function preview(options: PreviewOptions): Promise<PreviewResult> {
  const { spell, vault, chain, params = {}, persistentState = {} } = options;

  // Always simulate during preview
  const actionExecution: ActionExecutionOptions = { mode: "simulate" };

  if (options.policy?.circuitBreakers?.length) {
    actionExecution.circuitBreakerManager = new CircuitBreakerManager(
      options.policy.circuitBreakers
    );
  }

  const ctx = createContext({ spell, vault, chain, params, persistentState });
  ctx.advisorTooling = buildAdvisorTooling(spell.advisors, options.advisorSkillsDirs);

  const ledger = new InMemoryLedger(ctx.runId, spell.id);
  const guardResults: GuardResult[] = [];
  const advisoryResults: AdvisoryResult[] = [];
  const plannedActions: PlannedAction[] = [];
  const valueDeltas: ValueDelta[] = [];

  const receiptId = `rcpt_${ctx.runId}`;

  ledger.emit({ type: "preview_started", runId: ctx.runId, spellId: spell.id });
  ledger.emit({
    type: "run_started",
    runId: ctx.runId,
    spellId: spell.id,
    trigger: ctx.trigger,
  });

  try {
    // Check pre-execution guards and collect results
    const guardCheck = await checkGuards(spell.guards, ctx, ledger);
    collectGuardResults(guardResults, spell.guards, guardCheck);

    if (!guardCheck.success) {
      const receipt = buildReceipt({
        id: receiptId,
        spell,
        ctx,
        guardResults,
        advisoryResults,
        plannedActions,
        valueDeltas,
        status: "rejected",
        error: `Guard failed: ${guardCheck.error}`,
      });

      ledger.emit({ type: "receipt_generated", receiptId });
      ledger.emit({ type: "preview_completed", runId: ctx.runId, receiptId, status: "rejected" });

      return {
        success: false,
        receipt,
        error: `Guard failed: ${guardCheck.error}`,
        ledgerEvents: ledger.getEntries(),
      };
    }

    // Run step loop in preview mode — action steps produce PlannedActions instead of executing
    const stepMap = new Map(spell.steps.map((s) => [s.id, s]));
    const stepLoopResult = await executeStepLoop(
      spell,
      ctx,
      ledger,
      stepMap,
      actionExecution,
      options.onAdvisory,
      { isPreview: true, plannedActions, valueDeltas, advisoryResults }
    );

    if (!stepLoopResult.success) {
      const receipt = buildReceipt({
        id: receiptId,
        spell,
        ctx,
        guardResults,
        advisoryResults,
        plannedActions,
        valueDeltas,
        status: "rejected",
        error: stepLoopResult.error,
      });

      ledger.emit({ type: "receipt_generated", receiptId });
      ledger.emit({ type: "preview_completed", runId: ctx.runId, receiptId, status: "rejected" });

      return {
        success: false,
        receipt,
        error: stepLoopResult.error,
        ledgerEvents: ledger.getEntries(),
      };
    }

    // Post-execution guards
    const postGuardCheck = await checkGuards(spell.guards, ctx, ledger);
    if (!postGuardCheck.success && postGuardCheck.severity === "halt") {
      const receipt = buildReceipt({
        id: receiptId,
        spell,
        ctx,
        guardResults,
        advisoryResults,
        plannedActions,
        valueDeltas,
        status: "rejected",
        error: `Post-execution guard failed: ${postGuardCheck.error}`,
      });

      ledger.emit({ type: "receipt_generated", receiptId });
      ledger.emit({ type: "preview_completed", runId: ctx.runId, receiptId, status: "rejected" });

      return { success: false, receipt, error: receipt.error, ledgerEvents: ledger.getEntries() };
    }

    const requiresApproval = plannedActions.length > 0;
    const receipt = buildReceipt({
      id: receiptId,
      spell,
      ctx,
      guardResults,
      advisoryResults,
      plannedActions,
      valueDeltas,
      status: "ready",
    });

    if (requiresApproval) {
      ledger.emit({
        type: "approval_required",
        receiptId,
        reason: "Planned actions require approval",
      });
    }

    ledger.emit({ type: "receipt_generated", receiptId });
    ledger.emit({
      type: "run_completed",
      runId: ctx.runId,
      success: true,
      metrics: ctx.metrics,
    });
    ledger.emit({ type: "preview_completed", runId: ctx.runId, receiptId, status: "ready" });

    return { success: true, receipt, ledgerEvents: ledger.getEntries() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    ledger.emit({ type: "run_failed", runId: ctx.runId, error: message });
    ledger.emit({ type: "preview_completed", runId: ctx.runId, receiptId, status: "rejected" });

    return { success: false, error: message, ledgerEvents: ledger.getEntries() };
  }
}

// =============================================================================
// COMMIT OPTIONS & FUNCTION
// =============================================================================

/**
 * Options for committing a previewed receipt
 */
export interface CommitOptions {
  receipt: Receipt;
  wallet: Wallet;
  provider?: Provider;
  rpcUrl?: string;
  gasMultiplier?: number;
  adapters?: VenueAdapter[];
  confirmCallback?: (message: string) => Promise<boolean>;
  progressCallback?: (message: string) => void;
  skipTestnetConfirmation?: boolean;
  driftPolicy?: DriftPolicy;
}

/**
 * Commit a receipt — executes planned actions from the preview.
 */
export async function commit(options: CommitOptions): Promise<CommitResult> {
  const { receipt, wallet } = options;
  const runId = receipt.id.replace("rcpt_", "");
  const ledger = new InMemoryLedger(runId, receipt.spellId);

  ledger.emit({ type: "commit_started", runId, receiptId: receipt.id });

  // Validate receipt status
  if (receipt.status !== "ready") {
    ledger.emit({ type: "commit_completed", runId, receiptId: receipt.id, success: false });
    return {
      success: false,
      receiptId: receipt.id,
      transactions: [],
      driftChecks: [],
      finalState: receipt.finalState,
      ledgerEvents: ledger.getEntries(),
      error: `Receipt status is '${receipt.status}', expected 'ready'`,
    };
  }

  // Check receipt age
  if (options.driftPolicy?.maxAge) {
    const ageSec = (Date.now() - receipt.timestamp) / 1000;
    if (ageSec > options.driftPolicy.maxAge) {
      ledger.emit({ type: "commit_completed", runId, receiptId: receipt.id, success: false });
      return {
        success: false,
        receiptId: receipt.id,
        transactions: [],
        driftChecks: [],
        finalState: receipt.finalState,
        ledgerEvents: ledger.getEntries(),
        error: `Receipt expired: age ${Math.round(ageSec)}s exceeds maxAge ${options.driftPolicy.maxAge}s`,
      };
    }
  }

  // Run drift checks (placeholder — real drift checking in Phase 2)
  const driftChecks: DriftCheckResult[] = receipt.driftKeys.map((dk) => {
    const result: DriftCheckResult = {
      field: dk.field,
      passed: true,
      previewValue: dk.previewValue,
      commitValue: dk.previewValue, // Same for now — real fetch in Phase 2
    };
    ledger.emit({
      type: "drift_check",
      field: dk.field,
      passed: true,
      previewValue: dk.previewValue,
      commitValue: dk.previewValue,
    });
    return result;
  });

  // Execute planned actions
  const { chainId } = receipt.chainContext;
  const provider = options.provider ?? createProvider(chainId, options.rpcUrl);
  const executor = createExecutor({
    wallet,
    provider,
    mode: "execute",
    gasMultiplier: options.gasMultiplier,
    confirmCallback: options.confirmCallback,
    progressCallback: options.progressCallback,
    skipTestnetConfirmation: options.skipTestnetConfirmation,
    adapters: options.adapters,
  });

  const transactions: CommitResult["transactions"] = [];

  for (const planned of receipt.plannedActions) {
    try {
      const txResult = await commitActionStep(planned, executor);

      if (txResult.success) {
        transactions.push({
          stepId: planned.stepId,
          hash: txResult.hash,
          gasUsed: txResult.gasUsed,
          success: true,
        });

        if (txResult.hash) {
          ledger.emit({
            type: "action_submitted",
            action: planned.action,
            txHash: txResult.hash,
          });
        }
        if (txResult.gasUsed !== undefined) {
          ledger.emit({
            type: "action_confirmed",
            txHash: txResult.hash ?? "",
            gasUsed: txResult.gasUsed.toString(),
          });
        }
      } else {
        transactions.push({
          stepId: planned.stepId,
          hash: txResult.hash,
          success: false,
          error: txResult.error,
        });

        ledger.emit({ type: "commit_completed", runId, receiptId: receipt.id, success: false });
        return {
          success: false,
          receiptId: receipt.id,
          transactions,
          driftChecks,
          finalState: receipt.finalState,
          ledgerEvents: ledger.getEntries(),
          error: `Action step '${planned.stepId}' failed: ${txResult.error}`,
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      transactions.push({ stepId: planned.stepId, success: false, error: message });

      ledger.emit({ type: "commit_completed", runId, receiptId: receipt.id, success: false });
      return {
        success: false,
        receiptId: receipt.id,
        transactions,
        driftChecks,
        finalState: receipt.finalState,
        ledgerEvents: ledger.getEntries(),
        error: message,
      };
    }
  }

  ledger.emit({ type: "commit_completed", runId, receiptId: receipt.id, success: true });

  return {
    success: true,
    receiptId: receipt.id,
    transactions,
    driftChecks,
    finalState: receipt.finalState,
    ledgerEvents: ledger.getEntries(),
  };
}

// =============================================================================
// EXECUTE (backward-compatible wrapper)
// =============================================================================

/**
 * Execute a compiled spell (backward-compatible wrapper).
 * Internally uses preview() and, if needed, commit().
 */
export async function execute(options: ExecuteOptions): Promise<ExecutionResult> {
  const { spell, vault, chain, params = {}, persistentState = {}, simulate = false } = options;

  const actionMode = resolveExecutionMode(options, simulate);

  // If we're simulating or have no wallet, use preview-only path
  if (actionMode === "simulate" || !options.wallet) {
    const previewResult = await preview({
      spell,
      vault,
      chain,
      params,
      persistentState,
      adapters: options.adapters,
      policy: options.policy,
      advisorSkillsDirs: options.advisorSkillsDirs,
      onAdvisory: options.onAdvisory,
      progressCallback: options.progressCallback,
    });

    return convertPreviewToExecutionResult(previewResult, spell);
  }

  // Full execute path: run the original step loop with real action execution
  const actionExecution = createActionExecutionOptions(options, actionMode, chain);

  if (options.policy?.circuitBreakers?.length) {
    actionExecution.circuitBreakerManager = new CircuitBreakerManager(
      options.policy.circuitBreakers
    );
  }

  const ctx = createContext({ spell, vault, chain, params, persistentState });
  ctx.advisorTooling = buildAdvisorTooling(spell.advisors, options.advisorSkillsDirs);

  const ledger = new InMemoryLedger(ctx.runId, spell.id);

  ledger.emit({
    type: "run_started",
    runId: ctx.runId,
    spellId: spell.id,
    trigger: ctx.trigger,
  });

  try {
    const guardCheck = await checkGuards(spell.guards, ctx, ledger);
    if (!guardCheck.success) {
      throw new Error(`Guard failed: ${guardCheck.error}`);
    }

    const stepMap = new Map(spell.steps.map((s) => [s.id, s]));
    const stepLoopResult = await executeStepLoop(
      spell,
      ctx,
      ledger,
      stepMap,
      actionExecution,
      options.onAdvisory
    );

    if (!stepLoopResult.success) {
      throw new Error(stepLoopResult.error);
    }

    if (stepLoopResult.halted) {
      ledger.emit({
        type: "run_completed",
        runId: ctx.runId,
        success: true,
        metrics: ctx.metrics,
      });

      return {
        success: true,
        runId: ctx.runId,
        startTime: ctx.startTime,
        endTime: Date.now(),
        duration: Date.now() - ctx.startTime,
        metrics: ctx.metrics,
        finalState: getPersistentStateObject(ctx),
        ledgerEvents: ledger.getEntries(),
      };
    }

    const postGuardCheck = await checkGuards(spell.guards, ctx, ledger);
    if (!postGuardCheck.success && postGuardCheck.severity === "halt") {
      throw new Error(`Post-execution guard failed: ${postGuardCheck.error}`);
    }

    ledger.emit({
      type: "run_completed",
      runId: ctx.runId,
      success: true,
      metrics: ctx.metrics,
    });

    return {
      success: true,
      runId: ctx.runId,
      startTime: ctx.startTime,
      endTime: Date.now(),
      duration: Date.now() - ctx.startTime,
      metrics: ctx.metrics,
      finalState: getPersistentStateObject(ctx),
      ledgerEvents: ledger.getEntries(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    ledger.emit({ type: "run_failed", runId: ctx.runId, error: message });

    return {
      success: false,
      runId: ctx.runId,
      startTime: ctx.startTime,
      endTime: Date.now(),
      duration: Date.now() - ctx.startTime,
      error: message,
      metrics: ctx.metrics,
      finalState: getPersistentStateObject(ctx),
      ledgerEvents: ledger.getEntries(),
    };
  }
}

// =============================================================================
// SHARED STEP LOOP
// =============================================================================

interface StepLoopCollectors {
  isPreview: boolean;
  plannedActions?: PlannedAction[];
  valueDeltas?: ValueDelta[];
  advisoryResults?: AdvisoryResult[];
}

interface StepLoopResult {
  success: boolean;
  halted?: boolean;
  error?: string;
}

/**
 * Shared step execution loop used by both preview() and execute().
 */
async function executeStepLoop(
  spell: SpellIR,
  ctx: ExecutionContext,
  ledger: InMemoryLedger,
  stepMap: Map<string, Step>,
  actionExecution: ActionExecutionOptions,
  advisoryHandler?: AdvisoryHandler,
  collectors?: StepLoopCollectors
): Promise<StepLoopResult> {
  for (const step of spell.steps) {
    if (ctx.executedSteps.includes(step.id)) {
      continue;
    }

    for (const depId of step.dependsOn) {
      if (!ctx.executedSteps.includes(depId)) {
        return {
          success: false,
          error: `Step '${step.id}' depends on '${depId}' which has not been executed`,
        };
      }
    }

    // In preview mode, action steps go through previewActionStep
    let result: StepResult;
    if (collectors?.isPreview && step.kind === "action") {
      const previewResult = await previewActionStep(step, ctx, ledger, actionExecution);
      result = previewResult.stepResult;
      if (previewResult.plannedAction) {
        collectors.plannedActions?.push(previewResult.plannedAction);
      }
      if (previewResult.valueDeltas?.length) {
        collectors.valueDeltas?.push(...previewResult.valueDeltas);
        for (const delta of previewResult.valueDeltas) {
          ledger.emit({ type: "value_delta", delta });
        }
      }
    } else if (collectors?.isPreview && step.kind === "advisory") {
      result = await executeAdvisoryStep(step, ctx, ledger, advisoryHandler);
      if (result.success) {
        collectors.advisoryResults?.push({
          stepId: step.id,
          advisor: step.advisor,
          output: result.output,
          fallback: result.fallback ?? false,
        });
      }
    } else {
      result = await executeStep(step, ctx, ledger, stepMap, actionExecution, advisoryHandler);
    }

    for (const childId of getChildStepIds(step)) {
      if (!ctx.executedSteps.includes(childId)) {
        markStepExecuted(ctx, childId);
      }
    }

    if (!result.success) {
      const loc = spell.sourceMap?.[step.id];
      if (loc) {
        enrichStepFailedEvents(ledger, step.id, loc);
      }
    }

    if (result.halted) {
      return { success: true, halted: true };
    }

    if (!result.success) {
      const onFailure = "onFailure" in step ? step.onFailure : "revert";
      const loc = spell.sourceMap?.[step.id];
      const locSuffix = loc ? ` at line ${loc.line}, column ${loc.column}` : "";

      switch (onFailure) {
        case "halt":
          return { success: false, error: `Step '${step.id}' failed${locSuffix}: ${result.error}` };
        case "revert":
          return { success: false, error: `Step '${step.id}' failed${locSuffix}: ${result.error}` };
        case "skip":
          ledger.emit({
            type: "step_skipped",
            stepId: step.id,
            reason: result.error ?? "Unknown error",
          });
          continue;
        case "catch":
          continue;
      }
    }

    markStepExecuted(ctx, step.id);
  }

  return { success: true };
}

// =============================================================================
// HELPERS
// =============================================================================

function convertPreviewToExecutionResult(
  previewResult: PreviewResult,
  _spell: SpellIR
): ExecutionResult {
  const receipt = previewResult.receipt;
  const now = Date.now();
  const startTime = receipt?.timestamp ?? now;

  return {
    success: previewResult.success,
    runId: receipt?.id.replace("rcpt_", "") ?? `preview_${now}`,
    startTime,
    endTime: now,
    duration: now - startTime,
    error: previewResult.error,
    metrics: receipt?.metrics ?? {
      stepsExecuted: 0,
      actionsExecuted: 0,
      gasUsed: 0n,
      advisoryCalls: 0,
      errors: 0,
      retries: 0,
    },
    finalState: receipt?.finalState ?? {},
    ledgerEvents: previewResult.ledgerEvents,
  };
}

function buildReceipt(opts: {
  id: string;
  spell: SpellIR;
  ctx: ExecutionContext;
  guardResults: GuardResult[];
  advisoryResults: AdvisoryResult[];
  plannedActions: PlannedAction[];
  valueDeltas: ValueDelta[];
  status: ReceiptStatus;
  error?: string;
}): Receipt {
  return {
    id: opts.id,
    spellId: opts.spell.id,
    phase: "preview",
    timestamp: Date.now(),
    chainContext: {
      chainId: opts.ctx.chain,
      vault: opts.ctx.vault,
    },
    guardResults: opts.guardResults,
    advisoryResults: opts.advisoryResults,
    plannedActions: opts.plannedActions,
    valueDeltas: opts.valueDeltas,
    constraintResults: [],
    driftKeys: [],
    requiresApproval: opts.plannedActions.length > 0,
    status: opts.status,
    metrics: { ...opts.ctx.metrics },
    finalState: getPersistentStateObject(opts.ctx),
    error: opts.error,
  };
}

function collectGuardResults(
  guardResults: GuardResult[],
  guards: GuardDef[],
  check: { success: boolean; error?: string; severity?: string }
): void {
  for (const guard of guards) {
    guardResults.push({
      guardId: guard.id,
      passed: check.success,
      severity: check.severity ?? ("severity" in guard ? String(guard.severity) : "warn"),
      message: check.success ? undefined : check.error,
    });
  }
}

function resolveExecutionMode(options: ExecuteOptions, simulate: boolean): ExecutionMode {
  if (options.executionMode) {
    return options.executionMode;
  }

  if (simulate) {
    return "simulate";
  }

  if (options.wallet) {
    return "execute";
  }

  return "simulate";
}

function createActionExecutionOptions(
  options: ExecuteOptions,
  mode: ExecutionMode,
  chainId: ChainId
): ActionExecutionOptions {
  if (mode === "simulate") {
    return { mode };
  }

  if (!options.wallet) {
    throw new Error("Wallet is required for non-simulated execution");
  }

  const provider = options.provider ?? createProvider(chainId, options.rpcUrl);
  const executor = createExecutor({
    wallet: options.wallet,
    provider,
    mode,
    gasMultiplier: options.gasMultiplier,
    confirmCallback: options.confirmCallback,
    progressCallback: options.progressCallback,
    skipTestnetConfirmation: options.skipTestnetConfirmation,
    adapters: options.adapters,
  });

  return { mode, executor };
}

function buildAdvisorTooling(
  advisors: AdvisorDef[],
  searchDirs?: string[]
): ExecutionContext["advisorTooling"] {
  if (!advisors.length) return undefined;

  const tooling: Record<string, { skills: string[]; allowedTools: string[]; mcp?: string[] }> = {};
  const dirs = (searchDirs ?? []).filter((dir) => dir.length > 0);

  for (const advisor of advisors) {
    const skills = advisor.skills ? [...advisor.skills] : [];
    const allowedTools = new Set(advisor.allowedTools ?? []);

    if (skills.length > 0 && dirs.length > 0) {
      for (const skillName of skills) {
        const meta = resolveAdvisorSkill(skillName, dirs);
        if (meta?.allowedTools?.length) {
          for (const tool of meta.allowedTools) {
            allowedTools.add(tool);
          }
        }
      }
    }

    if (skills.length > 0 || allowedTools.size > 0 || advisor.mcp?.length) {
      tooling[advisor.name] = {
        skills,
        allowedTools: Array.from(allowedTools),
        mcp: advisor.mcp,
      };
    }
  }

  return Object.keys(tooling).length > 0 ? tooling : undefined;
}

/**
 * Execute a single step
 */
async function executeStep(
  step: Step,
  ctx: ExecutionContext,
  ledger: InMemoryLedger,
  stepMap: Map<string, Step>,
  actionExecution: ActionExecutionOptions,
  advisoryHandler?: AdvisoryHandler,
  evalCtx?: EvalContext
): Promise<StepResult> {
  // Helper to execute steps by ID (for loops, conditionals, etc.)
  const executeStepById = async (
    stepId: string,
    ctx: ExecutionContext,
    innerEvalCtx?: EvalContext
  ): Promise<StepResult> => {
    const innerStep = stepMap.get(stepId);
    if (!innerStep) {
      return { success: false, stepId, error: `Unknown step: ${stepId}` };
    }
    return executeStep(
      innerStep,
      ctx,
      ledger,
      stepMap,
      actionExecution,
      advisoryHandler,
      innerEvalCtx
    );
  };

  switch (step.kind) {
    case "compute":
      return executeComputeStep(step, ctx, ledger);

    case "conditional": {
      const condResult = await executeConditionalStep(step, ctx, ledger);
      if (!condResult.success) {
        return condResult;
      }

      // Execute branch steps
      for (const branchStepId of condResult.branchSteps) {
        const branchResult = await executeStepById(branchStepId, ctx, evalCtx);
        if (!branchResult.success) {
          return branchResult;
        }
        if (branchResult.halted) {
          return branchResult;
        }
      }

      return condResult;
    }

    case "loop":
      return executeLoopStep(step, ctx, ledger, executeStepById);

    case "wait":
      return executeWaitStep(step, ctx, ledger);

    case "emit":
      return executeEmitStep(step, ctx, ledger);

    case "halt":
      return executeHaltStep(step, ctx, ledger);

    case "action":
      return executeActionStep(step, ctx, ledger, actionExecution);

    case "try":
      return executeTryStep(step, ctx, ledger, executeStepById);

    case "parallel":
      return executeParallelStep(step, ctx, ledger, executeStepById);

    case "pipeline":
      return executePipelineStep(step, ctx, ledger, executeStepById);

    case "advisory":
      return executeAdvisoryStep(step, ctx, ledger, advisoryHandler);

    default:
      return {
        success: false,
        stepId: (step as Step).id,
        error: `Unknown step kind: ${(step as Step).kind}`,
      };
  }
}

/**
 * Collect all child step IDs from container steps (try, loop, conditional)
 * so the main loop can skip them after the parent executes.
 */
function getChildStepIds(step: Step): string[] {
  switch (step.kind) {
    case "try":
      return [
        ...step.trySteps,
        ...step.catchBlocks.flatMap((cb) => cb.steps ?? []),
        ...(step.finallySteps ?? []),
      ];
    case "loop":
      return step.bodySteps;
    case "conditional":
      return [...step.thenSteps, ...step.elseSteps];
    case "parallel":
      return step.branches.flatMap((b) => b.steps);
    case "pipeline":
      return step.stages.filter((s) => "step" in s).map((s) => (s as { step: string }).step);
    default:
      return [];
  }
}

/**
 * Check guards
 */
async function checkGuards(
  guards: GuardDef[],
  ctx: ExecutionContext,
  ledger: InMemoryLedger
): Promise<{ success: boolean; error?: string; severity?: string }> {
  const evalCtx = createEvalContext(ctx);

  for (const guard of guards) {
    if ("advisor" in guard) {
      const tooling = ctx.advisorTooling?.[guard.advisor];
      const skills = tooling?.skills?.length ? tooling.skills : undefined;
      const allowedTools = tooling?.allowedTools?.length ? tooling.allowedTools : undefined;

      incrementAdvisoryCalls(ctx);
      ledger.emit({
        type: "advisory_started",
        stepId: guard.id,
        advisor: guard.advisor,
        prompt: guard.check,
        skills,
        allowedTools,
      });

      const decision = guard.fallback ?? true;

      ledger.emit({
        type: "advisory_completed",
        stepId: guard.id,
        advisor: guard.advisor,
        output: decision,
      });

      if (decision) {
        ledger.emit({ type: "guard_passed", guardId: guard.id });
      } else {
        const severity = guard.severity === "pause" ? "pause" : "warn";
        const message = `Advisory guard '${guard.id}' returned false`;
        ledger.emit({
          type: "guard_failed",
          guardId: guard.id,
          severity,
          message,
        });

        if (severity === "pause") {
          return { success: false, error: message, severity };
        }
      }
      continue;
    }

    const expressionGuard = guard as Guard;

    try {
      const result = await evaluateAsync(expressionGuard.check, evalCtx);
      const passed = Boolean(result);

      if (passed) {
        ledger.emit({ type: "guard_passed", guardId: guard.id });
      } else {
        ledger.emit({
          type: "guard_failed",
          guardId: guard.id,
          severity: expressionGuard.severity,
          message: expressionGuard.message,
        });

        if (expressionGuard.severity === "halt" || expressionGuard.severity === "revert") {
          return {
            success: false,
            error: expressionGuard.message,
            severity: expressionGuard.severity,
          };
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ledger.emit({
        type: "guard_failed",
        guardId: guard.id,
        severity: "error",
        message,
      });

      if (expressionGuard.severity === "halt") {
        return { success: false, error: message, severity: "halt" };
      }
    }
  }

  return { success: true };
}

/**
 * Enrich step_failed ledger events with source location info.
 */
function enrichStepFailedEvents(
  ledger: InMemoryLedger,
  stepId: string,
  loc: { line: number; column: number }
): void {
  const entries = ledger.getEntries();
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (!entry) continue;
    if (entry.event.type === "step_failed" && entry.event.stepId === stepId) {
      (entry.event as { line?: number; column?: number }).line = loc.line;
      (entry.event as { line?: number; column?: number }).column = loc.column;
      break;
    }
  }
}
