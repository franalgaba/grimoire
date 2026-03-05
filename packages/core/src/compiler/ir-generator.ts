/**
 * IR Generator
 * Transforms SpellSource AST into SpellIR
 */

import type {
  Action,
  ActionAmount,
  ActionConstraints,
  CustomActionValue,
  PendleInputAmount,
} from "../types/actions.js";
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
  AdvisoryStep,
  CatchBlock,
  ComputeStep,
  ConditionalStep,
  ErrorType,
  LoopStep,
  ParallelStep,
  PipelineStep,
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
        const extended = value as {
          type?: string;
          default?: unknown;
          min?: number;
          max?: number;
          asset?: string;
        };
        params.push({
          name,
          type: (extended.type ?? "number") as ParamDef["type"],
          asset: extended.asset,
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
        skills: advisor.skills,
        allowedTools: advisor.allowed_tools,
        mcp: advisor.mcp,
        defaultTimeout: advisor.timeout,
        defaultFallback: advisor.fallback,
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

  // Transform steps and build source map + trigger step map
  const steps: Step[] = [];
  const stepIds = new Set<string>();
  const sourceMap: Record<string, { line: number; column: number }> = {};
  const triggerStepMap: Record<number, string[]> = {};

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

          // Extract trigger index for triggerStepMap (multi-trigger spells)
          const triggerIndex = rawStep._triggerIndex as number | undefined;
          if (triggerIndex !== undefined) {
            if (!triggerStepMap[triggerIndex]) {
              triggerStepMap[triggerIndex] = [];
            }
            triggerStepMap[triggerIndex].push(step.id);
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

  // Auto-add "default" advisor if referenced by advisory steps but not declared
  const advisorNames = new Set(advisors.map((a) => a.name));
  const referencedAdvisors = new Set<string>();
  for (const step of steps) {
    if (step.kind === "advisory" && !advisorNames.has(step.advisor)) {
      referencedAdvisors.add(step.advisor);
    }
  }
  for (const name of referencedAdvisors) {
    advisors.push({
      name,
      model: "sonnet",
      scope: "read-only",
    });
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
    triggerStepMap: Object.keys(triggerStepMap).length > 0 ? triggerStepMap : undefined,
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
  if ("event" in raw) {
    return {
      type: "event",
      event: raw.event as string,
      filter: raw.filter as string | undefined,
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
        raw.constraints as Record<string, unknown> | undefined,
        errors
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
      raw.constraints as Record<string, unknown> | undefined,
      errors
    );
    const onFailure = (raw.on_failure as string) ?? "revert";

    return {
      kind: "action",
      id,
      action,
      skill: raw.skill as string | undefined,
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

  // Advisory step (AI consultation)
  if ("advisory" in raw) {
    const advisory = raw.advisory as Record<string, unknown>;
    const prompt = advisory.prompt as string;
    const advisor = (advisory.advisor as string) ?? "default";
    const contextRaw = advisory.context as Record<string, unknown> | undefined;
    const context = contextRaw ? parseContextExpressions(contextRaw, errors) : undefined;
    const policyScope = advisory.within as string | undefined;
    const violationPolicy =
      advisory.on_violation === "clamp" ? ("clamp" as const) : ("reject" as const);
    const violationPolicyExplicit =
      advisory.on_violation_explicit === true || advisory.on_violation !== undefined;
    const clampConstraintsRaw = advisory.clamp_constraints as unknown[] | undefined;
    const clampConstraints = clampConstraintsRaw
      ? clampConstraintsRaw.map((value) => String(value))
      : undefined;
    const timeout = (advisory.timeout as number) ?? 30;
    const fallbackValue = advisory.fallback ?? true;
    const outputBinding = (advisory.output as string) ?? `${id}_result`;
    const outputSchemaRaw = advisory.output_schema as Record<string, unknown> | undefined;
    const outputSchema = outputSchemaRaw
      ? parseOutputSchema(outputSchemaRaw)
      : ({ type: "boolean" } as AdvisoryStep["outputSchema"]);

    return {
      kind: "advisory",
      id,
      advisor,
      prompt,
      context,
      policyScope,
      outputSchema,
      outputBinding,
      violationPolicy,
      violationPolicyExplicit,
      clampConstraints,
      timeout,
      fallback: fallbackToExpression(fallbackValue, errors),
      dependsOn: [],
    };
  }

  // Parallel step
  if ("parallel" in raw) {
    const parallel = raw.parallel as Record<string, unknown>;
    const branchesRaw = (parallel.branches as Array<Record<string, unknown>>) ?? [];
    const branches = branchesRaw.map((b) => ({
      id: `${id}_${b.name as string}`,
      name: b.name as string,
      steps: (b.steps as string[]) ?? [],
    }));

    const joinRaw = parallel.join as Record<string, unknown> | undefined;
    let join: ParallelStep["join"] = { type: "all" };
    if (joinRaw?.type) {
      const type = joinRaw.type as ParallelStep["join"]["type"];
      if (type === "best") {
        const metricStr = joinRaw.metric as string;
        join = {
          type: "best",
          metric: metricStr ? parseExpression(metricStr) : parseExpression("0"),
          order: (joinRaw.order as "max" | "min") ?? "max",
        };
      } else if (type === "any") {
        join = { type: "any", count: (joinRaw.count as number) ?? 1 };
      } else if (type === "majority") {
        join = { type: "majority" };
      } else if (type === "first") {
        join = { type: "first" };
      } else {
        join = { type: "all" };
      }
    }

    return {
      kind: "parallel",
      id,
      branches,
      join,
      onFail: (parallel.on_fail as "abort" | "continue") ?? "abort",
      timeout: parallel.timeout as number | undefined,
      outputBinding: raw.output as string | undefined,
      dependsOn: [],
    };
  }

  // Pipeline step
  if ("pipeline" in raw) {
    const pipeline = raw.pipeline as Record<string, unknown>;
    const sourceStr = pipeline.source as string;
    const stagesRaw = (pipeline.stages as Array<Record<string, unknown>>) ?? [];
    const stages: PipelineStep["stages"] = stagesRaw.map((stage) => {
      const op = stage.op as PipelineStep["stages"][number]["op"];
      if (op === "reduce") {
        return {
          op: "reduce",
          step: stage.step as string,
          initial: parseExpression(String(stage.initial ?? "0")),
        };
      }
      if (op === "take") {
        return { op: "take", count: stage.count as number };
      }
      if (op === "skip") {
        return { op: "skip", count: stage.count as number };
      }
      if (op === "sort") {
        return {
          op: "sort",
          by: parseExpression(String(stage.by ?? "0")),
          order: (stage.order as "asc" | "desc") ?? "asc",
        };
      }
      if (op === "where") {
        return { op: "where", predicate: parseExpression(String(stage.predicate ?? "false")) };
      }
      return { op: op ?? "map", step: stage.step as string } as PipelineStep["stages"][number];
    });

    return {
      kind: "pipeline",
      id,
      source: parseExpression(sourceStr),
      stages,
      parallel: (pipeline.parallel as boolean) ?? false,
      outputBinding: raw.output as string | undefined,
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
        marketId: parseOptionalMarketId(raw.market_id ?? raw.marketId),
      } as Action;

    case "withdraw":
      return {
        type: "withdraw",
        venue: raw.venue as string,
        asset: raw.asset as string,
        amount: raw.amount === "max" ? "max" : parseExpressionSafe(raw.amount as string, errors),
        marketId: parseOptionalMarketId(raw.market_id ?? raw.marketId),
      } as Action;

    case "borrow":
      return {
        type: "borrow",
        venue: raw.venue as string,
        asset: raw.asset as string,
        amount: parseExpressionSafe(raw.amount as string, errors),
        collateral: raw.collateral as string | undefined,
        marketId: parseOptionalMarketId(raw.market_id ?? raw.marketId),
      } as Action;

    case "repay":
      return {
        type: "repay",
        venue: raw.venue as string,
        asset: raw.asset as string,
        amount: raw.amount === "max" ? "max" : parseExpressionSafe(raw.amount as string, errors),
        marketId: parseOptionalMarketId(raw.market_id ?? raw.marketId),
      } as Action;

    case "supply_collateral":
      return {
        type: "supply_collateral",
        venue: raw.venue as string,
        asset: raw.asset as string,
        amount: parseExpressionSafe(raw.amount as string, errors),
        marketId: parseOptionalMarketId(raw.market_id ?? raw.marketId),
      } as Action;

    case "withdraw_collateral":
      return {
        type: "withdraw_collateral",
        venue: raw.venue as string,
        asset: raw.asset as string,
        amount: parseExpressionSafe(raw.amount as string, errors),
        marketId: parseOptionalMarketId(raw.market_id ?? raw.marketId),
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

    case "add_liquidity":
      return {
        type: "add_liquidity",
        venue: raw.venue as string,
        asset: raw.asset as string,
        amount: parseActionAmount(raw.amount, errors),
        assetOut: readAssetOut(raw),
        outputs: parseOutputAssets(raw.outputs),
        keepYt: parseOptionalBoolean(raw.keep_yt ?? raw.keepYt),
        ...parsePendleActionOptions(raw),
      } as Action;

    case "add_liquidity_dual":
      return {
        type: "add_liquidity_dual",
        venue: raw.venue as string,
        inputs: parsePendleInputs(raw.inputs, errors),
        outputs: parseOutputAssets(raw.outputs) ?? [],
        keepYt: parseOptionalBoolean(raw.keep_yt ?? raw.keepYt),
        ...parsePendleActionOptions(raw),
      } as Action;

    case "remove_liquidity":
      return {
        type: "remove_liquidity",
        venue: raw.venue as string,
        asset: raw.asset as string,
        amount: parseActionAmount(raw.amount, errors),
        assetOut: readAssetOut(raw),
        outputs: parseOutputAssets(raw.outputs),
        ...parsePendleActionOptions(raw),
      } as Action;

    case "remove_liquidity_dual":
      return {
        type: "remove_liquidity_dual",
        venue: raw.venue as string,
        inputs: parsePendleInputs(raw.inputs, errors),
        outputs: parseOutputAssets(raw.outputs) ?? [],
        ...parsePendleActionOptions(raw),
      } as Action;

    case "mint_py":
      return {
        type: "mint_py",
        venue: raw.venue as string,
        asset: raw.asset as string,
        amount: parseActionAmount(raw.amount, errors),
        assetOut: readAssetOut(raw),
        outputs: parseOutputAssets(raw.outputs),
        ...parsePendleActionOptions(raw),
      } as Action;

    case "redeem_py":
      return {
        type: "redeem_py",
        venue: raw.venue as string,
        asset: raw.asset as string,
        amount: parseActionAmount(raw.amount, errors),
        assetOut: readAssetOut(raw),
        outputs: parseOutputAssets(raw.outputs),
        ...parsePendleActionOptions(raw),
      } as Action;

    case "mint_sy":
      return {
        type: "mint_sy",
        venue: raw.venue as string,
        asset: raw.asset as string,
        amount: parseActionAmount(raw.amount, errors),
        assetOut: readAssetOut(raw),
        outputs: parseOutputAssets(raw.outputs),
        ...parsePendleActionOptions(raw),
      } as Action;

    case "redeem_sy":
      return {
        type: "redeem_sy",
        venue: raw.venue as string,
        asset: raw.asset as string,
        amount: parseActionAmount(raw.amount, errors),
        assetOut: readAssetOut(raw),
        outputs: parseOutputAssets(raw.outputs),
        ...parsePendleActionOptions(raw),
      } as Action;

    case "transfer_liquidity":
      return {
        type: "transfer_liquidity",
        venue: raw.venue as string,
        inputs: parsePendleInputs(raw.inputs, errors),
        outputs: parseOutputAssets(raw.outputs) ?? [],
        keepYt: parseOptionalBoolean(raw.keep_yt ?? raw.keepYt),
        ...parsePendleActionOptions(raw),
      } as Action;

    case "roll_over_pt":
      return {
        type: "roll_over_pt",
        venue: raw.venue as string,
        asset: raw.asset as string,
        amount: parseActionAmount(raw.amount, errors),
        assetOut: readAssetOut(raw),
        outputs: parseOutputAssets(raw.outputs),
        ...parsePendleActionOptions(raw),
      } as Action;

    case "exit_market":
      return {
        type: "exit_market",
        venue: raw.venue as string,
        inputs: parsePendleInputs(raw.inputs, errors),
        outputs: parseOutputAssets(raw.outputs) ?? [],
        ...parsePendleActionOptions(raw),
      } as Action;

    case "convert_lp_to_pt":
      return {
        type: "convert_lp_to_pt",
        venue: raw.venue as string,
        asset: raw.asset as string,
        amount: parseActionAmount(raw.amount, errors),
        assetOut: readAssetOut(raw),
        outputs: parseOutputAssets(raw.outputs),
        ...parsePendleActionOptions(raw),
      } as Action;

    case "pendle_swap":
      return {
        type: "pendle_swap",
        venue: raw.venue as string,
        inputs: parsePendleInputs(raw.inputs, errors),
        outputs: parseOutputAssets(raw.outputs) ?? [],
        ...parsePendleActionOptions(raw),
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

    case "transfer": {
      const toValue = raw.to as string;
      const isAddress =
        typeof toValue === "string" && toValue.startsWith("0x") && toValue.length === 42;
      return {
        type: "transfer",
        asset: raw.asset as string,
        amount: parseExpressionSafe(raw.amount as string, errors),
        to: isAddress ? (toValue as Address) : parseExpressionSafe(toValue, errors),
      } as Action;
    }

    case "custom": {
      const venue = raw.venue as string | undefined;
      const op = raw.op as string | undefined;
      const rawArgs = raw.args;

      if (!venue) {
        errors.push({
          code: "MISSING_CUSTOM_VENUE",
          message: "Custom action requires venue",
        });
        return null;
      }

      if (!op) {
        errors.push({
          code: "MISSING_CUSTOM_OP",
          message: "Custom action requires op",
        });
        return null;
      }

      const args: Record<string, CustomActionValue> = {};
      if (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
        for (const [key, value] of Object.entries(rawArgs)) {
          if (
            op === "order" &&
            (key === "side" || key === "order_type") &&
            typeof value === "string"
          ) {
            args[key] = { kind: "literal", value, type: "string" };
            continue;
          }
          if (op === "convert") {
            args[key] = parseConvertCustomActionValue(value);
            continue;
          }
          args[key] = parseCustomActionValue(value, errors);
        }
      }

      return {
        type: "custom",
        venue,
        op,
        args,
      } as Action;
    }

    default:
      errors.push({ code: "UNKNOWN_ACTION_TYPE", message: `Unknown action type '${type}'` });
      return null;
  }
}

function parseActionAmount(value: unknown, errors: CompilationError[]): ActionAmount {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return parseExpressionSafe(value, errors);
  }
  if (typeof value === "string") {
    return parseExpressionSafe(value, errors);
  }
  if (value && typeof value === "object" && "kind" in value) {
    return value as ActionAmount;
  }

  errors.push({
    code: "INVALID_ACTION_AMOUNT",
    message: `Unsupported action amount value '${String(value)}'`,
  });
  return { kind: "literal", value: 0, type: "int" };
}

function readAssetOut(raw: Record<string, unknown>): string | undefined {
  const assetOut = raw.asset_out ?? raw.assetOut;
  if (typeof assetOut !== "string") {
    return undefined;
  }
  return assetOut;
}

function parseOutputAssets(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const outputs = value.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0);
    return outputs.length > 0 ? outputs : undefined;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    if (!trimmed.includes(",")) {
      return [trimmed];
    }
    const outputs = trimmed
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return outputs.length > 0 ? outputs : undefined;
  }

  return undefined;
}

function parseOptionalMarketId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parsePendleInputs(value: unknown, errors: CompilationError[]): PendleInputAmount[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const inputs: PendleInputAmount[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const asset = record.asset;
    const amount = record.amount;
    if (typeof asset !== "string") {
      errors.push({
        code: "INVALID_PENDLE_INPUT",
        message: "Pendle input entry is missing asset",
      });
      continue;
    }
    inputs.push({
      asset,
      amount: parseActionAmount(amount, errors),
    });
  }

  return inputs;
}

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return undefined;
}

function parseOptionalStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0);
    return items.length > 0 ? items : undefined;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const values = trimmed
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return values.length > 0 ? values : undefined;
  }

  return undefined;
}

function parsePendleActionOptions(raw: Record<string, unknown>): Record<string, unknown> {
  const enableAggregator = parseOptionalBoolean(raw.enable_aggregator ?? raw.enableAggregator);
  const aggregators = parseOptionalStringArray(raw.aggregators);
  const needScale = parseOptionalBoolean(raw.need_scale ?? raw.needScale);
  const redeemRewards = parseOptionalBoolean(raw.redeem_rewards ?? raw.redeemRewards);
  const additionalData = raw.additional_data ?? raw.additionalData;
  const useLimitOrder = parseOptionalBoolean(raw.use_limit_order ?? raw.useLimitOrder);

  const options: Record<string, unknown> = {};
  if (enableAggregator !== undefined) options.enableAggregator = enableAggregator;
  if (aggregators !== undefined) options.aggregators = aggregators;
  if (needScale !== undefined) options.needScale = needScale;
  if (redeemRewards !== undefined) options.redeemRewards = redeemRewards;
  if (typeof additionalData === "string" && additionalData.trim().length > 0) {
    options.additionalData = additionalData;
  }
  if (useLimitOrder !== undefined) options.useLimitOrder = useLimitOrder;
  return options;
}

function parseCustomActionValue(input: unknown, errors: CompilationError[]): CustomActionValue {
  if (input === null) {
    return null;
  }

  if (typeof input === "string" || typeof input === "number" || typeof input === "boolean") {
    return parseExpressionSafe(input, errors);
  }

  if (typeof input === "bigint") {
    return { kind: "literal", value: input, type: "int" };
  }

  if (Array.isArray(input)) {
    return input.map((item) => parseCustomActionValue(item, errors));
  }

  if (typeof input === "object") {
    // Preserve parsed expressions if already present.
    if ("kind" in input && typeof (input as { kind?: unknown }).kind === "string") {
      return input as CustomActionValue;
    }

    const out: Record<string, CustomActionValue> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      out[key] = parseCustomActionValue(value, errors);
    }
    return out;
  }

  return { kind: "literal", value: String(input), type: "string" };
}

function parseConvertCustomActionValue(input: unknown): CustomActionValue {
  if (input === null) {
    return null;
  }
  if (
    typeof input === "string" ||
    typeof input === "number" ||
    typeof input === "boolean" ||
    typeof input === "bigint"
  ) {
    return input;
  }
  if (Array.isArray(input)) {
    return input.map((item) => parseConvertCustomActionValue(item));
  }
  if (typeof input === "object") {
    if ("kind" in input && typeof (input as { kind?: unknown }).kind === "string") {
      return input as CustomActionValue;
    }
    const out: Record<string, CustomActionValue> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      out[key] = parseConvertCustomActionValue(value);
    }
    return out;
  }
  return String(input);
}

/**
 * Parse expression safely, returning a literal on failure
 */
function parseExpressionSafe(
  input: string | number | boolean,
  errors: CompilationError[]
): Expression {
  if (typeof input === "number") {
    return { kind: "literal", value: input, type: "int" };
  }
  if (typeof input === "boolean") {
    return { kind: "literal", value: input, type: "bool" };
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

function fallbackToExpression(input: unknown, errors: CompilationError[]): Expression {
  if (input && typeof input === "object") {
    if ("__expr" in input) {
      const exprValue = (input as { __expr: unknown }).__expr;
      try {
        return parseExpression(String(exprValue));
      } catch (e) {
        errors.push({
          code: "EXPRESSION_PARSE_ERROR",
          message: `Failed to parse fallback expression '${exprValue}': ${(e as Error).message}`,
        });
        return { kind: "literal", value: false, type: "bool" };
      }
    }
    if ("__literal" in input) {
      return literalFromValue((input as { __literal: unknown }).__literal);
    }
    return literalFromValue(input);
  }

  if (typeof input === "boolean") {
    return { kind: "literal", value: input, type: "bool" };
  }
  if (typeof input === "number") {
    return {
      kind: "literal",
      value: input,
      type: Number.isInteger(input) ? "int" : "float",
    };
  }
  if (typeof input === "bigint") {
    return { kind: "literal", value: input, type: "int" };
  }
  if (typeof input === "string") {
    return { kind: "literal", value: input, type: "string" };
  }

  try {
    return parseExpression(String(input));
  } catch (e) {
    errors.push({
      code: "EXPRESSION_PARSE_ERROR",
      message: `Failed to parse fallback expression '${String(input)}': ${(e as Error).message}`,
    });
    return { kind: "literal", value: false, type: "bool" };
  }
}

function literalFromValue(input: unknown): Expression {
  if (typeof input === "boolean") {
    return { kind: "literal", value: input, type: "bool" };
  }
  if (typeof input === "number") {
    return {
      kind: "literal",
      value: input,
      type: Number.isInteger(input) ? "int" : "float",
    };
  }
  if (typeof input === "bigint") {
    return { kind: "literal", value: input, type: "int" };
  }
  if (typeof input === "string") {
    return { kind: "literal", value: input, type: "string" };
  }
  return { kind: "literal", value: input as Record<string, unknown>, type: "json" };
}

function parseContextExpressions(
  raw: Record<string, unknown>,
  errors: CompilationError[]
): Record<string, Expression> {
  const context: Record<string, Expression> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      try {
        context[key] = parseExpression(value);
      } catch (e) {
        errors.push({
          code: "EXPRESSION_PARSE_ERROR",
          message: `Failed to parse advisory context '${key}': ${(e as Error).message}`,
        });
      }
      continue;
    }

    context[key] = literalFromValue(value);
  }
  return context;
}

function parseOutputSchema(raw: Record<string, unknown>): AdvisoryStep["outputSchema"] {
  const type = raw.type as AdvisoryStep["outputSchema"]["type"];
  switch (type) {
    case "enum":
      return {
        type: "enum",
        values: (raw.values as string[]) ?? [],
      };
    case "number":
      return {
        type: "number",
        min: raw.min as number | undefined,
        max: raw.max as number | undefined,
      };
    case "string":
      return {
        type: "string",
        minLength: (raw.min_length as number | undefined) ?? (raw.minLength as number | undefined),
        maxLength: (raw.max_length as number | undefined) ?? (raw.maxLength as number | undefined),
        pattern: raw.pattern as string | undefined,
      };
    case "object": {
      const fieldsRaw = raw.fields as Record<string, unknown> | undefined;
      const fields: Record<string, AdvisoryStep["outputSchema"]> | undefined = fieldsRaw
        ? Object.fromEntries(
            Object.entries(fieldsRaw).map(([key, value]) => [
              key,
              parseOutputSchema(value as Record<string, unknown>),
            ])
          )
        : undefined;
      return { type: "object", fields };
    }
    case "array": {
      const itemsRaw = raw.items as Record<string, unknown> | undefined;
      return {
        type: "array",
        items: itemsRaw ? parseOutputSchema(itemsRaw) : undefined,
      };
    }
    default:
      return { type: "boolean" };
  }
}

/**
 * Transform constraints
 */
function transformConstraints(
  raw: Record<string, unknown> | undefined,
  errors: CompilationError[]
): ActionConstraints {
  if (!raw) return {};

  const minOutputRaw = (raw.min_output ?? raw.minOutput) as string | number | undefined;
  const maxInputRaw = (raw.max_input ?? raw.maxInput) as string | number | undefined;
  const minLiquidityRaw = (raw.min_liquidity ?? raw.minLiquidity) as string | number | undefined;
  const maxGasRaw = (raw.max_gas ?? raw.maxGas) as string | number | undefined;
  const maxPriceImpactRaw = (raw.max_price_impact ?? raw.maxPriceImpact) as
    | string
    | number
    | undefined;
  const requireQuoteRaw = (raw.require_quote ?? raw.requireQuote) as
    | string
    | number
    | boolean
    | undefined;
  const requireSimulationRaw = (raw.require_simulation ?? raw.requireSimulation) as
    | string
    | number
    | boolean
    | undefined;

  return {
    maxSlippageBps: raw.max_slippage as number | undefined,
    maxPriceImpactBps:
      typeof maxPriceImpactRaw === "number"
        ? maxPriceImpactRaw
        : typeof maxPriceImpactRaw === "string"
          ? Number.parseFloat(maxPriceImpactRaw)
          : undefined,
    deadline: raw.deadline as number | undefined,
    minOutput: minOutputRaw !== undefined ? parseExpressionSafe(minOutputRaw, errors) : undefined,
    maxInput: maxInputRaw !== undefined ? parseExpressionSafe(maxInputRaw, errors) : undefined,
    minLiquidity:
      minLiquidityRaw !== undefined ? parseExpressionSafe(minLiquidityRaw, errors) : undefined,
    maxGas: maxGasRaw !== undefined ? parseExpressionSafe(maxGasRaw, errors) : undefined,
    requireQuote:
      requireQuoteRaw !== undefined ? parseExpressionSafe(requireQuoteRaw, errors) : undefined,
    requireSimulation:
      requireSimulationRaw !== undefined
        ? parseExpressionSafe(requireSimulationRaw, errors)
        : undefined,
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
