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
    inputs?: Record<string, unknown>;
  };
}

export type AdvisoryHandler = (input: AdvisoryHandlerInput) => Promise<unknown>;

interface AdvisorySchemaViolation {
  path: string;
  message: string;
  actual?: unknown;
  expected?: unknown;
}

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
  let contextInputs: Record<string, unknown> | undefined;
  try {
    contextInputs = await resolveContextInputs(step, ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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
      inputs: contextInputs,
    },
  };

  const violationPolicy = step.violationPolicy ?? "reject";
  let rawOutput: unknown;
  let output: unknown;
  let clamped = false;
  let violations: AdvisorySchemaViolation[] = [];
  let usedFallback = false;

  try {
    if (handler) {
      rawOutput = await withTimeout(handler(handlerInput), step.timeout);
    } else {
      const evalCtx = createEvalContext(ctx);
      rawOutput = await evaluateAsync(step.fallback, evalCtx);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (handler) {
      let fallbackValue: unknown;
      try {
        const evalCtx = createEvalContext(ctx);
        fallbackValue = await evaluateAsync(step.fallback, evalCtx);
        rawOutput = fallbackValue;
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

  violations = validateAgainstSchema(rawOutput, step.outputSchema);
  if (violations.length > 0) {
    if (violationPolicy === "clamp") {
      const clampedOutput = coerceToSchema(rawOutput, step.outputSchema);
      const remainingViolations = validateAgainstSchema(clampedOutput, step.outputSchema);
      if (remainingViolations.length > 0) {
        const details = summarizeViolations(remainingViolations);
        const message = `Advisory output could not be clamped safely: ${details}`;
        ledger.emit({
          type: "advisory_failed",
          stepId: step.id,
          advisor: step.advisor,
          error: message,
          fallback: rawOutput,
        });
        ledger.emit({ type: "step_failed", stepId: step.id, error: message });
        return {
          success: false,
          stepId: step.id,
          error: message,
        };
      }
      output = clampedOutput;
      clamped = true;
    } else {
      const details = summarizeViolations(violations);
      const message = `Advisory output violated schema: ${details}`;
      ledger.emit({
        type: "advisory_failed",
        stepId: step.id,
        advisor: step.advisor,
        error: message,
        fallback: rawOutput,
      });
      ledger.emit({ type: "step_failed", stepId: step.id, error: message });
      return {
        success: false,
        stepId: step.id,
        error: message,
      };
    }
  } else {
    output = rawOutput;
  }

  setBinding(ctx, step.outputBinding, output);

  ledger.emit({
    type: "advisory_completed",
    stepId: step.id,
    advisor: step.advisor,
    output,
    rawOutput,
    effectiveOutput: output,
    onViolation: violationPolicy,
    policyScope: step.policyScope,
    clampConstraints: step.clampConstraints,
    clamped,
    violations: violations.length > 0 ? violations : undefined,
  });
  ledger.emit({ type: "step_completed", stepId: step.id, result: output });

  return {
    success: true,
    stepId: step.id,
    output,
    fallback: usedFallback || undefined,
    rawOutput,
    effectiveOutput: output,
    violationPolicy,
    clamped,
    advisoryViolations: violations.length > 0 ? violations : undefined,
  };
}

function coerceToSchema(value: unknown, schema: AdvisoryStep["outputSchema"]): unknown {
  if (schema.type === "boolean") {
    return Boolean(value);
  }

  if (schema.type === "number") {
    let num = typeof value === "number" ? value : Number.parseFloat(String(value));
    if (!Number.isFinite(num)) num = 0;
    if (typeof schema.min === "number" && num < schema.min) num = schema.min;
    if (typeof schema.max === "number" && num > schema.max) num = schema.max;
    return num;
  }

  if (schema.type === "enum") {
    const values = schema.values ?? [];
    if (values.length === 0) return value;
    if (typeof value === "string" && values.includes(value)) return value;
    return values[0];
  }

  if (schema.type === "string") {
    let next = typeof value === "string" ? value : String(value);
    if (typeof schema.maxLength === "number" && next.length > schema.maxLength) {
      next = next.slice(0, schema.maxLength);
    }
    return next;
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

function validateAgainstSchema(
  value: unknown,
  schema: AdvisoryStep["outputSchema"],
  path = "$"
): AdvisorySchemaViolation[] {
  const violations: AdvisorySchemaViolation[] = [];

  if (schema.type === "boolean") {
    if (typeof value !== "boolean") {
      violations.push({
        path,
        message: "Expected boolean",
        actual: typeof value,
        expected: "boolean",
      });
    }
    return violations;
  }

  if (schema.type === "number") {
    const num = Number.parseFloat(String(value));
    if (!Number.isFinite(num)) {
      violations.push({
        path,
        message: "Expected number",
        actual: value,
        expected: "number",
      });
      return violations;
    }
    if (typeof schema.min === "number" && num < schema.min) {
      violations.push({
        path,
        message: "Number below minimum",
        actual: num,
        expected: schema.min,
      });
    }
    if (typeof schema.max === "number" && num > schema.max) {
      violations.push({
        path,
        message: "Number above maximum",
        actual: num,
        expected: schema.max,
      });
    }
    return violations;
  }

  if (schema.type === "enum") {
    const values = schema.values ?? [];
    if (values.length === 0) return violations;
    if (typeof value !== "string" || !values.includes(value)) {
      violations.push({
        path,
        message: "Value is not part of enum",
        actual: value,
        expected: values,
      });
    }
    return violations;
  }

  if (schema.type === "string") {
    if (typeof value !== "string") {
      violations.push({
        path,
        message: "Expected string",
        actual: typeof value,
        expected: "string",
      });
      return violations;
    }
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      violations.push({
        path,
        message: "String shorter than minLength",
        actual: value.length,
        expected: schema.minLength,
      });
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      violations.push({
        path,
        message: "String longer than maxLength",
        actual: value.length,
        expected: schema.maxLength,
      });
    }
    if (schema.pattern) {
      try {
        const regex = new RegExp(schema.pattern);
        if (!regex.test(value)) {
          violations.push({
            path,
            message: "String does not match pattern",
            actual: value,
            expected: schema.pattern,
          });
        }
      } catch {
        violations.push({
          path,
          message: "Invalid regex pattern in schema",
          actual: schema.pattern,
          expected: schema.pattern,
        });
      }
    }
    return violations;
  }

  if (schema.type === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      violations.push({
        path,
        message: "Expected object",
        actual: value,
        expected: "object",
      });
      return violations;
    }

    if (!schema.fields) return violations;

    const input = value as Record<string, unknown>;
    for (const [key, fieldSchema] of Object.entries(schema.fields)) {
      const fieldPath = `${path}.${key}`;
      if (!(key in input)) {
        violations.push({
          path: fieldPath,
          message: "Missing required field",
          actual: undefined,
          expected: "defined",
        });
        continue;
      }
      violations.push(...validateAgainstSchema(input[key], fieldSchema, fieldPath));
    }
    return violations;
  }

  if (schema.type === "array") {
    if (!Array.isArray(value)) {
      violations.push({
        path,
        message: "Expected array",
        actual: value,
        expected: "array",
      });
      return violations;
    }
    if (!schema.items) return violations;

    for (let i = 0; i < value.length; i++) {
      violations.push(...validateAgainstSchema(value[i], schema.items, `${path}[${i}]`));
    }
    return violations;
  }

  return violations;
}

function summarizeViolations(violations: AdvisorySchemaViolation[]): string {
  if (violations.length === 0) {
    return "unknown schema mismatch";
  }

  return violations
    .slice(0, 3)
    .map((violation) => `${violation.path}: ${violation.message}`)
    .join("; ");
}

function buildParamsSnapshot(ctx: ExecutionContext): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const param of ctx.spell.params) {
    params[param.name] = ctx.bindings.get(param.name);
  }
  return params;
}

async function resolveContextInputs(
  step: AdvisoryStep,
  ctx: ExecutionContext
): Promise<Record<string, unknown> | undefined> {
  if (!step.context || Object.keys(step.context).length === 0) {
    return undefined;
  }

  const evalCtx = createEvalContext(ctx);
  const inputs: Record<string, unknown> = {};
  for (const [key, expr] of Object.entries(step.context)) {
    inputs[key] = await evaluateAsync(expr, evalCtx);
  }
  return inputs;
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
