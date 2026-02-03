/**
 * Loop Step Executor
 * Executes steps repeatedly based on loop type
 */

import type { ExecutionContext, StepResult } from "../../types/execution.js";
import type { LoopStep } from "../../types/steps.js";
import type { InMemoryLedger } from "../context.js";
import { type EvalContext, createEvalContext, evaluateAsync } from "../expression-evaluator.js";

export interface LoopResult extends StepResult {
  iterations: number;
  results: unknown[];
}

export async function executeLoopStep(
  step: LoopStep,
  ctx: ExecutionContext,
  ledger: InMemoryLedger,
  executeStepById: (
    stepId: string,
    ctx: ExecutionContext,
    evalCtx?: EvalContext
  ) => Promise<StepResult>
): Promise<LoopResult> {
  ledger.emit({ type: "step_started", stepId: step.id, kind: "loop" });

  const results: unknown[] = [];
  let iterations = 0;

  try {
    const evalCtx = createEvalContext(ctx);

    switch (step.loopType.type) {
      case "repeat": {
        // Fixed number of iterations
        const count = Math.min(step.loopType.count, step.maxIterations);

        for (let i = 0; i < count; i++) {
          evalCtx.index = i;
          iterations++;
          ctx.bindings.set("index", i);

          for (const bodyStepId of step.bodySteps) {
            const result = await executeStepById(bodyStepId, ctx, evalCtx);
            if (!result.success) {
              throw new Error(`Loop body step '${bodyStepId}' failed: ${result.error}`);
            }
            results.push(result.output);
          }
        }
        break;
      }

      case "for": {
        // Iterate over array
        const source = await evaluateAsync(step.loopType.source, evalCtx);
        if (!Array.isArray(source)) {
          throw new Error("For loop source must be an array");
        }

        const items = source.slice(0, step.maxIterations);

        for (let i = 0; i < items.length; i++) {
          evalCtx.item = items[i];
          evalCtx.index = i;
          iterations++;

          // Set loop variable in bindings
          ctx.bindings.set(step.loopType.variable, items[i]);
          ctx.bindings.set("item", items[i]);
          ctx.bindings.set("index", i);

          for (const bodyStepId of step.bodySteps) {
            const result = await executeStepById(bodyStepId, ctx, evalCtx);
            if (!result.success) {
              throw new Error(`Loop body step '${bodyStepId}' failed: ${result.error}`);
            }
            results.push(result.output);
          }
        }
        break;
      }

      case "until": {
        // Loop until condition is true
        while (iterations < step.maxIterations) {
          const condition = await evaluateAsync(step.loopType.condition, evalCtx);
          if (condition) {
            break;
          }

          evalCtx.index = iterations;
          iterations++;
          ctx.bindings.set("index", iterations - 1);

          for (const bodyStepId of step.bodySteps) {
            const result = await executeStepById(bodyStepId, ctx, evalCtx);
            if (!result.success) {
              throw new Error(`Loop body step '${bodyStepId}' failed: ${result.error}`);
            }
            results.push(result.output);
          }
        }
        break;
      }
    }

    // Store output if binding specified
    if (step.outputBinding) {
      ctx.bindings.set(step.outputBinding, results);
    }

    ledger.emit({
      type: "step_completed",
      stepId: step.id,
      result: { iterations, resultsCount: results.length },
    });

    return {
      success: true,
      stepId: step.id,
      iterations,
      results,
      output: results,
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
      iterations,
      results,
    };
  }
}
