/**
 * Emit Step Executor
 * Records an event to the ledger
 */

import type { ExecutionContext, StepResult } from "../../types/execution.js";
import type { EmitStep } from "../../types/steps.js";
import type { InMemoryLedger } from "../context.js";
import { createEvalContext, evaluateAsync } from "../expression-evaluator.js";

export async function executeEmitStep(
  step: EmitStep,
  ctx: ExecutionContext,
  ledger: InMemoryLedger
): Promise<StepResult> {
  ledger.emit({ type: "step_started", stepId: step.id, kind: "emit" });

  try {
    const evalCtx = createEvalContext(ctx);

    // Evaluate all data expressions
    const data: Record<string, unknown> = {};
    for (const [key, expr] of Object.entries(step.data)) {
      data[key] = await evaluateAsync(expr, evalCtx);
    }

    // Emit the custom event
    // Note: This is a user-defined event, not a system event
    // We log it as a step completion with the event data
    ledger.emit({
      type: "step_completed",
      stepId: step.id,
      result: {
        event: step.event,
        data: serializeData(data),
      },
    });

    return {
      success: true,
      stepId: step.id,
      output: { event: step.event, data },
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

/**
 * Serialize data for logging (handle bigint, etc.)
 */
function serializeData(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "bigint") {
      result[key] = value.toString();
    } else if (Array.isArray(value)) {
      result[key] = value.map((v) => (typeof v === "bigint" ? v.toString() : v));
    } else {
      result[key] = value;
    }
  }
  return result;
}
