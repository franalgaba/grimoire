/**
 * Advisory Step Executor
 * Uses fallback outputs (no tool execution yet).
 */

import type { AdvisorySchemaEvent, ExecutionContext, StepResult } from "../../types/execution.js";
import type { AdvisoryStep } from "../../types/steps.js";
import { incrementAdvisoryCalls, setBinding } from "../context.js";
import type { InMemoryLedger } from "../context.js";
import { createEvalContext, evaluateAsync } from "../expression-evaluator.js";

export async function executeAdvisoryStep(
  step: AdvisoryStep,
  ctx: ExecutionContext,
  ledger: InMemoryLedger
): Promise<StepResult> {
  ledger.emit({ type: "step_started", stepId: step.id, kind: "advisory" });
  const tooling = ctx.advisorTooling?.[step.advisor];
  const skills = tooling?.skills?.length ? tooling.skills : undefined;
  const allowedTools = tooling?.allowedTools?.length ? tooling.allowedTools : undefined;
  const mcp = tooling?.mcp?.length ? tooling.mcp : undefined;

  ledger.emit({
    type: "advisory_started",
    advisor: step.advisor,
    prompt: step.prompt,
    skills,
    allowedTools,
    mcp,
    schema: schemaToEvent(step.outputSchema),
  });
  incrementAdvisoryCalls(ctx);

  try {
    const evalCtx = createEvalContext(ctx);
    const fallbackValue = await evaluateAsync(step.fallback, evalCtx);
    const output = coerceToSchema(fallbackValue, step.outputSchema);

    setBinding(ctx, step.outputBinding, output);

    ledger.emit({ type: "advisory_completed", advisor: step.advisor, output });
    ledger.emit({ type: "step_completed", stepId: step.id, result: output });

    return {
      success: true,
      stepId: step.id,
      output,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    let fallbackOutput: unknown;
    try {
      const evalCtx = createEvalContext(ctx);
      fallbackOutput = await evaluateAsync(step.fallback, evalCtx);
    } catch {
      fallbackOutput = undefined;
    }

    ledger.emit({
      type: "advisory_failed",
      advisor: step.advisor,
      error: message,
      fallback: fallbackOutput,
    });
    ledger.emit({ type: "step_failed", stepId: step.id, error: message });

    return {
      success: false,
      stepId: step.id,
      error: message,
      output: fallbackOutput,
    };
  }
}

function coerceToSchema(value: unknown, schema: AdvisoryStep["outputSchema"]): unknown {
  if (schema.type === "boolean") {
    return Boolean(value);
  }

  if (schema.type === "number") {
    if (typeof value === "number") return value;
    const num = Number.parseFloat(String(value));
    return Number.isFinite(num) ? num : 0;
  }

  if (schema.type === "enum") {
    const values = schema.values ?? [];
    if (values.length === 0) return value;
    if (typeof value === "string" && values.includes(value)) return value;
    return values[0];
  }

  if (schema.type === "string") {
    return typeof value === "string" ? value : String(value);
  }

  if (schema.type === "object") {
    if (!schema.fields) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return value;
      }
      return {};
    }
    const result: Record<string, unknown> = {};
    const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    for (const [key, fieldSchema] of Object.entries(schema.fields)) {
      const fieldValue = (input as Record<string, unknown>)[key];
      result[key] = coerceToSchema(fieldValue, fieldSchema);
    }
    return result;
  }

  if (schema.type === "array") {
    if (!Array.isArray(value)) return [];
    if (!schema.items) return value;
    return value.map((item) => coerceToSchema(item, schema.items as AdvisoryStep["outputSchema"]));
  }

  return value;
}

function schemaToEvent(schema: AdvisoryStep["outputSchema"]): AdvisorySchemaEvent {
  switch (schema.type) {
    case "boolean":
      return { type: "boolean" };
    case "number":
      return { type: "number", min: schema.min, max: schema.max };
    case "enum":
      return { type: "enum", values: schema.values };
    case "string":
      return {
        type: "string",
        minLength: schema.minLength,
        maxLength: schema.maxLength,
        pattern: schema.pattern,
      };
    case "object":
      return {
        type: "object",
        fields: schema.fields
          ? Object.fromEntries(
              Object.entries(schema.fields).map(([key, value]) => [key, schemaToEvent(value)])
            )
          : undefined,
      };
    case "array":
      return {
        type: "array",
        items: schema.items ? schemaToEvent(schema.items) : undefined,
      };
  }
}
