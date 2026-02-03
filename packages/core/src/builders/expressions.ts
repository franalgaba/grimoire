/**
 * Expression builders - fluent API for creating expressions
 */

import type {
  ArrayAccessExpr,
  BinaryExpr,
  BinaryOp,
  BindingExpr,
  BuiltinFn,
  CallExpr,
  Expression,
  LiteralExpr,
  ParamExpr,
  PropertyAccessExpr,
} from "../types/index.js";

/**
 * Create a literal expression
 */
export function literal(
  value: number | string | boolean | Record<string, unknown> | unknown[] | null
): LiteralExpr {
  const type: LiteralExpr["type"] =
    typeof value === "string"
      ? value.startsWith("0x")
        ? "address"
        : "string"
      : typeof value === "boolean"
        ? "bool"
        : typeof value === "number"
          ? Number.isInteger(value)
            ? "int"
            : "float"
          : "json";

  return { kind: "literal", value, type };
}

/**
 * Create a parameter reference expression
 */
export function param(name: string): ParamExpr {
  return { kind: "param", name };
}

/**
 * Create a binding reference expression
 */
export function binding(name: string): BindingExpr {
  return { kind: "binding", name };
}

/**
 * Create a binary expression
 */
export function binary(left: Expression, op: BinaryOp, right: Expression): BinaryExpr {
  return { kind: "binary", op, left, right };
}

/**
 * Create a function call expression
 */
export function call(fn: BuiltinFn, args: Expression[]): CallExpr {
  return { kind: "call", fn, args };
}

/**
 * Create an array access expression
 */
export function arrayAccess(array: Expression, index: Expression): ArrayAccessExpr {
  return { kind: "array_access", array, index };
}

/**
 * Create a property access expression
 */
export function propertyAccess(object: Expression, property: string): PropertyAccessExpr {
  return { kind: "property_access", object, property };
}
