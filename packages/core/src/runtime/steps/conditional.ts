/**
 * Conditional Step Executor
 * Evaluates condition and executes appropriate branch
 */

import type { ExecutionContext, StepResult } from "../../types/execution.js";
import type { ConditionalStep } from "../../types/steps.js";
import type { InMemoryLedger } from "../context.js";
import { createEvalContext, evaluateAsync } from "../expression-evaluator.js";

export interface ConditionalResult extends StepResult {
  condition: boolean;
  executedBranch: "then" | "else" | "none";
  branchSteps: string[];
}

export async function executeConditionalStep(
  step: ConditionalStep,
  ctx: ExecutionContext,
  ledger: InMemoryLedger
): Promise<ConditionalResult> {
  ledger.emit({ type: "step_started", stepId: step.id, kind: "conditional" });

  try {
    const evalCtx = createEvalContext(ctx);

    // Evaluate condition
    const conditionValue = await evaluateAsync(step.condition, evalCtx);
    const condition = Boolean(conditionValue);

    // Determine which branch to execute
    let executedBranch: "then" | "else" | "none";
    let branchSteps: string[];

    if (condition) {
      executedBranch = step.thenSteps.length > 0 ? "then" : "none";
      branchSteps = step.thenSteps;
    } else {
      executedBranch = step.elseSteps.length > 0 ? "else" : "none";
      branchSteps = step.elseSteps;
    }

    ledger.emit({
      type: "step_completed",
      stepId: step.id,
      result: {
        condition,
        executedBranch,
        branchSteps,
      },
    });

    return {
      success: true,
      stepId: step.id,
      condition,
      executedBranch,
      branchSteps,
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
      condition: false,
      executedBranch: "none",
      branchSteps: [],
    };
  }
}
