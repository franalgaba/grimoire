/**
 * Compile-time type checker for SpellIR
 *
 * Operates on SpellIR (same input as the validator), walks all steps/guards,
 * and infers types bottom-up from expressions. Type issues are compile errors.
 */

import type { ActionConstraints } from "../types/actions.js";
import type { Expression } from "../types/expressions.js";
import type { CompilationError, CompilationWarning, SpellIR } from "../types/ir.js";
import type { AdvisoryOutputSchema, Step } from "../types/steps.js";

// =============================================================================
// SPELL TYPE SYSTEM
// =============================================================================

/** Primitive types in the Grimoire type system */
type PrimitiveType =
  | "number"
  | "bool"
  | "string"
  | "address"
  | "asset"
  | "bigint"
  | "action_result"
  | "void"
  | "any";

/** Compound types */
interface ArrayType {
  kind: "array";
  element: SpellType;
}

interface RecordType {
  kind: "record";
  fields?: Map<string, SpellType>;
}

/** The complete type vocabulary */
export type SpellType = PrimitiveType | ArrayType | RecordType;

// =============================================================================
// TYPE ENVIRONMENT
// =============================================================================

/** Type environment built from IR */
interface TypeEnv {
  params: Map<string, SpellType>;
  state: Map<string, SpellType>;
  bindings: Map<string, SpellType>;
  assets: Set<string>;
}

// =============================================================================
// TYPE CHECK RESULT
// =============================================================================

export interface TypeCheckResult {
  errors: CompilationError[];
  warnings: CompilationWarning[];
}

// =============================================================================
// BUILT-IN FUNCTION SIGNATURES
// =============================================================================

interface BuiltinSig {
  args: Array<[string, SpellType]>;
  returns: SpellType;
  variadic?: boolean; // If true, accepts 2+ args of the same type as the first arg
  minArgs?: number; // Minimum args for variadic functions
  optionalArgs?: Array<[string, SpellType]>; // Optional trailing arguments
}

const BUILTIN_SIGNATURES: Record<string, BuiltinSig> = {
  min: {
    args: [
      ["a", "number"],
      ["b", "number"],
    ],
    returns: "number",
    variadic: true,
    minArgs: 2,
  },
  max: {
    args: [
      ["a", "number"],
      ["b", "number"],
    ],
    returns: "number",
    variadic: true,
    minArgs: 2,
  },
  abs: { args: [["n", "number"]], returns: "number" },
  sum: { args: [["arr", { kind: "array", element: "number" }]], returns: "number" },
  avg: { args: [["arr", { kind: "array", element: "number" }]], returns: "number" },
  balance: {
    args: [["asset", "asset"]],
    optionalArgs: [["address", "address"]],
    returns: "bigint",
  },
  price: {
    args: [
      ["base", "asset"],
      ["quote", "asset"],
    ],
    optionalArgs: [["source", "string"]],
    returns: "number",
  },
  get_apy: {
    args: [
      ["venue", "any"],
      ["asset", "asset"],
    ],
    returns: "number",
  },
  get_health_factor: { args: [["venue", "any"]], returns: "number" },
  get_position: {
    args: [
      ["venue", "any"],
      ["asset", "asset"],
    ],
    returns: "bigint",
  },
  get_debt: {
    args: [
      ["venue", "any"],
      ["asset", "asset"],
    ],
    returns: "bigint",
  },
  to_number: { args: [["n", "bigint"]], returns: "number" },
  to_bigint: { args: [["n", "number"]], returns: "bigint" },
};

// =============================================================================
// TYPE FORMATTING
// =============================================================================

function formatSpellType(t: SpellType): string {
  if (typeof t === "string") return t;
  if (t.kind === "array") return `array<${formatSpellType(t.element)}>`;
  if (t.kind === "record") {
    if (!t.fields || t.fields.size === 0) return "record";
    const entries = [...t.fields.entries()].map(([k, v]) => `${k}: ${formatSpellType(v)}`);
    return `record{${entries.join(", ")}}`;
  }
  return "unknown";
}

// =============================================================================
// SUBTYPE / ASSIGNABILITY
// =============================================================================

function isAssignable(source: SpellType, target: SpellType): boolean {
  // any is compatible with everything
  if (source === "any" || target === "any") return true;

  // exact match for primitives
  if (typeof source === "string" && typeof target === "string") {
    if (source === target) return true;
    // subtypes: asset and address are subtypes of string
    if (target === "string" && (source === "asset" || source === "address")) return true;
    return false;
  }

  // array assignability
  if (
    typeof source === "object" &&
    source.kind === "array" &&
    typeof target === "object" &&
    target.kind === "array"
  ) {
    return isAssignable(source.element, target.element);
  }

  // record to record
  if (
    typeof source === "object" &&
    source.kind === "record" &&
    typeof target === "object" &&
    target.kind === "record"
  ) {
    // If target has no field requirements, any record is fine
    if (!target.fields || target.fields.size === 0) return true;
    if (!source.fields) return false;
    // structural: all target fields must be present and assignable
    for (const [key, targetType] of target.fields) {
      const sourceType = source.fields.get(key);
      if (!sourceType || !isAssignable(sourceType, targetType)) return false;
    }
    return true;
  }

  return false;
}

// =============================================================================
// TYPE INFERENCE FROM IR VALUES
// =============================================================================

/** Map ParamDef.type to SpellType */
function paramTypeToSpellType(t: string): SpellType {
  switch (t) {
    case "number":
    case "amount":
    case "bps":
    case "duration":
      return "number";
    case "bool":
      return "bool";
    case "address":
      return "address";
    case "asset":
      return "asset";
    case "string":
      return "string";
    default:
      return "any";
  }
}

/** Infer SpellType from a state field's initialValue */
function inferTypeFromValue(v: unknown): SpellType {
  if (v === null || v === undefined) return "any";
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "bool";
  if (typeof v === "string") {
    if (v.startsWith("0x")) return "address";
    return "string";
  }
  if (typeof v === "bigint") return "bigint";
  if (Array.isArray(v)) {
    if (v.length === 0) return { kind: "array", element: "any" };
    return { kind: "array", element: inferTypeFromValue(v[0]) };
  }
  if (typeof v === "object") return { kind: "record" };
  return "any";
}

/** Map AdvisoryOutputSchema to SpellType */
function advisorySchemaToSpellType(schema: AdvisoryOutputSchema): SpellType {
  switch (schema.type) {
    case "boolean":
      return "bool";
    case "number":
      return "number";
    case "string":
    case "enum":
      return "string";
    case "array":
      return {
        kind: "array",
        element: schema.items ? advisorySchemaToSpellType(schema.items) : "any",
      };
    case "object": {
      if (!schema.fields || Object.keys(schema.fields).length === 0) {
        return { kind: "record" };
      }
      const fields = new Map<string, SpellType>();
      for (const [key, fieldSchema] of Object.entries(schema.fields)) {
        fields.set(key, advisorySchemaToSpellType(fieldSchema));
      }
      return { kind: "record", fields };
    }
    default:
      return "any";
  }
}

// =============================================================================
// EXPRESSION TYPE INFERENCE
// =============================================================================

/** Arithmetic operators */
const ARITHMETIC_OPS = new Set(["+", "-", "*", "/", "%"]);
/** Comparison operators */
const COMPARISON_OPS = new Set(["==", "!=", "<", ">", "<=", ">="]);
/** Logical operators */
const LOGICAL_OPS = new Set(["AND", "OR"]);

function inferExprType(
  expr: Expression,
  env: TypeEnv,
  errors: CompilationError[],
  location: string
): SpellType {
  switch (expr.kind) {
    case "literal": {
      switch (expr.type) {
        case "int":
        case "float":
          return "number";
        case "bool":
          return "bool";
        case "string":
          return "string";
        case "address":
          return "address";
        case "json":
          // Could be array or record
          if (Array.isArray(expr.value)) return { kind: "array", element: "any" };
          if (expr.value !== null && typeof expr.value === "object") return { kind: "record" };
          return "any";
      }
      return "any";
    }

    case "param": {
      const t = env.params.get(expr.name);
      if (t) return t;
      // Unknown param — validator catches this, we just return any
      return "any";
    }

    case "state": {
      const key = `${expr.scope}:${expr.key}`;
      const t = env.state.get(key);
      if (t) return t;
      return "any";
    }

    case "binding": {
      const t = env.bindings.get(expr.name);
      if (t) return t;
      return "any";
    }

    case "item":
    case "index":
      // Context-dependent: item is the current loop element, index is number
      // Without loop context tracking, we use any for item and number for index
      return expr.kind === "index" ? "number" : "any";

    case "binary": {
      const leftType = inferExprType(expr.left, env, errors, location);
      const rightType = inferExprType(expr.right, env, errors, location);

      if (ARITHMETIC_OPS.has(expr.op)) {
        // Arithmetic: operands should be numeric
        if (leftType !== "any" && rightType !== "any") {
          // number op number -> number
          if (leftType === "number" && rightType === "number") return "number";
          // bigint op bigint -> bigint
          if (leftType === "bigint" && rightType === "bigint") return "bigint";
          // string + string -> string (concatenation), including subtypes (asset, address)
          if (expr.op === "+" && isStringLike(leftType) && isStringLike(rightType)) return "string";
          // Mismatch
          if (!isNumericType(leftType) || !isNumericType(rightType)) {
            errors.push({
              code: "TYPE_MISMATCH",
              message: `${location}: Arithmetic operator '${expr.op}' requires numeric operands, got ${formatSpellType(leftType)} and ${formatSpellType(rightType)}`,
            });
          } else if (leftType !== rightType) {
            errors.push({
              code: "TYPE_MISMATCH",
              message: `${location}: Arithmetic operator '${expr.op}' has mismatched operand types: ${formatSpellType(leftType)} and ${formatSpellType(rightType)}`,
            });
          }
        }
        // Default to number for arithmetic
        if (leftType === "bigint" || rightType === "bigint") return "bigint";
        return "number";
      }

      if (COMPARISON_OPS.has(expr.op)) {
        // Comparisons always return bool
        // Allow number/bigint auto-promotion for comparisons
        if (leftType !== "any" && rightType !== "any") {
          const leftNumeric = isNumericType(leftType);
          const rightNumeric = isNumericType(rightType);
          if (leftNumeric && rightNumeric) {
            // number vs bigint comparison is ok (auto-promotion)
          } else if (!isAssignable(leftType, rightType) && !isAssignable(rightType, leftType)) {
            errors.push({
              code: "TYPE_MISMATCH",
              message: `${location}: Comparison '${expr.op}' between incompatible types: ${formatSpellType(leftType)} and ${formatSpellType(rightType)}`,
            });
          }
        }
        return "bool";
      }

      if (LOGICAL_OPS.has(expr.op)) {
        // Logical ops require bool operands
        if (leftType !== "any" && leftType !== "bool") {
          errors.push({
            code: "TYPE_MISMATCH",
            message: `${location}: Logical operator '${expr.op}' requires bool operands, got ${formatSpellType(leftType)}`,
          });
        }
        if (rightType !== "any" && rightType !== "bool") {
          errors.push({
            code: "TYPE_MISMATCH",
            message: `${location}: Logical operator '${expr.op}' requires bool operands, got ${formatSpellType(rightType)}`,
          });
        }
        return "bool";
      }

      return "any";
    }

    case "unary": {
      const argType = inferExprType(expr.arg, env, errors, location);

      if (expr.op === "NOT") {
        if (argType !== "any" && argType !== "bool") {
          errors.push({
            code: "TYPE_MISMATCH",
            message: `${location}: NOT operator requires bool operand, got ${formatSpellType(argType)}`,
          });
        }
        return "bool";
      }

      if (expr.op === "-" || expr.op === "ABS") {
        if (argType !== "any" && !isNumericType(argType)) {
          errors.push({
            code: "TYPE_MISMATCH",
            message: `${location}: '${expr.op}' operator requires numeric operand, got ${formatSpellType(argType)}`,
          });
        }
        return argType === "bigint" ? "bigint" : "number";
      }

      return "any";
    }

    case "ternary": {
      const condType = inferExprType(expr.condition, env, errors, location);
      if (condType !== "any" && condType !== "bool") {
        errors.push({
          code: "TYPE_MISMATCH",
          message: `${location}: Ternary condition must be bool, got ${formatSpellType(condType)}`,
        });
      }

      const thenType = inferExprType(expr.then, env, errors, location);
      const elseType = inferExprType(expr.else, env, errors, location);

      // If one branch is any, return the other
      if (thenType === "any") return elseType;
      if (elseType === "any") return thenType;

      if (!isAssignable(thenType, elseType) && !isAssignable(elseType, thenType)) {
        errors.push({
          code: "TYPE_MISMATCH",
          message: `${location}: Ternary branches have incompatible types: ${formatSpellType(thenType)} and ${formatSpellType(elseType)}`,
        });
      }

      return thenType;
    }

    case "call": {
      const sig = BUILTIN_SIGNATURES[expr.fn];
      if (!sig) return "any";

      // Check argument count
      const requiredCount = sig.args.length;
      const optionalCount = sig.optionalArgs?.length ?? 0;
      const maxCount = requiredCount + optionalCount;

      if (sig.variadic) {
        const minArgs = sig.minArgs ?? sig.args.length;
        if (expr.args.length < minArgs) {
          errors.push({
            code: "WRONG_ARG_COUNT",
            message: `${location}: Function '${expr.fn}' expects at least ${minArgs} argument(s), got ${expr.args.length}`,
          });
          return sig.returns;
        }
      } else if (expr.args.length < requiredCount || expr.args.length > maxCount) {
        const expected = optionalCount > 0 ? `${requiredCount}–${maxCount}` : `${requiredCount}`;
        errors.push({
          code: "WRONG_ARG_COUNT",
          message: `${location}: Function '${expr.fn}' expects ${expected} argument(s), got ${expr.args.length}`,
        });
        return sig.returns;
      }

      // Check argument types
      for (let i = 0; i < expr.args.length; i++) {
        const argType = inferExprType(expr.args[i], env, errors, location);
        let sigArg: [string, SpellType];
        if (i < sig.args.length) {
          // For variadic functions, extra args use the type of the last required arg
          sigArg = sig.variadic ? sig.args[Math.min(i, sig.args.length - 1)] : sig.args[i];
        } else {
          // Optional arg
          sigArg = (sig.optionalArgs ?? [])[i - sig.args.length];
        }
        const expectedType = sigArg[1];
        if (argType !== "any" && !isAssignable(argType, expectedType)) {
          errors.push({
            code: "TYPE_MISMATCH",
            message: `${location}: Function '${expr.fn}' argument '${sigArg[0]}' expects ${formatSpellType(expectedType)}, got ${formatSpellType(argType)}`,
          });
        }
      }

      return sig.returns;
    }

    case "array_access": {
      const arrType = inferExprType(expr.array, env, errors, location);
      const idxType = inferExprType(expr.index, env, errors, location);

      if (idxType !== "any" && idxType !== "number") {
        errors.push({
          code: "TYPE_MISMATCH",
          message: `${location}: Array index must be number, got ${formatSpellType(idxType)}`,
        });
      }

      if (typeof arrType === "object" && arrType.kind === "array") {
        return arrType.element;
      }

      // Accessing a non-array — might be any
      if (arrType !== "any") {
        errors.push({
          code: "TYPE_MISMATCH",
          message: `${location}: Array access on non-array type ${formatSpellType(arrType)}`,
        });
      }
      return "any";
    }

    case "property_access": {
      const objType = inferExprType(expr.object, env, errors, location);

      if (typeof objType === "object" && objType.kind === "record" && objType.fields) {
        const fieldType = objType.fields.get(expr.property);
        if (fieldType) return fieldType;
      }

      // action_result properties are always any
      if (objType === "action_result") return "any";

      return "any";
    }
  }
}

/** Check if a type is numeric (number or bigint) */
function isNumericType(t: SpellType): boolean {
  return t === "number" || t === "bigint";
}

/** Check if a type is string-like (string, asset, address) */
function isStringLike(t: SpellType): boolean {
  return t === "string" || t === "asset" || t === "address";
}

// =============================================================================
// STEP TYPE CHECKING
// =============================================================================

function checkStep(step: Step, env: TypeEnv, errors: CompilationError[]): void {
  const loc = `step '${step.id}'`;

  switch (step.kind) {
    case "compute": {
      for (const assignment of step.assignments) {
        const exprType = inferExprType(assignment.expression, env, errors, loc);
        env.bindings.set(assignment.variable, exprType);
      }
      break;
    }

    case "action": {
      // Type-check amount expressions in actions
      const action = step.action;
      if ("amount" in action && action.amount !== "max" && typeof action.amount !== "bigint") {
        inferExprType(action.amount as Expression, env, errors, loc);
      }
      // Type-check 'to' field if it's an expression
      if (
        "to" in action &&
        typeof action.to === "object" &&
        action.to !== null &&
        "kind" in action.to
      ) {
        inferExprType(action.to as Expression, env, errors, loc);
      }
      // Type-check toChain if it's an expression
      if (
        "toChain" in action &&
        typeof action.toChain === "object" &&
        action.toChain !== null &&
        "kind" in action.toChain
      ) {
        inferExprType(action.toChain as Expression, env, errors, loc);
      }
      // Type-check constraint expressions
      checkConstraintExpressions(step.constraints, env, errors, loc);
      // Record output binding
      if (step.outputBinding) {
        env.bindings.set(step.outputBinding, "action_result");
      }
      break;
    }

    case "conditional": {
      const condType = inferExprType(step.condition, env, errors, loc);
      if (condType !== "any" && condType !== "bool") {
        errors.push({
          code: "TYPE_MISMATCH",
          message: `${loc}: Condition must be bool, got ${formatSpellType(condType)}`,
        });
      }
      break;
    }

    case "loop": {
      if (step.loopType.type === "until") {
        const condType = inferExprType(step.loopType.condition, env, errors, loc);
        if (condType !== "any" && condType !== "bool") {
          errors.push({
            code: "TYPE_MISMATCH",
            message: `${loc}: Loop 'until' condition must be bool, got ${formatSpellType(condType)}`,
          });
        }
      }
      if (step.loopType.type === "for") {
        const srcType = inferExprType(step.loopType.source, env, errors, loc);
        if (srcType !== "any" && (typeof srcType !== "object" || srcType.kind !== "array")) {
          errors.push({
            code: "TYPE_MISMATCH",
            message: `${loc}: 'for' loop source must be an array, got ${formatSpellType(srcType)}`,
          });
        }
        // Record loop variable type
        if (typeof srcType === "object" && srcType.kind === "array") {
          env.bindings.set(step.loopType.variable, srcType.element);
        } else {
          env.bindings.set(step.loopType.variable, "any");
        }
      }
      if (step.outputBinding) {
        env.bindings.set(step.outputBinding, { kind: "array", element: "any" });
      }
      break;
    }

    case "parallel": {
      // Check join strategy metric expression if present
      if (step.join.type === "best") {
        inferExprType(step.join.metric, env, errors, loc);
      }
      if (step.outputBinding) {
        env.bindings.set(step.outputBinding, { kind: "array", element: "any" });
      }
      break;
    }

    case "pipeline": {
      const srcType = inferExprType(step.source, env, errors, loc);
      // Pipeline source should be an array
      if (srcType !== "any" && (typeof srcType !== "object" || srcType.kind !== "array")) {
        errors.push({
          code: "TYPE_MISMATCH",
          message: `${loc}: Pipeline source must be an array, got ${formatSpellType(srcType)}`,
        });
      }
      // Check stage expressions
      for (const stage of step.stages) {
        if (stage.op === "where") {
          const predType = inferExprType(stage.predicate, env, errors, loc);
          if (predType !== "any" && predType !== "bool") {
            errors.push({
              code: "TYPE_MISMATCH",
              message: `${loc}: Pipeline 'where' predicate must be bool, got ${formatSpellType(predType)}`,
            });
          }
        }
        if (stage.op === "sort") {
          inferExprType(stage.by, env, errors, loc);
        }
        if (stage.op === "reduce") {
          inferExprType(stage.initial, env, errors, loc);
        }
      }
      if (step.outputBinding) {
        env.bindings.set(
          step.outputBinding,
          srcType !== "any" ? srcType : { kind: "array", element: "any" }
        );
      }
      break;
    }

    case "try": {
      // No expression-level type checks needed for try structure
      break;
    }

    case "advisory": {
      // Type-check context expressions
      if (step.context) {
        for (const [key, expr] of Object.entries(step.context)) {
          inferExprType(expr, env, errors, `${loc} context '${key}'`);
        }
      }
      // Type-check fallback expression
      inferExprType(step.fallback, env, errors, loc);
      // Record output binding with schema-derived type
      const outType = advisorySchemaToSpellType(step.outputSchema);
      env.bindings.set(step.outputBinding, outType);
      break;
    }

    case "emit": {
      for (const [key, expr] of Object.entries(step.data)) {
        inferExprType(expr, env, errors, `${loc} data '${key}'`);
      }
      break;
    }

    case "wait":
    case "halt":
      // No type checks needed
      break;
  }
}

/** Type-check constraint expressions */
function checkConstraintExpressions(
  constraints: ActionConstraints,
  env: TypeEnv,
  errors: CompilationError[],
  location: string
): void {
  const exprFields: Array<keyof ActionConstraints> = [
    "minOutput",
    "maxInput",
    "minLiquidity",
    "requireQuote",
    "requireSimulation",
    "maxGas",
  ];
  for (const field of exprFields) {
    const val = constraints[field];
    if (val && typeof val === "object" && "kind" in val) {
      inferExprType(val as Expression, env, errors, `${location} constraint '${field}'`);
    }
  }
}

// =============================================================================
// GUARD TYPE CHECKING
// =============================================================================

function checkGuard(
  guard: { id: string; check?: Expression; advisor?: string },
  env: TypeEnv,
  errors: CompilationError[]
): void {
  // Advisory guards have no expression to type-check
  if ("advisor" in guard && guard.advisor) return;

  // Expression guard: verify check resolves to bool
  if ("check" in guard && guard.check) {
    const loc = `guard '${guard.id}'`;
    const checkType = inferExprType(guard.check, env, errors, loc);
    if (checkType !== "any" && checkType !== "bool") {
      errors.push({
        code: "TYPE_MISMATCH",
        message: `${loc}: Guard check must be bool, got ${formatSpellType(checkType)}`,
      });
    }
  }
}

// =============================================================================
// MAIN ENTRY POINT
// =============================================================================

/**
 * Type-check a SpellIR and return errors and warnings.
 * Type issues block compilation.
 */
export function typeCheckIR(ir: SpellIR): TypeCheckResult {
  const errors: CompilationError[] = [];

  // Build type environment from IR
  const env: TypeEnv = {
    params: new Map(),
    state: new Map(),
    bindings: new Map(),
    assets: new Set(ir.assets.map((a) => a.symbol)),
  };

  // Populate param types
  for (const p of ir.params) {
    env.params.set(p.name, paramTypeToSpellType(p.type));
  }

  // Populate state types from initial values
  for (const [key, field] of Object.entries(ir.state.persistent)) {
    env.state.set(`persistent:${key}`, inferTypeFromValue(field.initialValue));
  }
  for (const [key, field] of Object.entries(ir.state.ephemeral)) {
    env.state.set(`ephemeral:${key}`, inferTypeFromValue(field.initialValue));
  }

  // Type-check all steps (order matters — bindings are accumulated)
  for (const step of ir.steps) {
    checkStep(step, env, errors);
  }

  // Type-check all guards
  for (const guard of ir.guards) {
    checkGuard(guard as { id: string; check?: Expression; advisor?: string }, env, errors);
  }

  return { errors, warnings: [] };
}
