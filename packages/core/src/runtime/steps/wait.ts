/**
 * Wait Step Executor
 * Pauses execution for a specified duration
 */

import type { ExecutionContext, StepResult } from "../../types/execution.js";
import type { WaitStep } from "../../types/steps.js";
import type { InMemoryLedger } from "../context.js";

export async function executeWaitStep(
  step: WaitStep,
  _ctx: ExecutionContext,
  ledger: InMemoryLedger
): Promise<StepResult> {
  ledger.emit({ type: "step_started", stepId: step.id, kind: "wait" });

  try {
    // Wait for the specified duration (in seconds)
    await sleep(step.duration * 1000);

    ledger.emit({
      type: "step_completed",
      stepId: step.id,
      result: { waitedSeconds: step.duration },
    });

    return {
      success: true,
      stepId: step.id,
      output: { waited: step.duration },
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
