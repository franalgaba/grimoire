/**
 * Expression Evaluator
 * Evaluates Expression IR nodes to concrete values
 */

import type { ExecutionContext } from "../types/execution.js";
import type { BuiltinFn, Expression } from "../types/expressions.js";

export type EvalValue =
  | string
  | number
  | boolean
  | bigint
  | unknown[]
  | Record<string, unknown>
  | null;

export interface EvalContext {
  params: Map<string, unknown>;
  bindings: Map<string, unknown>;
  state: {
    persistent: Map<string, unknown>;
    ephemeral: Map<string, unknown>;
  };
  item?: unknown;
  index?: number;
  // Blockchain query functions (injected)
  queryBalance?: (asset: string, address?: string) => Promise<bigint>;
  queryPrice?: (base: string, quote: string, source?: string) => Promise<number>;
  queryApy?: (venue: string, asset: string) => Promise<number>;
  queryHealthFactor?: (venue: string) => Promise<number>;
  queryPosition?: (venue: string, asset: string) => Promise<unknown>;
  queryDebt?: (venue: string, asset: string) => Promise<bigint>;
}

/**
 * Evaluate an expression synchronously (for non-async expressions)
 */
export function evaluate(expr: Expression, ctx: EvalContext): EvalValue {
  switch (expr.kind) {
    case "literal":
      return expr.value as EvalValue;

    case "param": {
      const value = ctx.params.get(expr.name);
      if (value === undefined) {
        throw new Error(`Unknown parameter: ${expr.name}`);
      }
      return value as EvalValue;
    }

    case "state": {
      const stateMap = expr.scope === "persistent" ? ctx.state.persistent : ctx.state.ephemeral;
      const value = stateMap.get(expr.key);
      if (value === undefined) {
        throw new Error(`Unknown state key: ${expr.scope}.${expr.key}`);
      }
      return value as EvalValue;
    }

    case "binding": {
      const value = ctx.bindings.get(expr.name);
      if (value === undefined) {
        throw new Error(`Unknown binding: ${expr.name}`);
      }
      return value as EvalValue;
    }

    case "item":
      if (ctx.item === undefined) {
        throw new Error("'item' is only available inside loops/pipelines");
      }
      return ctx.item as EvalValue;

    case "index":
      if (ctx.index === undefined) {
        throw new Error("'index' is only available inside loops/pipelines");
      }
      return ctx.index;

    case "binary":
      return evaluateBinary(expr.op, evaluate(expr.left, ctx), evaluate(expr.right, ctx));

    case "unary":
      return evaluateUnary(expr.op, evaluate(expr.arg, ctx));

    case "ternary": {
      const condition = evaluate(expr.condition, ctx);
      return condition ? evaluate(expr.then, ctx) : evaluate(expr.else, ctx);
    }

    case "call":
      return evaluateCall(
        expr.fn,
        expr.args.map((a) => evaluate(a, ctx))
      );

    case "array_access": {
      const array = evaluate(expr.array, ctx);
      const index = evaluate(expr.index, ctx);
      if (!Array.isArray(array)) {
        throw new Error("Cannot index non-array value");
      }
      if (typeof index !== "number") {
        throw new Error("Array index must be a number");
      }
      return array[index] as EvalValue;
    }

    case "property_access": {
      const obj = evaluate(expr.object, ctx);
      if (typeof obj !== "object" || obj === null) {
        throw new Error("Cannot access property on non-object value");
      }
      return (obj as Record<string, unknown>)[expr.property] as EvalValue;
    }

    default:
      throw new Error(`Unknown expression kind: ${(expr as Expression).kind}`);
  }
}

/**
 * Evaluate an expression asynchronously (for blockchain queries)
 */
export async function evaluateAsync(expr: Expression, ctx: EvalContext): Promise<EvalValue> {
  switch (expr.kind) {
    case "call":
      return evaluateCallAsync(expr.fn, expr.args, ctx);

    case "binary": {
      const [left, right] = await Promise.all([
        evaluateAsync(expr.left, ctx),
        evaluateAsync(expr.right, ctx),
      ]);
      return evaluateBinary(expr.op, left, right);
    }

    case "unary":
      return evaluateUnary(expr.op, await evaluateAsync(expr.arg, ctx));

    case "ternary": {
      const condition = await evaluateAsync(expr.condition, ctx);
      return condition ? await evaluateAsync(expr.then, ctx) : await evaluateAsync(expr.else, ctx);
    }

    case "array_access": {
      const array = await evaluateAsync(expr.array, ctx);
      const index = await evaluateAsync(expr.index, ctx);
      if (!Array.isArray(array)) {
        throw new Error("Cannot index non-array value");
      }
      if (typeof index !== "number") {
        throw new Error("Array index must be a number");
      }
      return array[index] as EvalValue;
    }

    case "property_access": {
      const obj = await evaluateAsync(expr.object, ctx);
      if (typeof obj !== "object" || obj === null) {
        throw new Error("Cannot access property on non-object value");
      }
      return (obj as Record<string, unknown>)[expr.property] as EvalValue;
    }

    default:
      // Non-async expressions
      return evaluate(expr, ctx);
  }
}

/**
 * Evaluate binary operation
 */
function evaluateBinary(op: string, left: EvalValue, right: EvalValue): EvalValue {
  // Numeric operations
  if (typeof left === "number" && typeof right === "number") {
    switch (op) {
      case "+":
        return left + right;
      case "-":
        return left - right;
      case "*":
        return left * right;
      case "/":
        return left / right;
      case "%":
        return left % right;
      case "<":
        return left < right;
      case ">":
        return left > right;
      case "<=":
        return left <= right;
      case ">=":
        return left >= right;
      case "==":
        return left === right;
      case "!=":
        return left !== right;
    }
  }

  // BigInt operations
  if (typeof left === "bigint" && typeof right === "bigint") {
    switch (op) {
      case "+":
        return left + right;
      case "-":
        return left - right;
      case "*":
        return left * right;
      case "/":
        return left / right;
      case "%":
        return left % right;
      case "<":
        return left < right;
      case ">":
        return left > right;
      case "<=":
        return left <= right;
      case ">=":
        return left >= right;
      case "==":
        return left === right;
      case "!=":
        return left !== right;
    }
  }

  // Mixed bigint/number comparisons
  if (
    (typeof left === "bigint" && typeof right === "number") ||
    (typeof left === "number" && typeof right === "bigint")
  ) {
    const l = BigInt(left as number | bigint);
    const r = BigInt(right as number | bigint);
    switch (op) {
      case "<":
        return l < r;
      case ">":
        return l > r;
      case "<=":
        return l <= r;
      case ">=":
        return l >= r;
      case "==":
        return l === r;
      case "!=":
        return l !== r;
    }
  }

  // String concatenation
  if (typeof left === "string" && typeof right === "string" && op === "+") {
    return left + right;
  }

  // Boolean operations
  if (typeof left === "boolean" && typeof right === "boolean") {
    switch (op) {
      case "AND":
        return left && right;
      case "OR":
        return left || right;
      case "==":
        return left === right;
      case "!=":
        return left !== right;
    }
  }

  // Logical operations on truthy/falsy values
  switch (op) {
    case "AND":
      return Boolean(left) && Boolean(right);
    case "OR":
      return Boolean(left) || Boolean(right);
    case "==":
      return left === right;
    case "!=":
      return left !== right;
  }

  throw new Error(`Unsupported binary operation: ${typeof left} ${op} ${typeof right}`);
}

/**
 * Evaluate unary operation
 */
function evaluateUnary(op: string, arg: EvalValue): EvalValue {
  switch (op) {
    case "NOT":
      return !arg;
    case "-":
      if (typeof arg === "number") return -arg;
      if (typeof arg === "bigint") return -arg;
      throw new Error(`Cannot negate ${typeof arg}`);
    case "ABS":
      if (typeof arg === "number") return Math.abs(arg);
      if (typeof arg === "bigint") return arg < 0n ? -arg : arg;
      throw new Error(`Cannot take abs of ${typeof arg}`);
    default:
      throw new Error(`Unknown unary operator: ${op}`);
  }
}

/**
 * Evaluate synchronous function call
 */
function evaluateCall(fn: BuiltinFn, args: EvalValue[]): EvalValue {
  switch (fn) {
    case "min": {
      const [a, b] = args;
      if (typeof a === "number" && typeof b === "number") return Math.min(a, b);
      if (typeof a === "bigint" && typeof b === "bigint") return a < b ? a : b;
      throw new Error("min requires two numbers");
    }

    case "max": {
      const [a, b] = args;
      if (typeof a === "number" && typeof b === "number") return Math.max(a, b);
      if (typeof a === "bigint" && typeof b === "bigint") return a > b ? a : b;
      throw new Error("max requires two numbers");
    }

    case "abs": {
      const [a] = args;
      if (typeof a === "number") return Math.abs(a);
      if (typeof a === "bigint") return a < 0n ? -a : a;
      throw new Error("abs requires a number");
    }

    case "sum": {
      const [arr] = args;
      if (!Array.isArray(arr)) throw new Error("sum requires an array");
      if (arr.length === 0) return 0;
      if (typeof arr[0] === "bigint") {
        return arr.reduce((sum: bigint, v) => sum + (v as bigint), 0n);
      }
      return arr.reduce((sum: number, v) => sum + (v as number), 0);
    }

    case "avg": {
      const [arr] = args;
      if (!Array.isArray(arr)) throw new Error("avg requires an array");
      if (arr.length === 0) return 0;
      const sum = arr.reduce((s: number, v) => s + (v as number), 0);
      return sum / arr.length;
    }

    // Async functions should not be called synchronously
    case "balance":
    case "price":
    case "get_apy":
    case "get_health_factor":
    case "get_position":
    case "get_debt":
      throw new Error(`Function '${fn}' requires async evaluation`);

    default:
      throw new Error(`Unknown function: ${fn}`);
  }
}

/**
 * Evaluate async function call (blockchain queries)
 */
async function evaluateCallAsync(
  fn: BuiltinFn,
  argExprs: Expression[],
  ctx: EvalContext
): Promise<EvalValue> {
  // First evaluate all arguments
  const args = await Promise.all(argExprs.map((a) => evaluateAsync(a, ctx)));

  switch (fn) {
    case "balance": {
      if (!ctx.queryBalance) {
        throw new Error("Balance queries not available in this context");
      }
      const [asset, address] = args;
      return ctx.queryBalance(asset as string, address as string | undefined);
    }

    case "price": {
      if (!ctx.queryPrice) {
        throw new Error("Price queries not available in this context");
      }
      const [base, quote, source] = args;
      return ctx.queryPrice(base as string, quote as string, source as string | undefined);
    }

    case "get_apy": {
      if (!ctx.queryApy) {
        throw new Error("APY queries not available in this context");
      }
      const [venue, asset] = args;
      return ctx.queryApy(venue as string, asset as string);
    }

    case "get_health_factor": {
      if (!ctx.queryHealthFactor) {
        throw new Error("Health factor queries not available in this context");
      }
      const [venue] = args;
      return ctx.queryHealthFactor(venue as string);
    }

    case "get_position": {
      if (!ctx.queryPosition) {
        throw new Error("Position queries not available in this context");
      }
      const [venue, asset] = args;
      return ctx.queryPosition(venue as string, asset as string) as Promise<EvalValue>;
    }

    case "get_debt": {
      if (!ctx.queryDebt) {
        throw new Error("Debt queries not available in this context");
      }
      const [venue, asset] = args;
      return ctx.queryDebt(venue as string, asset as string);
    }

    // Sync functions
    case "min":
    case "max":
    case "abs":
    case "sum":
    case "avg":
      return evaluateCall(fn, args);

    default:
      throw new Error(`Unknown function: ${fn}`);
  }
}

/**
 * Create an evaluation context from execution context
 */
export function createEvalContext(execCtx: ExecutionContext): EvalContext {
  const params = new Map<string, unknown>();
  for (const param of execCtx.spell.params) {
    params.set(param.name, execCtx.bindings.get(param.name) ?? param.default);
  }

  return {
    params,
    bindings: execCtx.bindings,
    state: execCtx.state,
  };
}
