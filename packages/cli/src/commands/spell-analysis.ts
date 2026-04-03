/**
 * Static analysis helpers for SpellIR.
 *
 * Used by simulate/cast to decide whether a provider is needed.
 */

import type { Expression, SpellIR } from "@grimoirelabs/core";

const QUERY_FNS = new Set([
  "balance",
  "price",
  "apy",
  "metric",
  "get_health_factor",
  "get_position",
  "get_debt",
]);

function exprUsesQueryFn(expr: Expression): boolean {
  if (!expr || typeof expr !== "object") return false;
  if (expr.kind === "call" && QUERY_FNS.has(expr.fn)) return true;
  if ("args" in expr && Array.isArray(expr.args)) {
    return expr.args.some((a: Expression) => exprUsesQueryFn(a));
  }
  if ("left" in expr) {
    const binExpr = expr as { left: Expression; right: Expression };
    return exprUsesQueryFn(binExpr.left) || exprUsesQueryFn(binExpr.right);
  }
  if ("operand" in expr) {
    return exprUsesQueryFn((expr as { operand: Expression }).operand);
  }
  if ("condition" in expr) {
    const ternExpr = expr as { condition: Expression; then: Expression; else: Expression };
    return (
      exprUsesQueryFn(ternExpr.condition) ||
      exprUsesQueryFn(ternExpr.then) ||
      exprUsesQueryFn(ternExpr.else)
    );
  }
  return false;
}

export function spellUsesQueryFunctions(spell: SpellIR): boolean {
  for (const guard of spell.guards) {
    if (
      "check" in guard &&
      typeof guard.check === "object" &&
      exprUsesQueryFn(guard.check as Expression)
    ) {
      return true;
    }
  }
  for (const step of spell.steps) {
    if (step.kind === "compute") {
      for (const assignment of step.assignments) {
        if (exprUsesQueryFn(assignment.expression)) return true;
      }
    }
    if (step.kind === "conditional" && exprUsesQueryFn(step.condition)) return true;
  }
  return false;
}
