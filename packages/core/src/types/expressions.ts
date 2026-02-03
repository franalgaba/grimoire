/**
 * Expression types for the Grimoire IR
 */

/** Binary operators */
export type BinaryOp =
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "=="
  | "!="
  | "<"
  | ">"
  | "<="
  | ">="
  | "AND"
  | "OR";

/** Unary operators */
export type UnaryOp = "NOT" | "-" | "ABS";

/** Built-in function names */
export type BuiltinFn =
  | "balance"
  | "price"
  | "get_apy"
  | "get_health_factor"
  | "get_position"
  | "get_debt"
  | "min"
  | "max"
  | "abs"
  | "sum"
  | "avg";

/** Expression IR node types */
export type Expression =
  // Literals
  | LiteralExpr
  // References
  | ParamExpr
  | StateExpr
  | BindingExpr
  | ItemExpr
  | IndexExpr
  // Operations
  | BinaryExpr
  | UnaryExpr
  | TernaryExpr
  // Function calls
  | CallExpr
  // Array/object access
  | ArrayAccessExpr
  | PropertyAccessExpr;

/** Literal value */
export interface LiteralExpr {
  kind: "literal";
  value: string | number | boolean | bigint | Record<string, unknown> | unknown[] | null;
  type: "int" | "float" | "bool" | "string" | "address" | "json";
}

/** Parameter reference */
export interface ParamExpr {
  kind: "param";
  name: string;
}

/** State reference */
export interface StateExpr {
  kind: "state";
  scope: "persistent" | "ephemeral";
  key: string;
}

/** Binding reference (from previous step) */
export interface BindingExpr {
  kind: "binding";
  name: string;
}

/** Current item in loop/pipeline */
export interface ItemExpr {
  kind: "item";
}

/** Current index in loop/pipeline */
export interface IndexExpr {
  kind: "index";
}

/** Binary operation */
export interface BinaryExpr {
  kind: "binary";
  op: BinaryOp;
  left: Expression;
  right: Expression;
}

/** Unary operation */
export interface UnaryExpr {
  kind: "unary";
  op: UnaryOp;
  arg: Expression;
}

/** Ternary (conditional) operation */
export interface TernaryExpr {
  kind: "ternary";
  condition: Expression;
  then: Expression;
  else: Expression;
}

/** Function call */
export interface CallExpr {
  kind: "call";
  fn: BuiltinFn;
  args: Expression[];
}

/** Array index access */
export interface ArrayAccessExpr {
  kind: "array_access";
  array: Expression;
  index: Expression;
}

/** Object property access */
export interface PropertyAccessExpr {
  kind: "property_access";
  object: Expression;
  property: string;
}

/**
 * Helper to create literal expressions
 */
export function literal(
  value: string | number | boolean | bigint | Record<string, unknown> | unknown[] | null,
  type?: LiteralExpr["type"]
): LiteralExpr {
  const inferredType =
    type ??
    (typeof value === "string"
      ? value.startsWith("0x")
        ? "address"
        : "string"
      : typeof value === "boolean"
        ? "bool"
        : typeof value === "bigint"
          ? "int"
          : typeof value === "number"
            ? Number.isInteger(value)
              ? "int"
              : "float"
            : "json");

  return { kind: "literal", value, type: inferredType };
}

/**
 * Helper to create param reference
 */
export function param(name: string): ParamExpr {
  return { kind: "param", name };
}

/**
 * Helper to create binding reference
 */
export function binding(name: string): BindingExpr {
  return { kind: "binding", name };
}

/**
 * Helper to create binary expression
 */
export function binary(op: BinaryOp, left: Expression, right: Expression): BinaryExpr {
  return { kind: "binary", op, left, right };
}

/**
 * Helper to create function call
 */
export function call(fn: BuiltinFn, ...args: Expression[]): CallExpr {
  return { kind: "call", fn, args };
}
