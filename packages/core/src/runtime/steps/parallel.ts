/**
 * Parallel Step Executor
 * Executes branches sequentially (deterministic baseline).
 */

import type { ExecutionContext, StepResult } from "../../types/execution.js";
import type { ParallelStep } from "../../types/steps.js";
import type { InMemoryLedger } from "../context.js";

export async function executeParallelStep(
  step: ParallelStep,
  ctx: ExecutionContext,
  ledger: InMemoryLedger,
  executeStepById: (stepId: string, ctx: ExecutionContext) => Promise<StepResult>
): Promise<StepResult> {
  ledger.emit({ type: "step_started", stepId: step.id, kind: "parallel" });

  const results: Record<string, unknown> = {};
  const branchOutputs: Array<{ name: string; output: unknown; success: boolean }> = [];

  const targetCount =
    step.join.type === "any"
      ? step.join.count
      : step.join.type === "majority"
        ? undefined
        : undefined;

  let successCount = 0;
  let completed = 0;

  for (const branch of step.branches) {
    let lastOutput: unknown;
    let branchSuccess = true;

    for (const branchStepId of branch.steps) {
      const result = await executeStepById(branchStepId, ctx);
      if (!result.success) {
        branchSuccess = false;
        if (step.onFail === "abort") {
          ledger.emit({
            type: "step_failed",
            stepId: step.id,
            error: result.error ?? "parallel branch failed",
          });
          return { success: false, stepId: step.id, error: result.error };
        }
        break;
      }
      if (result.halted) {
        return result;
      }
      lastOutput = result.output;
    }

    results[branch.name] = lastOutput;
    branchOutputs.push({ name: branch.name, output: lastOutput, success: branchSuccess });
    if (branchSuccess) successCount++;
    completed++;

    if (step.join.type === "first" && branchSuccess) {
      break;
    }
    if (step.join.type === "any" && targetCount && successCount >= targetCount) {
      break;
    }
  }

  const output = selectJoinOutput(step, results, branchOutputs);

  if (step.outputBinding) {
    ctx.bindings.set(step.outputBinding, output);
  }

  ledger.emit({
    type: "step_completed",
    stepId: step.id,
    result: { branches: completed, success: successCount },
  });

  return {
    success: true,
    stepId: step.id,
    output,
  };
}

function selectJoinOutput(
  step: ParallelStep,
  results: Record<string, unknown>,
  branchOutputs: Array<{ name: string; output: unknown; success: boolean }>
): unknown {
  if (step.join.type === "all") {
    return results;
  }

  if (step.join.type === "first" || step.join.type === "any" || step.join.type === "majority") {
    const winner = branchOutputs.find((b) => b.success) ?? branchOutputs[0];
    return winner ? { branch: winner.name, output: winner.output } : undefined;
  }

  if (step.join.type === "best") {
    const order = step.join.order ?? "max";
    let best = branchOutputs[0];
    for (const b of branchOutputs) {
      const aVal = typeof best?.output === "number" ? (best.output as number) : 0;
      const bVal = typeof b.output === "number" ? (b.output as number) : 0;
      if (order === "max" ? bVal > aVal : bVal < aVal) {
        best = b;
      }
    }
    return best ? { branch: best.name, output: best.output } : undefined;
  }

  return results;
}
