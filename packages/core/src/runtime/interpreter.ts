/**
 * Spell Interpreter
 * Executes compiled SpellIR
 */

import type { ExecutionContext, ExecutionResult, StepResult } from "../types/execution.js";
import type { Guard, GuardDef, SpellIR } from "../types/ir.js";
import type { Address, ChainId } from "../types/primitives.js";
import type { Step } from "../types/steps.js";
import {
  InMemoryLedger,
  createContext,
  getPersistentStateObject,
  markStepExecuted,
} from "./context.js";
import { type EvalContext, createEvalContext, evaluateAsync } from "./expression-evaluator.js";

// Step executors
import { executeComputeStep } from "./steps/compute.js";
import { executeConditionalStep } from "./steps/conditional.js";
import { executeEmitStep } from "./steps/emit.js";
import { executeHaltStep } from "./steps/halt.js";
import { executeLoopStep } from "./steps/loop.js";
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
}

/**
 * Execute a compiled spell
 */
export async function execute(options: ExecuteOptions): Promise<ExecutionResult> {
  const { spell, vault, chain, params = {}, persistentState = {}, simulate = false } = options;

  // Create execution context
  const ctx = createContext({
    spell,
    vault,
    chain,
    params,
    persistentState,
  });

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
      // Check dependencies
      for (const depId of step.dependsOn) {
        if (!ctx.executedSteps.includes(depId)) {
          throw new Error(`Step '${step.id}' depends on '${depId}' which has not been executed`);
        }
      }

      // Execute step
      const result = await executeStep(step, ctx, ledger, stepMap, simulate);

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

        switch (onFailure) {
          case "halt":
            throw new Error(`Step '${step.id}' failed: ${result.error}`);
          case "revert":
            throw new Error(`Step '${step.id}' failed: ${result.error}`);
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

/**
 * Execute a single step
 */
async function executeStep(
  step: Step,
  ctx: ExecutionContext,
  ledger: InMemoryLedger,
  stepMap: Map<string, Step>,
  _simulate: boolean,
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
    return executeStep(innerStep, ctx, ledger, stepMap, _simulate, innerEvalCtx);
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

    case "action": {
      // For now, log that we would execute the action (simulation mode)
      ledger.emit({ type: "step_started", stepId: step.id, kind: "action" });

      // TODO: Implement actual action execution with calldata builders
      ledger.emit({
        type: "step_completed",
        stepId: step.id,
        result: {
          simulated: true,
          action: step.action.type,
          venue: "venue" in step.action ? step.action.venue : undefined,
        },
      });

      return {
        success: true,
        stepId: step.id,
        output: { simulated: true, action: step.action },
      };
    }

    case "parallel":
    case "pipeline":
    case "try":
    case "advisory":
      // TODO: Implement these step types
      ledger.emit({ type: "step_started", stepId: step.id, kind: step.kind });
      ledger.emit({
        type: "step_completed",
        stepId: step.id,
        result: { notImplemented: true },
      });
      return {
        success: true,
        stepId: step.id,
        output: { notImplemented: true },
      };

    default:
      return {
        success: false,
        stepId: (step as Step).id,
        error: `Unknown step kind: ${(step as Step).kind}`,
      };
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
    // Skip advisory guards for now
    if ("advisor" in guard) {
      ledger.emit({ type: "guard_passed", guardId: guard.id });
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
