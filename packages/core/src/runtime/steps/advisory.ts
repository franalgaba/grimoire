/**
 * Advisory Step Executor
 * Uses fallback outputs (no tool execution yet).
 */

import type {
  AdvisorySchemaEvent,
  ExecutionContext,
  LedgerEvent,
  StepResult,
} from "../../types/execution.js";
import type { AdvisoryStep } from "../../types/steps.js";
import { incrementAdvisoryCalls, setBinding } from "../context.js";
import type { InMemoryLedger } from "../context.js";
import { createEvalContext, evaluateAsync } from "../expression-evaluator.js";

export interface AdvisoryHandlerInput {
  stepId: string;
  advisor: string;
  prompt: string;
  model?: string;
  outputSchema: AdvisoryStep["outputSchema"];
  timeout: number;
  skills?: string[];
  allowedTools?: string[];
  mcp?: string[];
  emit?: (event: LedgerEvent) => void;
  context: {
    params: Record<string, unknown>;
    bindings: Record<string, unknown>;
    state: {
      persistent: Record<string, unknown>;
      ephemeral: Record<string, unknown>;
    };
  };
}

export type AdvisoryHandler = (input: AdvisoryHandlerInput) => Promise<unknown>;

export async function executeAdvisoryStep(
  step: AdvisoryStep,
  ctx: ExecutionContext,
  ledger: InMemoryLedger,
  handler?: AdvisoryHandler
): Promise<StepResult> {
  ledger.emit({ type: "step_started", stepId: step.id, kind: "advisory" });
  const tooling = ctx.advisorTooling?.[step.advisor];
  const skills = tooling?.skills?.length ? tooling.skills : undefined;
  const allowedTools = tooling?.allowedTools?.length ? tooling.allowedTools : undefined;
  const mcp = tooling?.mcp?.length ? tooling.mcp : undefined;

  ledger.emit({
    type: "advisory_started",
    stepId: step.id,
    advisor: step.advisor,
    prompt: step.prompt,
    skills,
    allowedTools,
    mcp,
    schema: schemaToEvent(step.outputSchema),
  });
  incrementAdvisoryCalls(ctx);

  const advisorDef = ctx.spell.advisors.find((advisor) => advisor.name === step.advisor);
  const handlerInput: AdvisoryHandlerInput = {
    stepId: step.id,
    advisor: step.advisor,
    prompt: step.prompt,
    model: advisorDef?.model,
    outputSchema: step.outputSchema,
    timeout: step.timeout,
    skills,
    allowedTools,
    mcp,
    emit: (event) => ledger.emit(event),
    context: {
      params: buildParamsSnapshot(ctx),
      bindings: Object.fromEntries(ctx.bindings),
      state: {
        persistent: Object.fromEntries(ctx.state.persistent),
        ephemeral: Object.fromEntries(ctx.state.ephemeral),
      },
    },
  };

  let output: unknown;
  let usedFallback = false;

  try {
    if (handler) {
      const handlerOutput = await withTimeout(handler(handlerInput), step.timeout);
      output = coerceToSchema(handlerOutput, step.outputSchema);
    } else {
      const evalCtx = createEvalContext(ctx);
      const fallbackValue = await evaluateAsync(step.fallback, evalCtx);
      output = coerceToSchema(fallbackValue, step.outputSchema);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (handler) {
      let fallbackValue: unknown;
      try {
        const evalCtx = createEvalContext(ctx);
        fallbackValue = await evaluateAsync(step.fallback, evalCtx);
        output = coerceToSchema(fallbackValue, step.outputSchema);
        usedFallback = true;
        ledger.emit({
          type: "advisory_failed",
          stepId: step.id,
          advisor: step.advisor,
          error: message,
          fallback: fallbackValue,
        });
      } catch (fallbackError) {
        const fallbackMessage =
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        ledger.emit({
          type: "advisory_failed",
          stepId: step.id,
          advisor: step.advisor,
          error: fallbackMessage,
          fallback: fallbackValue,
        });
        ledger.emit({ type: "step_failed", stepId: step.id, error: fallbackMessage });
        return {
          success: false,
          stepId: step.id,
          error: fallbackMessage,
        };
      }
    } else {
      ledger.emit({
        type: "advisory_failed",
        stepId: step.id,
        advisor: step.advisor,
        error: message,
        fallback: undefined,
      });
      ledger.emit({ type: "step_failed", stepId: step.id, error: message });
      return {
        success: false,
        stepId: step.id,
        error: message,
      };
    }
  }

  setBinding(ctx, step.outputBinding, output);

  ledger.emit({ type: "advisory_completed", stepId: step.id, advisor: step.advisor, output });
  ledger.emit({ type: "step_completed", stepId: step.id, result: output });

  return {
    success: true,
    stepId: step.id,
    output,
    fallback: usedFallback || undefined,
  };
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

function buildParamsSnapshot(ctx: ExecutionContext): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const param of ctx.spell.params) {
    params[param.name] = ctx.bindings.get(param.name);
  }
  return params;
}

function withTimeout<T>(promise: Promise<T>, timeoutSeconds: number): Promise<T> {
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    const ms = timeoutSeconds * 1000;
    const timer = setTimeout(
      () => reject(new Error(`Advisory timed out after ${timeoutSeconds}s`)),
      ms
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
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
