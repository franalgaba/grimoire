/**
 * E2E validation for strict type checking + conversion builtins
 *
 * Validates:
 * 1. to_number(balance(X)) * price(X, Y) compiles with zero errors
 * 2. balance(X) * price(X, Y) (no conversion) => TYPE_MISMATCH error, success: false
 * 3. All fixture .spell files compile with zero type errors
 * 4. Comparison auto-promotion still works (bigint > number)
 * 5. Wrong arg types to conversion builtins produce errors
 * 6. Complex real-world DeFi patterns compile cleanly
 * 7. Runtime evaluation of to_number() / to_bigint()
 */

import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { compile, compileFile } from "./compiler/index.js";
import { type EvalContext, evaluate } from "./runtime/expression-evaluator.js";
import type { Expression } from "./types/expressions.js";
import type { SpellIR } from "./types/ir.js";

function assertIR(
  result: ReturnType<typeof compile>
): asserts result is { success: true; ir: SpellIR; errors: never[]; warnings: never[] } {
  if (!result.success || !result.ir) {
    throw new Error(
      `Expected successful compilation but got errors: ${result.errors.map((e) => e.message).join("; ")}`
    );
  }
}

// =============================================================================
// E2E: COMPILATION — WELL-TYPED SPELLS
// =============================================================================

describe("Type-checking E2E — Well-typed spells", () => {
  test("to_number(balance(X)) * price(X, Y) compiles with zero errors", () => {
    const result = compile(`
spell WellTyped {
  version: "1.0.0"
  assets: [ETH, USDC]
  on manual: {
    eth_balance = balance(ETH)
    eth_price = price(ETH, USDC)
    total_value = to_number(eth_balance) * eth_price
    emit result(value=total_value)
  }
}
`);
    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    assertIR(result);
  });

  test("to_bigint() conversion compiles cleanly", () => {
    const result = compile(`
spell ToBigintTest {
  version: "1.0.0"
  assets: [USDC]
  params: {
    amount: 100
  }
  on manual: {
    big_amount = to_bigint(params.amount)
    emit result(value=big_amount)
  }
}
`);
    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("comparison auto-promotion (bigint > number) still works", () => {
    const result = compile(`
spell AutoPromo {
  version: "1.0.0"
  assets: [USDC]
  params: {
    min_balance: 100
  }
  on manual: {
    bal = balance(USDC)
    if bal > params.min_balance {
      emit sufficient(balance=bal)
    }
  }
}
`);
    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("complex DeFi portfolio valuation with to_number()", () => {
    const result = compile(`
spell PortfolioValue {
  version: "1.0.0"
  assets: [ETH, USDC, WBTC]
  params: {
    min_value: 1000
  }
  on daily: {
    eth_bal = balance(ETH)
    usdc_bal = balance(USDC)
    btc_bal = balance(WBTC)

    eth_price = price(ETH, USDC)
    btc_price = price(WBTC, USDC)

    total = to_number(eth_bal) * eth_price + to_number(btc_bal) * btc_price + to_number(usdc_bal)

    if total > params.min_value {
      emit portfolio_ok(value=total)
    } else {
      emit portfolio_low(value=total, minimum=params.min_value)
    }
  }
}
`);
    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    assertIR(result);
  });

  test("min(to_number(balance(X)), params.y) pattern", () => {
    const result = compile(`
spell MinPattern {
  version: "1.0.0"
  assets: [USDC]
  params: {
    max_amount: 1000
  }
  on manual: {
    bal = balance(USDC)
    amount = min(to_number(bal), params.max_amount)
    emit result(amount=amount)
  }
}
`);
    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

// =============================================================================
// E2E: COMPILATION — TYPE ERRORS BLOCK COMPILATION
// =============================================================================

describe("Type-checking E2E — Type errors block compilation", () => {
  test("balance(X) * price(X, Y) without conversion => TYPE_MISMATCH, success: false", () => {
    const result = compile(`
spell IllTyped {
  version: "1.0.0"
  assets: [ETH, USDC]
  on manual: {
    eth_balance = balance(ETH)
    eth_price = price(ETH, USDC)
    total_value = eth_balance * eth_price
    emit result(value=total_value)
  }
}
`);
    expect(result.success).toBe(false);
    expect(result.ir).toBeUndefined();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.code === "TYPE_MISMATCH")).toBe(true);
    expect(result.errors.some((e) => e.message.includes("mismatched"))).toBe(true);
  });

  test("to_number(string) produces TYPE_MISMATCH error", () => {
    const result = compile(`
spell WrongArg {
  version: "1.0.0"
  on manual: {
    bad = to_number("hello")
    emit result(value=bad)
  }
}
`);
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.code === "TYPE_MISMATCH")).toBe(true);
    expect(result.errors.some((e) => e.message.includes("to_number"))).toBe(true);
  });

  test("to_bigint(bool) produces TYPE_MISMATCH error", () => {
    const result = compile(`
spell WrongArgBigint {
  version: "1.0.0"
  params: {
    flag: true
  }
  on manual: {
    bad = to_bigint(params.flag)
    emit result(value=bad)
  }
}
`);
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.code === "TYPE_MISMATCH")).toBe(true);
  });

  test("balance() + number without conversion => TYPE_MISMATCH", () => {
    const result = compile(`
spell AddMismatch {
  version: "1.0.0"
  assets: [USDC]
  params: {
    offset: 50
  }
  on manual: {
    bal = balance(USDC)
    bad = bal + params.offset
    emit result(value=bad)
  }
}
`);
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.code === "TYPE_MISMATCH")).toBe(true);
  });
});

// =============================================================================
// E2E: ALL FIXTURE .SPELL FILES COMPILE CLEANLY
// =============================================================================

describe("Type-checking E2E — Fixture files", () => {
  const spellFiles = readdirSync("spells").filter((f) => f.endsWith(".spell"));

  for (const file of spellFiles) {
    test(`${file} compiles with zero type errors`, async () => {
      const result = await compileFile(`spells/${file}`);
      const typeErrors = result.errors.filter(
        (e) => e.code === "TYPE_MISMATCH" || e.code === "WRONG_ARG_COUNT"
      );
      expect(typeErrors).toHaveLength(0);
      // Most files should succeed (some may have non-type validation issues)
      // But none should have type errors
    });
  }
});

// =============================================================================
// E2E: RUNTIME EVALUATION
// =============================================================================

describe("Type-checking E2E — Runtime evaluation", () => {
  const ctx: EvalContext = {
    params: new Map(),
    bindings: new Map(),
    state: { persistent: new Map(), ephemeral: new Map() },
  };

  test("to_number(100n) => 100", () => {
    const expr: Expression = {
      kind: "call",
      fn: "to_number",
      args: [{ kind: "literal", value: 100n, type: "int" }],
    };
    expect(evaluate(expr, ctx)).toBe(100);
  });

  test("to_bigint(42) => 42n", () => {
    const expr: Expression = {
      kind: "call",
      fn: "to_bigint",
      args: [{ kind: "literal", value: 42, type: "int" }],
    };
    expect(evaluate(expr, ctx)).toBe(42n);
  });

  test("to_number(number) => passthrough", () => {
    const expr: Expression = {
      kind: "call",
      fn: "to_number",
      args: [{ kind: "literal", value: 3.14, type: "float" }],
    };
    expect(evaluate(expr, ctx)).toBe(3.14);
  });

  test("to_bigint(bigint) => passthrough", () => {
    const expr: Expression = {
      kind: "call",
      fn: "to_bigint",
      args: [{ kind: "literal", value: 999n, type: "int" }],
    };
    expect(evaluate(expr, ctx)).toBe(999n);
  });

  test("to_bigint truncates fractional part", () => {
    const expr: Expression = {
      kind: "call",
      fn: "to_bigint",
      args: [{ kind: "literal", value: 7.9, type: "float" }],
    };
    expect(evaluate(expr, ctx)).toBe(7n);
  });

  test("to_number(bigint) then multiply by number works end-to-end", () => {
    const expr: Expression = {
      kind: "binary",
      op: "*",
      left: {
        kind: "call",
        fn: "to_number",
        args: [{ kind: "literal", value: 1000n, type: "int" }],
      },
      right: { kind: "literal", value: 2.5, type: "float" },
    };
    expect(evaluate(expr, ctx)).toBe(2500);
  });
});
