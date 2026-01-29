/**
 * Halt Step Executor
 * Stops execution immediately
 */

import type { ExecutionContext, StepResult } from "../../types/execution.js";
import type { HaltStep } from "../../types/steps.js";
import type { InMemoryLedger } from "../context.js";

export async function executeHaltStep(
  step: HaltStep,
  _ctx: ExecutionContext,
  ledger: InMemoryLedger
): Promise<StepResult> {
  ledger.emit({ type: "step_started", stepId: step.id, kind: "halt" });

  ledger.emit({
    type: "step_completed",
    stepId: step.id,
    result: { halted: true, reason: step.reason },
  });

  return {
    success: true,
    stepId: step.id,
    halted: true,
    output: { reason: step.reason },
  };
}
