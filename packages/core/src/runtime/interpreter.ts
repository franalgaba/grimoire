/**
 * Spell Interpreter
 * Executes compiled SpellIR
 */

import type { ExecutionContext, ExecutionResult, StepResult } from "../types/execution.js";
import type { AdvisorDef, Guard, GuardDef, SpellIR } from "../types/ir.js";
import type { PolicySet } from "../types/policy.js";
import type { Address, ChainId } from "../types/primitives.js";
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
import { type ActionExecutionOptions, executeActionStep } from "./steps/action.js";
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

/**
 * Execute a compiled spell
 */
export async function execute(options: ExecuteOptions): Promise<ExecutionResult> {
  const { spell, vault, chain, params = {}, persistentState = {}, simulate = false } = options;

  const actionMode = resolveExecutionMode(options, simulate);
  const actionExecution = createActionExecutionOptions(options, actionMode, chain);

  // Initialize circuit breaker manager if policy has breakers
  if (options.policy?.circuitBreakers?.length) {
    actionExecution.circuitBreakerManager = new CircuitBreakerManager(
      options.policy.circuitBreakers
    );
  }

  // Create execution context
  const ctx = createContext({
    spell,
    vault,
    chain,
    params,
    persistentState,
  });
  ctx.advisorTooling = buildAdvisorTooling(spell.advisors, options.advisorSkillsDirs);

  // Create ledger
  const ledger = new InMemoryLedger(ctx.runId, spell.id);

  // Log run start
  ledger.emit({
    type: "run_started",
    runId: ctx.runId,
    spellId: spell.id,
    trigger: ctx.trigger,
  });

  try {
    // Check pre-execution guards
    const guardResult = await checkGuards(spell.guards, ctx, ledger);
    if (!guardResult.success) {
      throw new Error(`Guard failed: ${guardResult.error}`);
    }

    // Build step map for quick lookup
    const stepMap = new Map(spell.steps.map((s) => [s.id, s]));

    // Execute steps in order (topological sort would be ideal, but for now sequential)
    for (const step of spell.steps) {
      // Skip steps already executed by a parent (try/loop/conditional)
      if (ctx.executedSteps.includes(step.id)) {
        continue;
      }

      // Check dependencies
      for (const depId of step.dependsOn) {
        if (!ctx.executedSteps.includes(depId)) {
          throw new Error(`Step '${step.id}' depends on '${depId}' which has not been executed`);
        }
      }

      // Execute step
      const result = await executeStep(
        step,
        ctx,
        ledger,
        stepMap,
        actionExecution,
        options.onAdvisory
      );

      // Mark all child steps of container steps (try/loop/conditional) as executed
      // so the main loop doesn't re-execute them standalone
      for (const childId of getChildStepIds(step)) {
        if (!ctx.executedSteps.includes(childId)) {
          markStepExecuted(ctx, childId);
        }
      }

      // Enrich step_failed ledger events with source location
      if (!result.success) {
        const loc = spell.sourceMap?.[step.id];
        if (loc) {
          enrichStepFailedEvents(ledger, step.id, loc);
        }
      }

      // Handle halt
      if (result.halted) {
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

      // Handle failure
      if (!result.success) {
        const onFailure = "onFailure" in step ? step.onFailure : "revert";
        const loc = spell.sourceMap?.[step.id];
        const locSuffix = loc ? ` at line ${loc.line}, column ${loc.column}` : "";

        switch (onFailure) {
          case "halt":
            throw new Error(`Step '${step.id}' failed${locSuffix}: ${result.error}`);
          case "revert":
            throw new Error(`Step '${step.id}' failed${locSuffix}: ${result.error}`);
          case "skip":
            ledger.emit({
              type: "step_skipped",
              stepId: step.id,
              reason: result.error ?? "Unknown error",
            });
            continue;
          case "catch":
            // Would be handled by try/catch step
            continue;
        }
      }

      markStepExecuted(ctx, step.id);
    }

    // Check post-execution guards
    const postGuardResult = await checkGuards(spell.guards, ctx, ledger);
    if (!postGuardResult.success && postGuardResult.severity === "halt") {
      throw new Error(`Post-execution guard failed: ${postGuardResult.error}`);
    }

    // Log run completion
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

    ledger.emit({
      type: "run_failed",
      runId: ctx.runId,
      error: message,
    });

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
 * Scans recent events to find step_failed events for the given stepId
 * and adds line/column from the source map.
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
