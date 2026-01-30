/**
 * Try Step Executor
 * Implements try/catch/finally with retry logic and error classification
 */

import type { ExecutionContext, StepResult } from "../../types/execution.js";
import type { CatchBlock, TryStep } from "../../types/steps.js";
import {
  type InMemoryLedger,
  incrementErrors,
  incrementRetries,
  popFrame,
  pushFrame,
  setEphemeralState,
} from "../context.js";
import { classifyError, matchesCatchBlock } from "../error-classifier.js";
import type { EvalContext } from "../expression-evaluator.js";

/**
 * Calculate delay in milliseconds for retry backoff
 */
function calculateDelay(
  attempt: number,
  backoff: "none" | "linear" | "exponential",
  base: number,
  max: number
): number {
  if (backoff === "none") return 0;
  if (backoff === "linear") return Math.min(base * attempt, max);
  // exponential
  return Math.min(base * 2 ** (attempt - 1), max);
}

/**
 * Execute all steps in a block sequentially, returning the first failure or the last success.
 */
async function executeStepsSequentially(
  stepIds: string[],
  ctx: ExecutionContext,
  executeStepById: (
    stepId: string,
    ctx: ExecutionContext,
    evalCtx?: EvalContext
  ) => Promise<StepResult>
): Promise<StepResult> {
  let lastResult: StepResult = {
    success: true,
    stepId: stepIds[0] ?? "unknown",
  };

  for (const stepId of stepIds) {
    const result = await executeStepById(stepId, ctx);
    if (!result.success || result.halted) {
      return result;
    }
    lastResult = result;
  }

  return lastResult;
}

/**
 * Execute a try/catch/finally step
 */
export async function executeTryStep(
  step: TryStep,
  ctx: ExecutionContext,
  ledger: InMemoryLedger,
  executeStepById: (
    stepId: string,
    ctx: ExecutionContext,
    evalCtx?: EvalContext
  ) => Promise<StepResult>
): Promise<StepResult> {
  ledger.emit({ type: "step_started", stepId: step.id, kind: "try" });
  pushFrame(ctx, step.id);

  let result: StepResult = { success: true, stepId: step.id };

  try {
    // --- TRY BLOCK ---
    const tryResult = await executeStepsSequentially(step.trySteps, ctx, executeStepById);

    if (tryResult.success && !tryResult.halted) {
      // Try block succeeded
      result = { success: true, stepId: step.id, output: tryResult.output };
    } else if (tryResult.halted) {
      // Propagate halt without catching
      result = { success: true, stepId: step.id, halted: true };
    } else {
      // --- TRY FAILED → FIND MATCHING CATCH ---
      const errorMessage = tryResult.error ?? "Unknown error";
      const errorType = classifyError(errorMessage);
      incrementErrors(ctx);

      const matchingCatch = step.catchBlocks.find((cb) =>
        matchesCatchBlock(errorType, cb.errorType)
      );

      if (!matchingCatch) {
        // No catch block matched
        result = {
          success: false,
          stepId: step.id,
          error: errorMessage,
        };
      } else {
        // Emit error_caught event
        ledger.emit({
          type: "error_caught",
          stepId: step.id,
          errorType: errorType ?? "unknown",
          handler: matchingCatch.errorType === "*" ? "wildcard" : matchingCatch.errorType,
        });

        // Handle the catch block
        result = await handleCatchBlock(
          matchingCatch,
          step,
          ctx,
          ledger,
          executeStepById,
          errorMessage
        );
      }
    }
  } catch (error) {
    // Unexpected exception during try execution
    const errorMessage = error instanceof Error ? error.message : String(error);
    incrementErrors(ctx);

    const errorType = classifyError(errorMessage);
    const matchingCatch = step.catchBlocks.find((cb) => matchesCatchBlock(errorType, cb.errorType));

    if (!matchingCatch) {
      result = { success: false, stepId: step.id, error: errorMessage };
    } else {
      ledger.emit({
        type: "error_caught",
        stepId: step.id,
        errorType: errorType ?? "unknown",
        handler: matchingCatch.errorType === "*" ? "wildcard" : matchingCatch.errorType,
      });

      result = await handleCatchBlock(
        matchingCatch,
        step,
        ctx,
        ledger,
        executeStepById,
        errorMessage
      );
    }
  }

  // --- FINALLY BLOCK ---
  if (step.finallySteps && step.finallySteps.length > 0) {
    try {
      const finallyResult = await executeStepsSequentially(step.finallySteps, ctx, executeStepById);

      if (!finallyResult.success) {
        // Finally failure supersedes the try/catch result
        result = {
          success: false,
          stepId: step.id,
          error: finallyResult.error ?? "Finally block failed",
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result = {
        success: false,
        stepId: step.id,
        error: `Finally block failed: ${message}`,
      };
    }
  }

  // Emit completion/failure event
  if (result.success) {
    ledger.emit({
      type: "step_completed",
      stepId: step.id,
      result: { output: result.output, halted: result.halted, skipped: result.skipped },
    });
  } else {
    ledger.emit({
      type: "step_failed",
      stepId: step.id,
      error: result.error ?? "Unknown error",
    });
  }

  popFrame(ctx);
  return result;
}

/**
 * Handle a matched catch block: retry logic, catch steps, or action
 */
async function handleCatchBlock(
  catchBlock: CatchBlock,
  step: TryStep,
  ctx: ExecutionContext,
  ledger: InMemoryLedger,
  executeStepById: (
    stepId: string,
    ctx: ExecutionContext,
    evalCtx?: EvalContext
  ) => Promise<StepResult>,
  _errorMessage: string
): Promise<StepResult> {
  // --- RETRY LOGIC ---
  if (catchBlock.retry) {
    const {
      maxAttempts,
      backoff,
      backoffBase = 1000,
      maxBackoff = 30000,
      modifyOnRetry,
    } = catchBlock.retry;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Apply delay before retry
      const delay = calculateDelay(attempt, backoff, backoffBase, maxBackoff);
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      // Apply slippage modification if configured
      if (modifyOnRetry?.slippage) {
        const currentIncrease = modifyOnRetry.slippage.increase * attempt;
        setEphemeralState(ctx, `_retry_slippage_bps_${step.id}`, currentIncrease);
      }

      incrementRetries(ctx);
      ledger.emit({
        type: "retry_attempted",
        stepId: step.id,
        attempt,
      });

      const retryResult = await executeStepsSequentially(step.trySteps, ctx, executeStepById);

      if (retryResult.success) {
        ledger.emit({
          type: "retry_succeeded",
          stepId: step.id,
          attempt,
        });
        return {
          success: true,
          stepId: step.id,
          output: retryResult.output,
        };
      }
    }

    // Retries exhausted
    ledger.emit({
      type: "retry_exhausted",
      stepId: step.id,
      attempts: maxAttempts,
    });

    // Fall through to action or catch steps if present
  }

  // --- CATCH STEPS ---
  if (catchBlock.steps && catchBlock.steps.length > 0) {
    const catchResult = await executeStepsSequentially(catchBlock.steps, ctx, executeStepById);
    if (!catchResult.success) {
      return {
        success: false,
        stepId: step.id,
        error: catchResult.error ?? "Catch block steps failed",
      };
    }
  }

  // --- CATCH ACTION ---
  if (catchBlock.action) {
    switch (catchBlock.action) {
      case "skip":
        return { success: true, stepId: step.id, skipped: true };
      case "halt":
        return { success: true, stepId: step.id, halted: true };
      case "rollback":
        return {
          success: false,
          stepId: step.id,
          error: "Rollback requested",
        };
    }
  }

  // If catch had retry that was exhausted but no action/steps to fall back on
  if (catchBlock.retry) {
    return {
      success: false,
      stepId: step.id,
      error: `Retries exhausted after ${catchBlock.retry.maxAttempts} attempts`,
    };
  }

  // Catch block matched and handled (steps ran successfully, no action)
  return { success: true, stepId: step.id };
}
