/**
 * IR Generator
 * Transforms SpellSource AST into SpellIR
 */

import type { Action, ActionConstraints } from "../types/actions.js";
import type { Expression } from "../types/expressions.js";
import type {
  AdvisorDef,
  CompilationError,
  CompilationWarning,
  GuardDef,
  SkillDef,
  SpellIR,
  SpellSource,
} from "../types/ir.js";
import type {
  Address,
  AssetDef,
  ParamDef,
  StateField,
  Trigger,
  VenueAlias,
} from "../types/primitives.js";
import type {
  ActionStep,
  CatchBlock,
  ComputeStep,
  ConditionalStep,
  ErrorType,
  LoopStep,
  Step,
  TryStep,
} from "../types/steps.js";
import { parseExpression } from "./expression-parser.js";

export interface IRGeneratorResult {
  success: boolean;
  ir?: SpellIR;
  errors: CompilationError[];
  warnings: CompilationWarning[];
}

/**
 * Generate IR from parsed SpellSource
 */
export function generateIR(source: SpellSource): IRGeneratorResult {
  const errors: CompilationError[] = [];
  const warnings: CompilationWarning[] = [];

  // Generate unique ID and hash
  const id = source.spell;
  const hash = generateHash(JSON.stringify(source));

  // Transform venues
  const aliases: VenueAlias[] = [];
  if (source.venues) {
    for (const [alias, venue] of Object.entries(source.venues)) {
      aliases.push({
        alias,
        chain: venue.chain,
        address: venue.address as Address,
        label: venue.label,
      });
    }
  }

  // Transform assets
  const assets: AssetDef[] = [];
  if (source.assets) {
    for (const [symbol, asset] of Object.entries(source.assets)) {
      assets.push({
        symbol,
        chain: asset.chain,
        address: asset.address as Address,
        decimals: asset.decimals,
      });
    }
  }

  // Transform params
  const params: ParamDef[] = [];
  if (source.params) {
    for (const [name, value] of Object.entries(source.params)) {
      if (typeof value === "object" && value !== null && "type" in value) {
        const extended = value as { type?: string; default?: unknown; min?: number; max?: number };
        params.push({
          name,
          type: (extended.type ?? "number") as ParamDef["type"],
          default: extended.default,
          min: extended.min,
          max: extended.max,
        });
      } else {
        // Simple form - infer type from value
        params.push({
          name,
          type: inferType(value),
          default: value,
        });
      }
    }
  }

  // Transform state
  const state = {
    persistent: {} as Record<string, StateField>,
    ephemeral: {} as Record<string, StateField>,
  };
  if (source.state?.persistent) {
    for (const [key, value] of Object.entries(source.state.persistent)) {
      state.persistent[key] = { key, initialValue: value };
    }
  }
  if (source.state?.ephemeral) {
    for (const [key, value] of Object.entries(source.state.ephemeral)) {
      state.ephemeral[key] = { key, initialValue: value };
    }
  }

  // Transform skills
  const skills: SkillDef[] = [];
  if (source.skills) {
    for (const [name, skill] of Object.entries(source.skills)) {
      skills.push({
        name,
        type: skill.type as SkillDef["type"],
        adapters: skill.adapters,
        defaultConstraints: skill.default_constraints
          ? { maxSlippage: skill.default_constraints.max_slippage }
          : undefined,
      });
    }
  }

  // Transform advisors
  const advisors: AdvisorDef[] = [];
  if (source.advisors) {
    for (const [name, advisor] of Object.entries(source.advisors)) {
      advisors.push({
        name,
        model: advisor.model as AdvisorDef["model"],
        scope: "read-only",
        systemPrompt: advisor.system_prompt,
        rateLimit: advisor.rate_limit
          ? {
              maxCallsPerRun: advisor.rate_limit.max_per_run ?? 10,
              maxCallsPerHour: advisor.rate_limit.max_per_hour ?? 100,
            }
          : undefined,
      });
    }
  }

  // Transform triggers
  const triggers: Trigger[] = [];
  if (source.trigger) {
    const trigger = transformTrigger(source.trigger);
    if (trigger) {
      triggers.push(trigger);
    }
  } else {
    // Default to manual trigger
    triggers.push({ type: "manual" });
  }

  // Transform steps and build source map
  const steps: Step[] = [];
  const stepIds = new Set<string>();
  const sourceMap: Record<string, { line: number; column: number }> = {};

  if (source.steps) {
    for (const rawStep of source.steps) {
      try {
        const step = transformStep(rawStep, stepIds, errors);
        if (step) {
          steps.push(step);
          stepIds.add(step.id);

          // Extract source location from transformer metadata
          const loc = rawStep._sourceLocation as { line: number; column: number } | undefined;
          if (loc) {
            sourceMap[step.id] = { line: loc.line, column: loc.column };
          }
        }
      } catch (e) {
        errors.push({
          code: "STEP_TRANSFORM_ERROR",
          message: `Failed to transform step: ${(e as Error).message}`,
        });
      }
    }
  }

  // Transform guards
  const guards: GuardDef[] = [];
  if (source.guards) {
    for (const rawGuard of source.guards) {
      try {
        const guard = transformGuard(rawGuard, errors);
        if (guard) {
          guards.push(guard);
        }
      } catch (e) {
        errors.push({
          code: "GUARD_TRANSFORM_ERROR",
          message: `Failed to transform guard: ${(e as Error).message}`,
        });
      }
    }
  }

  if (errors.length > 0) {
    return { success: false, errors, warnings };
  }

  const ir: SpellIR = {
    id,
    version: source.version,
    meta: {
      name: source.spell,
      description: source.description,
      created: Date.now(),
      hash,
    },
    aliases,
    assets,
    skills,
    advisors,
    params,
    state,
    steps,
    guards,
    triggers,
    sourceMap: Object.keys(sourceMap).length > 0 ? sourceMap : undefined,
  };

  return { success: true, ir, errors, warnings };
}

/**
 * Generate a simple hash for content addressing
 */
function generateHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

/**
 * Infer parameter type from value
 */
function inferType(value: unknown): ParamDef["type"] {
  if (typeof value === "boolean") return "bool";
  if (typeof value === "number") return "number";
  if (typeof value === "string") {
    if (value.startsWith("0x") && value.length === 42) return "address";
    return "string";
  }
  return "string";
}

/**
 * Transform trigger
 */
function transformTrigger(raw: NonNullable<SpellSource["trigger"]>): Trigger | null {
  if ("manual" in raw && raw.manual) {
    return { type: "manual" };
  }
  if ("schedule" in raw) {
    return { type: "schedule", cron: raw.schedule as string };
  }
  if ("condition" in raw) {
    return {
      type: "condition",
      expression: raw.condition as string,
      pollInterval: (raw.poll_interval as number) ?? 60,
    };
  }
  if ("any" in raw && Array.isArray(raw.any)) {
    const triggers: Trigger[] = [];
    for (const t of raw.any) {
      const transformed = transformTrigger(t as NonNullable<SpellSource["trigger"]>);
      if (transformed) {
        triggers.push(transformed);
      }
    }
    return { type: "any", triggers };
  }
  return null;
}

/**
 * Transform a raw step object into a Step
 */
function transformStep(
  raw: Record<string, unknown>,
  existingIds: Set<string>,
  errors: CompilationError[]
): Step | null {
  const id = raw.id as string;
  if (!id) {
    errors.push({ code: "MISSING_STEP_ID", message: "Step must have an 'id' field" });
    return null;
  }

  if (existingIds.has(id)) {
    errors.push({ code: "DUPLICATE_STEP_ID", message: `Duplicate step id '${id}'` });
    return null;
  }

  // Compute step
  if ("compute" in raw) {
    const assignments: ComputeStep["assignments"] = [];
    const compute = raw.compute as Record<string, unknown>;
    for (const [variable, exprValue] of Object.entries(compute)) {
      try {
        let expression: Expression;
        if (typeof exprValue === "string") {
          expression = parseExpression(exprValue);
        } else if (typeof exprValue === "number") {
          expression = {
            kind: "literal",
            value: exprValue,
            type: Number.isInteger(exprValue) ? "int" : "float",
          };
        } else if (typeof exprValue === "boolean") {
          expression = { kind: "literal", value: exprValue, type: "bool" };
        } else {
          throw new Error(`Unsupported value type: ${typeof exprValue}`);
        }
        assignments.push({ variable, expression });
      } catch (e) {
        errors.push({
          code: "EXPRESSION_PARSE_ERROR",
          message: `Failed to parse expression for '${variable}': ${(e as Error).message}`,
        });
      }
    }
    return {
      kind: "compute",
      id,
      assignments,
      dependsOn: [],
    };
  }

  // Conditional step
  if ("if" in raw && ("then" in raw || "action" in raw)) {
    // Simple conditional with action
    if ("action" in raw) {
      const conditionStr = raw.if as string;
      let condition: Expression;
      try {
        condition = parseExpression(conditionStr);
      } catch (e) {
        errors.push({
          code: "EXPRESSION_PARSE_ERROR",
          message: `Failed to parse condition: ${(e as Error).message}`,
        });
        return null;
      }

      // Transform the action
      const action = transformAction(raw.action as Record<string, unknown>, errors);
      if (!action) return null;

      const constraints = transformConstraints(
        raw.constraints as Record<string, unknown> | undefined
      );
      const onFailure = (raw.on_failure as string) ?? "revert";

      // Create action step with condition check
      const actionStep: ActionStep = {
        kind: "action",
        id,
        action,
        constraints,
        onFailure: onFailure as ActionStep["onFailure"],
        dependsOn: [],
      };

      // Wrap in conditional
      const _conditionalStep: ConditionalStep = {
        kind: "conditional",
        id: `${id}_cond`,
        condition,
        thenSteps: [id],
        elseSteps: [],
        dependsOn: [],
      };

      // Return the action step (conditional logic handled at execution)
      // For now, store condition in dependsOn comment
      return actionStep;
    }

    // Full conditional with then/else
    const conditionStr = raw.if as string;
    let condition: Expression;
    try {
      condition = parseExpression(conditionStr);
    } catch (e) {
      errors.push({
        code: "EXPRESSION_PARSE_ERROR",
        message: `Failed to parse condition: ${(e as Error).message}`,
      });
      return null;
    }

    return {
      kind: "conditional",
      id,
      condition,
      thenSteps: (raw.then as string[]) ?? [],
      elseSteps: (raw.else as string[]) ?? [],
      dependsOn: [],
    };
  }

  // Action step (without condition)
  if ("action" in raw) {
    const action = transformAction(raw.action as Record<string, unknown>, errors);
    if (!action) return null;

    const constraints = transformConstraints(
      raw.constraints as Record<string, unknown> | undefined
    );
    const onFailure = (raw.on_failure as string) ?? "revert";

    return {
      kind: "action",
      id,
      action,
      constraints,
      outputBinding: raw.output as string | undefined,
      onFailure: onFailure as ActionStep["onFailure"],
      dependsOn: [],
    };
  }

  // Loop step
  if ("repeat" in raw || "for" in raw || "loop" in raw) {
    return transformLoopStep(raw, id, errors);
  }

  // Try step (from atomic blocks or explicit try)
  if ("try" in raw) {
    return transformTryStep(raw, id);
  }

  // Wait step
  if ("wait" in raw) {
    return {
      kind: "wait",
      id,
      duration: raw.wait as number,
      dependsOn: [],
    };
  }

  // Emit step
  if ("emit" in raw) {
    const emit = raw.emit as Record<string, unknown>;
    const event = emit.event as string;
    const dataRaw = emit.data as Record<string, string>;
    const data: Record<string, Expression> = {};

    for (const [key, exprStr] of Object.entries(dataRaw)) {
      try {
        data[key] = parseExpression(exprStr);
      } catch (e) {
        errors.push({
          code: "EXPRESSION_PARSE_ERROR",
          message: `Failed to parse emit data '${key}': ${(e as Error).message}`,
        });
      }
    }

    return {
      kind: "emit",
      id,
      event,
      data,
      dependsOn: [],
    };
  }

  // Halt step (if explicitly marked)
  if ("halt" in raw) {
    return {
      kind: "halt",
      id,
      reason: raw.halt as string,
      dependsOn: [],
    };
  }

  errors.push({ code: "UNKNOWN_STEP_TYPE", message: `Unknown step type for id '${id}'` });
  return null;
}

/**
 * Transform action object
 */
function transformAction(raw: Record<string, unknown>, errors: CompilationError[]): Action | null {
  const type = raw.type as string;

  switch (type) {
    case "swap":
      return {
        type: "swap",
        venue: raw.venue as string,
        assetIn: raw.asset_in as string,
        assetOut: raw.asset_out as string,
        amount: parseExpressionSafe(raw.amount as string, errors),
        mode: (raw.mode as "exact_in" | "exact_out") ?? "exact_in",
      } as Action;

    case "lend":
      return {
        type: "lend",
        venue: raw.venue as string,
        asset: raw.asset as string,
        amount: raw.amount === "max" ? "max" : parseExpressionSafe(raw.amount as string, errors),
      } as Action;

    case "withdraw":
      return {
        type: "withdraw",
        venue: raw.venue as string,
        asset: raw.asset as string,
        amount: raw.amount === "max" ? "max" : parseExpressionSafe(raw.amount as string, errors),
      } as Action;

    case "borrow":
      return {
        type: "borrow",
        venue: raw.venue as string,
        asset: raw.asset as string,
        amount: parseExpressionSafe(raw.amount as string, errors),
        collateral: raw.collateral as string | undefined,
      } as Action;

    case "repay":
      return {
        type: "repay",
        venue: raw.venue as string,
        asset: raw.asset as string,
        amount: raw.amount === "max" ? "max" : parseExpressionSafe(raw.amount as string, errors),
      } as Action;

    case "stake":
      return {
        type: "stake",
        venue: raw.venue as string,
        asset: raw.asset as string,
        amount: parseExpressionSafe(raw.amount as string, errors),
      } as Action;

    case "unstake":
      return {
        type: "unstake",
        venue: raw.venue as string,
        asset: raw.asset as string,
        amount: raw.amount === "max" ? "max" : parseExpressionSafe(raw.amount as string, errors),
      } as Action;

    case "claim":
      return {
        type: "claim",
        venue: raw.venue as string,
        assets: raw.assets as string[] | undefined,
      } as Action;

    case "bridge": {
      const toChainValue = raw.to_chain ?? raw.toChain;
      if (toChainValue === undefined) {
        errors.push({
          code: "MISSING_BRIDGE_CHAIN",
          message: "Bridge action requires to_chain",
        });
        return null;
      }

      return {
        type: "bridge",
        venue: raw.venue as string,
        asset: raw.asset as string,
        amount: parseExpressionSafe(raw.amount as string, errors),
        toChain: parseExpressionSafe(toChainValue as string | number, errors),
      } as Action;
    }

    case "transfer":
      return {
        type: "transfer",
        asset: raw.asset as string,
        amount: parseExpressionSafe(raw.amount as string, errors),
        to: raw.to as Address,
      } as Action;

    default:
      errors.push({ code: "UNKNOWN_ACTION_TYPE", message: `Unknown action type '${type}'` });
      return null;
  }
}

/**
 * Parse expression safely, returning a literal on failure
 */
function parseExpressionSafe(input: string | number, errors: CompilationError[]): Expression {
  if (typeof input === "number") {
    return { kind: "literal", value: input, type: "int" };
  }
  try {
    return parseExpression(input);
  } catch (e) {
    errors.push({
      code: "EXPRESSION_PARSE_ERROR",
      message: `Failed to parse expression '${input}': ${(e as Error).message}`,
    });
    return { kind: "literal", value: 0, type: "int" };
  }
}

/**
 * Transform constraints
 */
function transformConstraints(raw: Record<string, unknown> | undefined): ActionConstraints {
  if (!raw) return {};
  return {
    maxSlippageBps: raw.max_slippage as number | undefined,
    deadline: raw.deadline as number | undefined,
  };
}

/**
 * Transform loop step
 */
function transformLoopStep(
  raw: Record<string, unknown>,
  id: string,
  errors: CompilationError[]
): LoopStep | null {
  let loopType: LoopStep["loopType"];

  if ("repeat" in raw) {
    loopType = { type: "repeat", count: raw.repeat as number };
  } else if ("for" in raw) {
    const forClause = raw.for as string;
    // Parse "var in expression"
    const match = forClause.match(/^(\w+)\s+in\s+(.+)$/);
    if (!match) {
      errors.push({ code: "INVALID_FOR_CLAUSE", message: `Invalid for clause: ${forClause}` });
      return null;
    }
    const [, variable, sourceStr] = match;
    if (!variable || !sourceStr) {
      errors.push({ code: "INVALID_FOR_CLAUSE", message: `Invalid for clause: ${forClause}` });
      return null;
    }
    try {
      const source = parseExpression(sourceStr);
      loopType = { type: "for", variable, source };
    } catch (e) {
      errors.push({
        code: "EXPRESSION_PARSE_ERROR",
        message: `Failed to parse for source: ${(e as Error).message}`,
      });
      return null;
    }
  } else if ("loop" in raw) {
    const loop = raw.loop as Record<string, unknown>;
    try {
      const condition = parseExpression(loop.until as string);
      loopType = { type: "until", condition };
    } catch (e) {
      errors.push({
        code: "EXPRESSION_PARSE_ERROR",
        message: `Failed to parse loop condition: ${(e as Error).message}`,
      });
      return null;
    }
  } else {
    return null;
  }

  const maxIterations =
    (raw.max as number) ?? ((raw.loop as Record<string, unknown>)?.max as number) ?? 100;

  return {
    kind: "loop",
    id,
    loopType,
    bodySteps: (raw.steps as string[]) ?? [],
    maxIterations,
    parallel: raw.parallel as boolean | undefined,
    outputBinding: raw.output as string | undefined,
    dependsOn: [],
  };
}

/**
 * Transform guard
 */
function transformGuard(
  raw: NonNullable<SpellSource["guards"]>[number],
  errors: CompilationError[]
): GuardDef | null {
  if (!raw.id) {
    errors.push({ code: "MISSING_GUARD_ID", message: "Guard must have an 'id' field" });
    return null;
  }

  if (raw.advisory) {
    // Advisory guard
    return {
      id: raw.id,
      advisor: raw.advisory,
      check: raw.check ?? "",
      severity: raw.severity as "warn" | "pause",
      fallback: raw.fallback ?? true,
    };
  }

  // Expression guard
  if (!raw.check) {
    errors.push({
      code: "MISSING_GUARD_CHECK",
      message: `Guard '${raw.id}' must have a 'check' field`,
    });
    return null;
  }

  try {
    const check = parseExpression(raw.check);
    return {
      id: raw.id,
      check,
      severity: raw.severity as "warn" | "revert" | "halt",
      message: raw.message ?? "",
    };
  } catch (e) {
    errors.push({
      code: "EXPRESSION_PARSE_ERROR",
      message: `Failed to parse guard check: ${(e as Error).message}`,
    });
    return null;
  }
}

const VALID_ERROR_TYPES = new Set<string>([
  "slippage_exceeded",
  "insufficient_liquidity",
  "insufficient_balance",
  "venue_unavailable",
  "deadline_exceeded",
  "simulation_failed",
  "policy_violation",
  "guard_failed",
  "tx_reverted",
  "gas_exceeded",
]);

/**
 * Transform a try step from SpellSource into TryStep IR.
 *
 * The transformer emits: { id, try: string[], catch: Array<{ error, action?, steps?, retry? }> }
 * We convert to the TryStep type expected by the runtime.
 */
function transformTryStep(raw: Record<string, unknown>, id: string): TryStep {
  const trySteps = (raw.try as string[]) ?? [];
  const rawCatch = (raw.catch as Array<Record<string, unknown>>) ?? [];
  const finallySteps = (raw.finally as string[]) ?? undefined;

  const catchBlocks: CatchBlock[] = rawCatch.map((c) => {
    const errorField = (c.error as string) ?? "*";
    const errorType: ErrorType | "*" =
      errorField === "*"
        ? "*"
        : VALID_ERROR_TYPES.has(errorField)
          ? (errorField as ErrorType)
          : "*";

    // Map "revert" → "rollback" to match CatchBlock action type
    let action: CatchBlock["action"];
    if (c.action) {
      const rawAction = c.action as string;
      action = rawAction === "revert" ? "rollback" : (rawAction as CatchBlock["action"]);
    }

    const block: CatchBlock = { errorType };
    if (action) block.action = action;
    if (c.steps) block.steps = c.steps as string[];
    if (c.retry) {
      const retry = c.retry as Record<string, unknown>;
      block.retry = {
        maxAttempts: (retry.maxAttempts as number) ?? 3,
        backoff: (retry.backoff as CatchBlock["retry"] & { backoff: string })?.backoff ?? "none",
        backoffBase: retry.backoffBase as number | undefined,
        maxBackoff: retry.maxBackoff as number | undefined,
      };
    }

    return block;
  });

  return {
    kind: "try",
    id,
    trySteps,
    catchBlocks,
    finallySteps: finallySteps && finallySteps.length > 0 ? finallySteps : undefined,
    dependsOn: [],
  };
}
