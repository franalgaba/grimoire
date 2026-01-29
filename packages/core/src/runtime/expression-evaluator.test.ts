/**
 * Expression evaluator tests
 */

import { describe, expect, test } from "bun:test";
import type { Expression } from "../types/expressions.js";
import type { EvalContext } from "./expression-evaluator.js";
import { evaluate, evaluateAsync } from "./expression-evaluator.js";

const baseCtx: EvalContext = {
  params: new Map<string, unknown>([["x", 10]]),
  bindings: new Map<string, unknown>([
    ["arr", [1, 2, 3]],
    ["obj", { nested: { value: 5 } }],
    ["flag", true],
    ["big", 20n],
  ]),
  state: {
    persistent: new Map<string, unknown>([["counter", 7]]),
    ephemeral: new Map<string, unknown>([["temp", 3]]),
  },
  item: "item",
  index: 2,
};

describe("Expression Evaluator", () => {
  test("evaluates literals and bindings", () => {
    const expr: Expression = { kind: "literal", value: 42, type: "int" };
    expect(evaluate(expr, baseCtx)).toBe(42);

    const bindingExpr: Expression = { kind: "binding", name: "arr" };
    expect(evaluate(bindingExpr, baseCtx)).toEqual([1, 2, 3]);
  });

  test("evaluates params and state", () => {
    const paramExpr: Expression = { kind: "param", name: "x" };
    const persistentExpr: Expression = { kind: "state", scope: "persistent", key: "counter" };
    const ephemeralExpr: Expression = { kind: "state", scope: "ephemeral", key: "temp" };

    expect(evaluate(paramExpr, baseCtx)).toBe(10);
    expect(evaluate(persistentExpr, baseCtx)).toBe(7);
    expect(evaluate(ephemeralExpr, baseCtx)).toBe(3);
  });

  test("evaluates binary and unary expressions", () => {
    const expr: Expression = {
      kind: "binary",
      op: "+",
      left: { kind: "literal", value: 2, type: "int" },
      right: { kind: "literal", value: 3, type: "int" },
    };

    expect(evaluate(expr, baseCtx)).toBe(5);

    const boolExpr: Expression = {
      kind: "binary",
      op: "AND",
      left: { kind: "literal", value: true, type: "bool" },
      right: { kind: "literal", value: false, type: "bool" },
    };

    expect(evaluate(boolExpr, baseCtx)).toBe(false);

    const unaryExpr: Expression = {
      kind: "unary",
      op: "ABS",
      arg: { kind: "literal", value: -5, type: "int" },
    };

    expect(evaluate(unaryExpr, baseCtx)).toBe(5);
  });

  test("evaluates ternary, property, and array access", () => {
    const ternaryExpr: Expression = {
      kind: "ternary",
      condition: { kind: "literal", value: true, type: "bool" },
      then: { kind: "literal", value: 1, type: "int" },
      else: { kind: "literal", value: 0, type: "int" },
    };

    expect(evaluate(ternaryExpr, baseCtx)).toBe(1);

    const propertyExpr: Expression = {
      kind: "property_access",
      object: { kind: "binding", name: "obj" },
      property: "nested",
    };

    expect(evaluate(propertyExpr, baseCtx)).toEqual({ value: 5 });

    const arrayExpr: Expression = {
      kind: "array_access",
      array: { kind: "binding", name: "arr" },
      index: { kind: "literal", value: 1, type: "int" },
    };

    expect(evaluate(arrayExpr, baseCtx)).toBe(2);
  });

  test("evaluates call expressions", () => {
    const minExpr: Expression = {
      kind: "call",
      fn: "min",
      args: [
        { kind: "literal", value: 5, type: "int" },
        { kind: "literal", value: 8, type: "int" },
      ],
    };

    const sumExpr: Expression = {
      kind: "call",
      fn: "sum",
      args: [{ kind: "binding", name: "arr" }],
    };

    expect(evaluate(minExpr, baseCtx)).toBe(5);
    expect(evaluate(sumExpr, baseCtx)).toBe(6);
  });

  test("evaluates async call expressions", async () => {
    const ctx: EvalContext = {
      ...baseCtx,
      queryBalance: async () => 123n,
      queryPrice: async () => 2000,
      queryApy: async () => 0.05,
      queryHealthFactor: async () => 1.1,
      queryPosition: async () => ({ amount: 10n }),
      queryDebt: async () => 50n,
    };

    const balanceExpr: Expression = {
      kind: "call",
      fn: "balance",
      args: [
        { kind: "literal", value: "USDC", type: "string" },
        { kind: "literal", value: "0x0000000000000000000000000000000000000001", type: "address" },
      ],
    };

    const priceExpr: Expression = {
      kind: "call",
      fn: "price",
      args: [
        { kind: "literal", value: "ETH", type: "string" },
        { kind: "literal", value: "USD", type: "string" },
      ],
    };

    const apyExpr: Expression = {
      kind: "call",
      fn: "get_apy",
      args: [
        { kind: "literal", value: "aave", type: "string" },
        { kind: "literal", value: "USDC", type: "string" },
      ],
    };

    const healthExpr: Expression = {
      kind: "call",
      fn: "get_health_factor",
      args: [{ kind: "literal", value: "aave", type: "string" }],
    };

    const positionExpr: Expression = {
      kind: "call",
      fn: "get_position",
      args: [
        { kind: "literal", value: "aave", type: "string" },
        { kind: "literal", value: "USDC", type: "string" },
      ],
    };

    const debtExpr: Expression = {
      kind: "call",
      fn: "get_debt",
      args: [
        { kind: "literal", value: "aave", type: "string" },
        { kind: "literal", value: "USDC", type: "string" },
      ],
    };

    const maxExpr: Expression = {
      kind: "call",
      fn: "max",
      args: [
        { kind: "literal", value: 1, type: "int" },
        { kind: "literal", value: 2, type: "int" },
      ],
    };

    expect(await evaluateAsync(balanceExpr, ctx)).toBe(123n);
    expect(await evaluateAsync(priceExpr, ctx)).toBe(2000);
    expect(await evaluateAsync(apyExpr, ctx)).toBe(0.05);
    expect(await evaluateAsync(healthExpr, ctx)).toBe(1.1);
    expect(await evaluateAsync(positionExpr, ctx)).toEqual({ amount: 10n });
    expect(await evaluateAsync(debtExpr, ctx)).toBe(50n);
    expect(await evaluateAsync(maxExpr, ctx)).toBe(2);
  });

  test("handles bigint and string operations", () => {
    const bigintExpr: Expression = {
      kind: "binary",
      op: "+",
      left: { kind: "literal", value: 5n, type: "int" },
      right: { kind: "literal", value: 10n, type: "int" },
    };

    const mixedExpr: Expression = {
      kind: "binary",
      op: ">",
      left: { kind: "literal", value: 5n, type: "int" },
      right: { kind: "literal", value: 4, type: "int" },
    };

    const concatExpr: Expression = {
      kind: "binary",
      op: "+",
      left: { kind: "literal", value: "hello", type: "string" },
      right: { kind: "literal", value: "world", type: "string" },
    };

    expect(evaluate(bigintExpr, baseCtx)).toBe(15n);
    expect(evaluate(mixedExpr, baseCtx)).toBe(true);
    expect(evaluate(concatExpr, baseCtx)).toBe("helloworld");
  });

  test("supports item and index helpers", () => {
    const itemExpr: Expression = { kind: "item" };
    const indexExpr: Expression = { kind: "index" };

    expect(evaluate(itemExpr, baseCtx)).toBe("item");
    expect(evaluate(indexExpr, baseCtx)).toBe(2);
  });

  test("throws on invalid access", () => {
    const badArrayExpr: Expression = {
      kind: "array_access",
      array: { kind: "literal", value: "not-array", type: "string" },
      index: { kind: "literal", value: 0, type: "int" },
    };

    expect(() => evaluate(badArrayExpr, baseCtx)).toThrow("Cannot index non-array value");

    const badPropertyExpr: Expression = {
      kind: "property_access",
      object: { kind: "literal", value: 123, type: "int" },
      property: "foo",
    };

    expect(() => evaluate(badPropertyExpr, baseCtx)).toThrow(
      "Cannot access property on non-object value"
    );
  });

  test("throws on missing bindings and params", () => {
    const ctx: EvalContext = {
      ...baseCtx,
      params: new Map(),
      bindings: new Map(),
      state: { persistent: new Map(), ephemeral: new Map() },
      item: undefined,
      index: undefined,
    };

    expect(() => evaluate({ kind: "param", name: "missing" }, ctx)).toThrow("Unknown parameter");
    expect(() => evaluate({ kind: "binding", name: "missing" }, ctx)).toThrow("Unknown binding");
    expect(() => evaluate({ kind: "state", scope: "persistent", key: "missing" }, ctx)).toThrow(
      "Unknown state key"
    );
    expect(() => evaluate({ kind: "item" }, ctx)).toThrow("item");
    expect(() => evaluate({ kind: "index" }, ctx)).toThrow("index");
  });

  test("throws when async helpers missing", async () => {
    const ctx: EvalContext = {
      ...baseCtx,
      queryBalance: undefined,
    };

    const balanceExpr: Expression = {
      kind: "call",
      fn: "balance",
      args: [{ kind: "literal", value: "USDC", type: "string" }],
    };

    await expect(evaluateAsync(balanceExpr, ctx)).rejects.toThrow("Balance queries not available");
  });
});
