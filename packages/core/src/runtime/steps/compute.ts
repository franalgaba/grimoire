/**
 * Compute Step Executor
 * Evaluates expressions and stores results in bindings
 */

import type { ExecutionContext, StepResult } from "../../types/execution.js";
import type { ComputeStep } from "../../types/steps.js";
import { setBinding } from "../context.js";
import type { InMemoryLedger } from "../context.js";
import { createEvalContext, evaluateAsync } from "../expression-evaluator.js";

export async function executeComputeStep(
  step: ComputeStep,
  ctx: ExecutionContext,
  ledger: InMemoryLedger
): Promise<StepResult> {
  ledger.emit({ type: "step_started", stepId: step.id, kind: "compute" });

  try {
    const evalCtx = createEvalContext(ctx);

    // Evaluate each assignment in order
    for (const { variable, expression } of step.assignments) {
      const value = await evaluateAsync(expression, evalCtx);

      // Store in bindings
      setBinding(ctx, variable, value);

      // Also update evalCtx bindings for subsequent expressions
      evalCtx.bindings.set(variable, value);

      // Log binding
      ledger.emit({
        type: "binding_set",
        name: variable,
        value: serializeValue(value),
      });
    }

    ledger.emit({
      type: "step_completed",
      stepId: step.id,
      result: {
        assignments: step.assignments.map((a) => ({
          variable: a.variable,
          value: serializeValue(ctx.bindings.get(a.variable)),
        })),
      },
    });

    return {
      success: true,
      stepId: step.id,
      output: Object.fromEntries(
        step.assignments.map((a) => [a.variable, ctx.bindings.get(a.variable)])
      ),
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
 * Serialize a value for logging (handle bigint, etc.)
 */
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
