/**
 * Validator for SpellIR
 * Checks semantic correctness and safety constraints
 */

import type { Expression } from "../types/expressions.js";
import type {
  CompilationError,
  CompilationWarning,
  GuardDef,
  SkillDef,
  SpellIR,
} from "../types/ir.js";
import type { AdvisoryStep, LoopStep, Step } from "../types/steps.js";

export interface ValidationResult {
  valid: boolean;
  errors: CompilationError[];
  warnings: CompilationWarning[];
}

/**
 * Validate a SpellIR
 */
export function validateIR(ir: SpellIR): ValidationResult {
  const errors: CompilationError[] = [];
  const warnings: CompilationWarning[] = [];

  // Collect all known identifiers
  const venueAliases = new Set(ir.aliases.map((a) => a.alias));
  const assetSymbols = new Set(ir.assets.map((a) => a.symbol));
  const paramNames = new Set(ir.params.map((p) => p.name));
  const stepIds = new Set(ir.steps.map((s) => s.id));
  const advisorNames = new Set(ir.advisors.map((a) => a.name));
  const skillNames = new Set(ir.skills.map((s) => s.name));
  const skillsByName = new Map<string, SkillDef>(ir.skills.map((s) => [s.name, s]));

  // Validate steps
  for (const step of ir.steps) {
    validateStep(
      step,
      {
        venueAliases,
        assetSymbols,
        paramNames,
        stepIds,
        advisorNames,
        skillNames,
        skillsByName,
        persistentState: new Set(Object.keys(ir.state.persistent)),
        ephemeralState: new Set(Object.keys(ir.state.ephemeral)),
      },
      errors,
      warnings
    );
  }

  // Validate guards
  for (const guard of ir.guards) {
    validateGuard(
      guard,
      {
        venueAliases,
        assetSymbols,
        paramNames,
        advisorNames,
        skillsByName,
        persistentState: new Set(Object.keys(ir.state.persistent)),
        ephemeralState: new Set(Object.keys(ir.state.ephemeral)),
      },
      errors,
      warnings
    );
  }

  // Check for cycles in step dependencies
  const cycles = detectCycles(ir.steps);
  for (const cycle of cycles) {
    errors.push({
      code: "DEPENDENCY_CYCLE",
      message: `Dependency cycle detected: ${cycle.join(" -> ")}`,
    });
  }

  // Validate all loops have max iterations
  for (const step of ir.steps) {
    if (step.kind === "loop") {
      const loopStep = step as LoopStep;
      if (!loopStep.maxIterations || loopStep.maxIterations <= 0) {
        errors.push({
          code: "UNBOUNDED_LOOP",
          message: `Loop '${step.id}' must have a positive maxIterations`,
        });
      }
    }
  }

  // Validate advisory steps have timeout and fallback
  for (const step of ir.steps) {
    if (step.kind === "advisory") {
      const advisoryStep = step as AdvisoryStep;
      if (!advisoryStep.timeout || advisoryStep.timeout <= 0) {
        errors.push({
          code: "ADVISORY_NO_TIMEOUT",
          message: `Advisory step '${step.id}' must have a positive timeout`,
        });
      }
      if (!advisoryStep.fallback) {
        errors.push({
          code: "ADVISORY_NO_FALLBACK",
          message: `Advisory step '${step.id}' must have a fallback value`,
        });
      }
      if (!advisorNames.has(advisoryStep.advisor)) {
        errors.push({
          code: "UNKNOWN_ADVISOR",
          message: `Advisory step '${step.id}' references unknown advisor '${advisoryStep.advisor}'`,
        });
      }
    }
  }

  // Warn if no steps
  if (ir.steps.length === 0) {
    warnings.push({
      code: "NO_STEPS",
      message: "Spell has no steps defined",
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

interface ValidationContext {
  venueAliases: Set<string>;
  assetSymbols: Set<string>;
  paramNames: Set<string>;
  stepIds: Set<string>;
  advisorNames: Set<string>;
  skillNames: Set<string>;
  skillsByName: Map<string, SkillDef>;
  persistentState: Set<string>;
  ephemeralState: Set<string>;
}

/**
 * Validate a single step
 */
function validateStep(
  step: Step,
  ctx: ValidationContext,
  errors: CompilationError[],
  warnings: CompilationWarning[]
): void {
  // Validate dependsOn references
  for (const dep of step.dependsOn) {
    if (!ctx.stepIds.has(dep)) {
      errors.push({
        code: "UNKNOWN_STEP_REFERENCE",
        message: `Step '${step.id}' depends on unknown step '${dep}'`,
      });
    }
  }

  switch (step.kind) {
    case "compute":
      for (const assignment of step.assignments) {
        validateExpression(assignment.expression, ctx, errors, `step '${step.id}'`);
      }
      break;

    case "action":
      // Validate venue reference
      if ("venue" in step.action && step.action.venue) {
        const venue = step.action.venue;
        const explicitSkill = step.skill ? ctx.skillsByName.get(step.skill) : undefined;
        const inferredSkill = !explicitSkill ? ctx.skillsByName.get(venue) : undefined;
        const skill = explicitSkill ?? inferredSkill;
        const canAutoSelect =
          !!skill && skill.adapters.some((adapter) => ctx.venueAliases.has(adapter));

        if (!ctx.venueAliases.has(venue)) {
          if (canAutoSelect) {
            warnings.push({
              code: "AUTO_VENUE",
              message: `Step '${step.id}' will auto-select a venue from skill '${skill?.name ?? "unknown"}'`,
            });
          } else {
            errors.push({
              code: "UNKNOWN_VENUE",
              message: `Step '${step.id}' references unknown venue '${venue}'`,
            });
          }
        } else if (inferredSkill && canAutoSelect && !explicitSkill) {
          warnings.push({
            code: "SKILL_VENUE_AMBIGUOUS",
            message: `Step '${step.id}' uses '${venue}' which matches both a venue alias and a skill; skill routing will take precedence`,
          });
        }
      }

      // Validate asset references
      if ("assetIn" in step.action && !ctx.assetSymbols.has(step.action.assetIn)) {
        warnings.push({
          code: "UNKNOWN_ASSET",
          message: `Step '${step.id}' references undefined asset '${step.action.assetIn}'`,
        });
      }
      if ("assetOut" in step.action && !ctx.assetSymbols.has(step.action.assetOut)) {
        warnings.push({
          code: "UNKNOWN_ASSET",
          message: `Step '${step.id}' references undefined asset '${step.action.assetOut}'`,
        });
      }
      if ("asset" in step.action && !ctx.assetSymbols.has(step.action.asset)) {
        warnings.push({
          code: "UNKNOWN_ASSET",
          message: `Step '${step.id}' references undefined asset '${step.action.asset}'`,
        });
      }

      // Validate amount expression if not "max"
      if ("amount" in step.action && step.action.amount !== "max") {
        validateExpression(step.action.amount as Expression, ctx, errors, `step '${step.id}'`);
      }

      // Validate skill reference
      if (step.skill && !ctx.skillNames.has(step.skill)) {
        errors.push({
          code: "UNKNOWN_SKILL",
          message: `Step '${step.id}' references unknown skill '${step.skill}'`,
        });
      }
      break;

    case "conditional":
      validateExpression(step.condition, ctx, errors, `step '${step.id}'`);
      for (const thenStep of step.thenSteps) {
        if (!ctx.stepIds.has(thenStep)) {
          errors.push({
            code: "UNKNOWN_STEP_REFERENCE",
            message: `Step '${step.id}' then branch references unknown step '${thenStep}'`,
          });
        }
      }
      for (const elseStep of step.elseSteps) {
        if (!ctx.stepIds.has(elseStep)) {
          errors.push({
            code: "UNKNOWN_STEP_REFERENCE",
            message: `Step '${step.id}' else branch references unknown step '${elseStep}'`,
          });
        }
      }
      break;

    case "loop":
      for (const bodyStep of step.bodySteps) {
        if (!ctx.stepIds.has(bodyStep)) {
          errors.push({
            code: "UNKNOWN_STEP_REFERENCE",
            message: `Loop '${step.id}' body references unknown step '${bodyStep}'`,
          });
        }
      }
      if (step.loopType.type === "for") {
        validateExpression(step.loopType.source, ctx, errors, `loop '${step.id}'`);
      }
      if (step.loopType.type === "until") {
        validateExpression(step.loopType.condition, ctx, errors, `loop '${step.id}'`);
      }
      break;

    case "parallel":
      for (const branch of step.branches) {
        for (const branchStep of branch.steps) {
          if (!ctx.stepIds.has(branchStep)) {
            errors.push({
              code: "UNKNOWN_STEP_REFERENCE",
              message: `Parallel '${step.id}' branch '${branch.name}' references unknown step '${branchStep}'`,
            });
          }
        }
      }
      break;

    case "pipeline":
      validateExpression(step.source, ctx, errors, `pipeline '${step.id}'`);
      for (const stage of step.stages) {
        if (stage.op === "where") {
          validateExpression(stage.predicate, ctx, errors, `pipeline '${step.id}'`);
        }
        if (stage.op === "sort") {
          validateExpression(stage.by, ctx, errors, `pipeline '${step.id}'`);
        }
        if (stage.op === "map" || stage.op === "filter" || stage.op === "reduce") {
          if (!ctx.stepIds.has(stage.step)) {
            errors.push({
              code: "UNKNOWN_STEP_REFERENCE",
              message: `Pipeline '${step.id}' stage references unknown step '${stage.step}'`,
            });
          }
        }
      }
      break;

    case "try":
      for (const tryStep of step.trySteps) {
        if (!ctx.stepIds.has(tryStep)) {
          errors.push({
            code: "UNKNOWN_STEP_REFERENCE",
            message: `Try '${step.id}' references unknown step '${tryStep}'`,
          });
        }
      }
      if (step.finallySteps) {
        for (const finallyStep of step.finallySteps) {
          if (!ctx.stepIds.has(finallyStep)) {
            errors.push({
              code: "UNKNOWN_STEP_REFERENCE",
              message: `Try '${step.id}' finally references unknown step '${finallyStep}'`,
            });
          }
        }
      }
      break;

    case "advisory":
      validateExpression(step.fallback, ctx, errors, `advisory '${step.id}'`);
      if (step.context) {
        for (const [key, expr] of Object.entries(step.context)) {
          validateExpression(expr, ctx, errors, `advisory '${step.id}' context '${key}'`);
        }
      }
      break;

    case "emit":
      for (const [key, expr] of Object.entries(step.data)) {
        validateExpression(expr, ctx, errors, `emit '${step.id}' data '${key}'`);
      }
      break;

    case "wait":
    case "halt":
      // No additional validation needed
      break;
  }
}

/**
 * Validate an expression
 */
function validateExpression(
  expr: Expression,
  ctx: Omit<ValidationContext, "stepIds" | "skillNames">,
  errors: CompilationError[],
  location: string
): void {
  switch (expr.kind) {
    case "param":
      if (!ctx.paramNames.has(expr.name)) {
        errors.push({
          code: "UNKNOWN_PARAM",
          message: `${location}: Unknown parameter '${expr.name}'`,
        });
      }
      break;

    case "state":
      if (expr.scope === "persistent" && !ctx.persistentState.has(expr.key)) {
        errors.push({
          code: "UNKNOWN_STATE_KEY",
          message: `${location}: Unknown persistent state key '${expr.key}'`,
        });
      }
      if (expr.scope === "ephemeral" && !ctx.ephemeralState.has(expr.key)) {
        errors.push({
          code: "UNKNOWN_STATE_KEY",
          message: `${location}: Unknown ephemeral state key '${expr.key}'`,
        });
      }
      break;

    case "binary":
      validateExpression(expr.left, ctx, errors, location);
      validateExpression(expr.right, ctx, errors, location);
      break;

    case "unary":
      validateExpression(expr.arg, ctx, errors, location);
      break;

    case "ternary":
      validateExpression(expr.condition, ctx, errors, location);
      validateExpression(expr.then, ctx, errors, location);
      validateExpression(expr.else, ctx, errors, location);
      break;

    case "call":
      for (const arg of expr.args) {
        validateExpression(arg, ctx, errors, location);
      }
      break;

    case "array_access":
      validateExpression(expr.array, ctx, errors, location);
      validateExpression(expr.index, ctx, errors, location);
      break;

    case "property_access":
      validateExpression(expr.object, ctx, errors, location);
      break;

    case "literal":
    case "binding":
    case "item":
    case "index":
      // These are always valid
      break;
  }
}

/**
 * Validate a guard
 */
function validateGuard(
  guard: GuardDef,
  ctx: Omit<ValidationContext, "stepIds" | "skillNames">,
  errors: CompilationError[],
  _warnings: CompilationWarning[]
): void {
  if ("advisor" in guard) {
    // Advisory guard
    if (!ctx.advisorNames.has(guard.advisor)) {
      errors.push({
        code: "UNKNOWN_ADVISOR",
        message: `Guard '${guard.id}' references unknown advisor '${guard.advisor}'`,
      });
    }
  } else {
    // Expression guard
    validateExpression(guard.check, ctx, errors, `guard '${guard.id}'`);
  }
}

/**
 * Detect cycles in step dependencies using DFS
 */
function detectCycles(steps: Step[]): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const path: string[] = [];

  const stepMap = new Map(steps.map((s) => [s.id, s]));

  function dfs(stepId: string): void {
    if (recursionStack.has(stepId)) {
      // Found a cycle
      const cycleStart = path.indexOf(stepId);
      cycles.push([...path.slice(cycleStart), stepId]);
      return;
    }

    if (visited.has(stepId)) {
      return;
    }

    visited.add(stepId);
    recursionStack.add(stepId);
    path.push(stepId);

    const step = stepMap.get(stepId);
    if (step) {
      for (const dep of step.dependsOn) {
        dfs(dep);
      }
    }

    path.pop();
    recursionStack.delete(stepId);
  }

  for (const step of steps) {
    if (!visited.has(step.id)) {
      dfs(step.id);
    }
  }

  return cycles;
}
