/**
 * Pipeline Step Executor
 * Applies map/filter/reduce stages sequentially.
 */

import type { ExecutionContext, StepResult } from "../../types/execution.js";
import type { PipelineStep } from "../../types/steps.js";
import type { InMemoryLedger } from "../context.js";
import { createEvalContext, evaluateAsync } from "../expression-evaluator.js";

export async function executePipelineStep(
  step: PipelineStep,
  ctx: ExecutionContext,
  ledger: InMemoryLedger,
  executeStepById: (stepId: string, ctx: ExecutionContext) => Promise<StepResult>
): Promise<StepResult> {
  ledger.emit({ type: "step_started", stepId: step.id, kind: "pipeline" });

  try {
    const evalCtx = createEvalContext(ctx);
    const sourceVal = await evaluateAsync(step.source, evalCtx);
    if (!Array.isArray(sourceVal)) {
      throw new Error("Pipeline source must be an array");
    }

    let items: unknown[] = [...sourceVal];

    for (const stage of step.stages) {
      if (stage.op === "take") {
        items = items.slice(0, stage.count);
        continue;
      }
      if (stage.op === "skip") {
        items = items.slice(stage.count);
        continue;
      }
      if (stage.op === "sort") {
        items = await sortItems(items, stage, ctx);
        continue;
      }

      if (stage.op === "filter") {
        const filtered: unknown[] = [];
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          ctx.bindings.set("item", item);
          ctx.bindings.set("index", i);
          const result = await executeStepById(stage.step, ctx);
          if (!result.success) {
            throw new Error(result.error ?? "Pipeline filter step failed");
          }
          const value = extractOutput(result.output);
          if (value) filtered.push(item);
        }
        items = filtered;
        continue;
      }

      if (stage.op === "where") {
        const filtered: unknown[] = [];
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          ctx.bindings.set("item", item);
          ctx.bindings.set("index", i);
          const predicate = await evaluateAsync(stage.predicate, evalCtx);
          if (predicate) {
            filtered.push(item);
          }
        }
        items = filtered;
        continue;
      }

      if (stage.op === "map") {
        const mapped: unknown[] = [];
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          ctx.bindings.set("item", item);
          ctx.bindings.set("index", i);
          const result = await executeStepById(stage.step, ctx);
          if (!result.success) {
            throw new Error(result.error ?? "Pipeline map step failed");
          }
          mapped.push(extractOutput(result.output));
        }
        items = mapped;
        continue;
      }

      if (stage.op === "reduce") {
        let acc: unknown = await evaluateAsync(stage.initial, evalCtx);
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          ctx.bindings.set("item", item);
          ctx.bindings.set("index", i);
          ctx.bindings.set("acc", acc);
          const result = await executeStepById(stage.step, ctx);
          if (!result.success) {
            throw new Error(result.error ?? "Pipeline reduce step failed");
          }
          acc = extractOutput(result.output);
        }
        items = [acc];
      }
    }

    if (step.outputBinding) {
      ctx.bindings.set(step.outputBinding, items);
    }

    ledger.emit({ type: "step_completed", stepId: step.id, result: { count: items.length } });
    return { success: true, stepId: step.id, output: items };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ledger.emit({ type: "step_failed", stepId: step.id, error: message });
    return { success: false, stepId: step.id, error: message };
  }
}

async function sortItems(
  items: unknown[],
  stage: Extract<PipelineStep["stages"][number], { op: "sort" }>,
  ctx: ExecutionContext
): Promise<unknown[]> {
  const evalCtx = createEvalContext(ctx);
  const annotated: Array<{ item: unknown; key: number }> = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    ctx.bindings.set("item", item);
    ctx.bindings.set("index", i);
    const keyVal = await evaluateAsync(stage.by, evalCtx);
    const keyNum = typeof keyVal === "number" ? keyVal : Number.parseFloat(String(keyVal));
    annotated.push({ item, key: Number.isFinite(keyNum) ? keyNum : 0 });
  }

  annotated.sort((a, b) => (stage.order === "desc" ? b.key - a.key : a.key - b.key));
  return annotated.map((a) => a.item);
}

function extractOutput(output: unknown): unknown {
  if (output && typeof output === "object" && !Array.isArray(output)) {
    const entries = Object.entries(output as Record<string, unknown>);
    if (entries.length === 1) {
      return entries[0]?.[1];
    }
  }
  return output;
}
