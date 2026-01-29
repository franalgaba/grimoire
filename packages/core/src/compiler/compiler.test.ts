/**
 * Compiler tests
 */

import { describe, expect, test } from "bun:test";
import { compile, parseExpression, tryParseExpression } from "./index.js";

describe("Expression Parser", () => {
  test("parses literals", () => {
    expect(parseExpression("42")).toEqual({ kind: "literal", value: 42, type: "int" });
    expect(parseExpression("3.14")).toEqual({ kind: "literal", value: 3.14, type: "float" });
    expect(parseExpression("true")).toEqual({ kind: "literal", value: true, type: "bool" });
    expect(parseExpression("false")).toEqual({ kind: "literal", value: false, type: "bool" });
    expect(parseExpression('"hello"')).toEqual({ kind: "literal", value: "hello", type: "string" });
  });

  test("parses addresses", () => {
    const addr = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
    expect(parseExpression(addr)).toEqual({ kind: "literal", value: addr, type: "address" });
  });

  test("parses param references", () => {
    expect(parseExpression("params.amount")).toEqual({ kind: "param", name: "amount" });
    expect(parseExpression("params.my_param")).toEqual({ kind: "param", name: "my_param" });
  });

  test("parses state references", () => {
    expect(parseExpression("state.persistent.total")).toEqual({
      kind: "state",
      scope: "persistent",
      key: "total",
    });
    expect(parseExpression("state.ephemeral.temp")).toEqual({
      kind: "state",
      scope: "ephemeral",
      key: "temp",
    });
  });

  test("parses binary operators", () => {
    const expr = parseExpression("1 + 2");
    expect(expr).toEqual({
      kind: "binary",
      op: "+",
      left: { kind: "literal", value: 1, type: "int" },
      right: { kind: "literal", value: 2, type: "int" },
    });
  });

  test("parses comparison operators", () => {
    const expr = parseExpression("a >= 10");
    if (expr.kind !== "binary") {
      throw new Error("Expected binary expression");
    }
    expect(expr.op).toBe(">=");
  });

  test("parses logical operators", () => {
    const expr = parseExpression("a AND b OR c");
    if (expr.kind !== "binary") {
      throw new Error("Expected binary expression");
    }
    expect(expr.op).toBe("OR");
  });

  test("parses function calls", () => {
    const expr = parseExpression("balance(USDC)");
    expect(expr).toEqual({
      kind: "call",
      fn: "balance",
      args: [{ kind: "binding", name: "USDC" }],
    });
  });

  test("parses nested function calls", () => {
    const expr = parseExpression("min(balance(USDC), 1000)");
    if (expr.kind !== "call") {
      throw new Error("Expected call expression");
    }
    expect(expr.fn).toBe("min");
    expect(expr.args).toHaveLength(2);
  });

  test("parses ternary expressions", () => {
    const expr = parseExpression("a > 0 ? a : 0");
    expect(expr.kind).toBe("ternary");
  });

  test("respects operator precedence", () => {
    // Multiplication before addition
    const expr = parseExpression("1 + 2 * 3");
    if (expr.kind !== "binary") {
      throw new Error("Expected binary expression");
    }
    expect(expr.op).toBe("+");
    expect(expr.right.kind).toBe("binary");
    if (expr.right.kind === "binary") {
      expect(expr.right.op).toBe("*");
    }
  });

  test("tryParseExpression returns null on failure", () => {
    const expr = tryParseExpression("1 +");
    expect(expr).toBeNull();
  });
});

describe("Spell Compiler (Grimoire Syntax)", () => {
  test("compiles minimal spell", () => {
    const source = `spell TestSpell

  version: "1.0.0"

  on manual:
    x = 42
`;
    const result = compile(source);
    if (!result.success) {
      console.log("Errors:", result.errors);
      console.log("Warnings:", result.warnings);
    }
    expect(result.success).toBe(true);
    expect(result.ir).toBeDefined();
    expect(result.ir?.id).toBe("TestSpell");
    expect(result.ir?.version).toBe("1.0.0");
    expect(result.ir?.steps.length).toBeGreaterThan(0);
  });

  test("compiles spell with venues and assets", () => {
    const source = `spell SwapSpell

  version: "1.0.0"

  assets: [USDC, ETH]

  venues:
    swap: @uniswap

  on manual:
    x = 100
`;
    const result = compile(source);
    if (!result.success) {
      console.log("Errors:", result.errors);
    }
    expect(result.success).toBe(true);
    expect(result.ir?.aliases).toHaveLength(1);
    expect(result.ir?.aliases[0]?.alias).toBe("uniswap");
    expect(result.ir?.assets).toHaveLength(2);
  });

  test("compiles spell with params", () => {
    const source = `spell ParamSpell

  version: "1.0.0"

  params:
    amount: 1000
    threshold: 500

  on manual:
    x = params.amount + params.threshold
`;
    const result = compile(source);
    if (!result.success) {
      console.log("Errors:", result.errors);
    }
    expect(result.success).toBe(true);
    expect(result.ir?.params).toHaveLength(2);

    const amountParam = result.ir?.params.find((p) => p.name === "amount");
    expect(amountParam?.default).toBe(1000);
  });

  test("compiles spell with limits", () => {
    const source = `spell LimitSpell

  version: "1.0.0"

  limits:
    max_allocation: 50%
    min_threshold: 0.5%

  on manual:
    x = 100
`;
    const result = compile(source);
    if (!result.success) {
      console.log("Errors:", result.errors);
    }
    expect(result.success).toBe(true);
    // Limits are stored as params with limit_ prefix
    expect(result.ir?.params.some((p) => p.name === "limit_max_allocation")).toBe(true);
  });

  test("compiles spell with conditional", () => {
    const source = `spell ConditionalSpell

  version: "1.0.0"

  on manual:
    x = 100
    if x > 50:
      y = 1
    else:
      y = 0
`;
    const result = compile(source);
    if (!result.success) {
      console.log("Errors:", result.errors);
    }
    expect(result.success).toBe(true);
    const conditionalStep = result.ir?.steps.find((s) => s.kind === "conditional");
    expect(conditionalStep).toBeDefined();
  });

  test("compiles spell with for loop", () => {
    const source = `spell LoopSpell

  version: "1.0.0"

  on manual:
    for item in items:
      x = item
`;
    const result = compile(source);
    if (!result.success) {
      console.log("Errors:", result.errors);
    }
    expect(result.success).toBe(true);
    const loopStep = result.ir?.steps.find((s) => s.kind === "loop");
    expect(loopStep).toBeDefined();
  });

  test("compiles spell with emit", () => {
    const source = `spell EmitSpell

  version: "1.0.0"

  on manual:
    emit done(value=42)
`;
    const result = compile(source);
    if (!result.success) {
      console.log("Errors:", result.errors);
    }
    expect(result.success).toBe(true);
    const emitStep = result.ir?.steps.find((s) => s.kind === "emit");
    expect(emitStep).toBeDefined();
  });

  test("compiles spell with wait", () => {
    const source = `spell WaitSpell

  version: "1.0.0"

  on manual:
    wait 60
`;
    const result = compile(source);
    if (!result.success) {
      console.log("Errors:", result.errors);
    }
    expect(result.success).toBe(true);
    const waitStep = result.ir?.steps.find((s) => s.kind === "wait");
    expect(waitStep).toBeDefined();
  });

  test("compiles spell with halt", () => {
    const source = `spell HaltSpell

  version: "1.0.0"

  on manual:
    halt "stopped"
`;
    const result = compile(source);
    if (!result.success) {
      console.log("Errors:", result.errors);
    }
    expect(result.success).toBe(true);
    const haltStep = result.ir?.steps.find((s) => s.kind === "halt");
    expect(haltStep).toBeDefined();
  });

  test("compiles spell with hourly trigger", () => {
    const source = `spell HourlySpell

  version: "1.0.0"

  on hourly:
    x = 1
`;
    const result = compile(source);
    if (!result.success) {
      console.log("Errors:", result.errors);
    }
    expect(result.success).toBe(true);
    expect(result.ir?.triggers).toHaveLength(1);
    expect(result.ir?.triggers[0]?.type).toBe("schedule");
  });

  test("compiles spell with daily trigger", () => {
    const source = `spell DailySpell

  version: "1.0.0"

  on daily:
    x = 1
`;
    const result = compile(source);
    if (!result.success) {
      console.log("Errors:", result.errors);
    }
    expect(result.success).toBe(true);
    expect(result.ir?.triggers).toHaveLength(1);
    expect(result.ir?.triggers[0]?.type).toBe("schedule");
  });

  test("reports errors for missing spell body", () => {
    const source = "spell Test";
    const result = compile(source);
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("reports errors for invalid syntax", () => {
    const source = "spell";
    const result = compile(source);
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("compiles complex spell with multiple sections", () => {
    const source = `spell ComplexSpell

  version: "2.0.0"
  description: "A complex test spell"
  assets: [USDC, DAI, USDT]

  params:
    min_amount: 100
    max_amount: 10000

  limits:
    max_per_venue: 50%

  venues:
    lending: [@aave, @compound]
    swap: @uniswap

  on hourly:
    x = params.min_amount * 2
    if x > 100:
      y = x + 50
      emit success(value=y)
    else:
      emit failure(value=x)
`;
    const result = compile(source);
    if (!result.success) {
      console.log("Errors:", result.errors);
    }
    expect(result.success).toBe(true);
    expect(result.ir?.id).toBe("ComplexSpell");
    expect(result.ir?.version).toBe("2.0.0");
    expect(result.ir?.meta.description).toBe("A complex test spell");
    expect(result.ir?.assets.length).toBe(3);
    expect(result.ir?.params.length).toBeGreaterThan(0);
    expect(result.ir?.aliases.length).toBe(3); // aave, compound, uniswap
  });
});
