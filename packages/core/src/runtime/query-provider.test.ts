/**
 * QueryProvider plumbing tests
 *
 * Verifies that:
 * 1. createEvalContext copies query functions from ExecutionContext.queryProvider
 * 2. price(ETH, USDC) works end-to-end through preview() with a mock QueryProvider
 * 3. price(ETH, USDC, "chainlink") passes the source parameter
 * 4. Missing provider → clear error
 */

import { describe, expect, test } from "bun:test";
import { compile } from "../compiler/index.js";
import type { SpellIR } from "../types/ir.js";
import type { Address } from "../types/primitives.js";
import type { MetricRequest, QueryProvider } from "../types/query-provider.js";
import { createContext } from "./context.js";
import { createEvalContext, evaluateAsync } from "./expression-evaluator.js";
import { preview } from "./interpreter.js";

const VAULT: Address = "0x0000000000000000000000000000000000000000";

function assertIR(
  result: ReturnType<typeof compile>
): asserts result is { success: true; ir: SpellIR; errors: never[]; warnings: never[] } {
  if (!result.success || !result.ir) {
    throw new Error(
      `Expected successful compilation: ${result.errors.map((e) => e.message).join(", ")}`
    );
  }
}

// =============================================================================
// MOCK QUERY PROVIDER
// =============================================================================

function createMockQueryProvider(overrides?: Partial<QueryProvider>): QueryProvider {
  return {
    meta: {
      name: "mock",
      supportedQueries: ["balance", "price", "metric"],
      supportedMetrics: ["apy"],
    },
    async queryBalance(asset: string, _address?: string): Promise<bigint> {
      if (asset === "ETH") return 1000000000000000000n; // 1 ETH
      if (asset === "USDC") return 1000000000n; // 1000 USDC (6 decimals)
      return 0n;
    },
    async queryPrice(base: string, quote: string, _source?: string): Promise<number> {
      if (base === "ETH" && (quote === "USDC" || quote === "USD")) return 3000;
      if (base === "USDC" && quote === "ETH") return 1 / 3000;
      return 1;
    },
    async queryMetric(request: MetricRequest): Promise<number> {
      if (request.surface === "apy" && request.venue === "aave_v3" && request.asset === "USDC") {
        return 420;
      }
      return 0;
    },
    ...overrides,
  };
}

// =============================================================================
// UNIT: createEvalContext copies query functions
// =============================================================================

describe("createEvalContext + queryProvider", () => {
  test("copies all query functions from queryProvider", () => {
    const mockQp = createMockQueryProvider();
    const baseIR: SpellIR = {
      id: "test",
      version: "1.0.0",
      meta: { name: "test", created: Date.now(), hash: "h" },
      aliases: [],
      assets: [],
      skills: [],
      advisors: [],
      params: [],
      state: { persistent: {}, ephemeral: {} },
      steps: [],
      guards: [],
      triggers: [{ type: "manual" }],
    };

    const ctx = createContext({
      spell: baseIR,
      vault: VAULT,
      chain: 1,
      queryProvider: mockQp,
    });

    const evalCtx = createEvalContext(ctx);
    expect(evalCtx.queryBalance).toBeDefined();
    expect(evalCtx.queryPrice).toBeDefined();
    expect(evalCtx.queryMetric).toBeDefined();
    expect(typeof evalCtx.queryBalance).toBe("function");
    expect(typeof evalCtx.queryPrice).toBe("function");
    expect(typeof evalCtx.queryMetric).toBe("function");
  });

  test("query functions are undefined when no queryProvider", () => {
    const baseIR: SpellIR = {
      id: "test",
      version: "1.0.0",
      meta: { name: "test", created: Date.now(), hash: "h" },
      aliases: [],
      assets: [],
      skills: [],
      advisors: [],
      params: [],
      state: { persistent: {}, ephemeral: {} },
      steps: [],
      guards: [],
      triggers: [{ type: "manual" }],
    };

    const ctx = createContext({
      spell: baseIR,
      vault: VAULT,
      chain: 1,
    });

    const evalCtx = createEvalContext(ctx);
    expect(evalCtx.queryBalance).toBeUndefined();
    expect(evalCtx.queryPrice).toBeUndefined();
    expect(evalCtx.queryMetric).toBeUndefined();
  });

  test("queryPrice returns expected value through EvalContext", async () => {
    const mockQp = createMockQueryProvider();
    const baseIR: SpellIR = {
      id: "test",
      version: "1.0.0",
      meta: { name: "test", created: Date.now(), hash: "h" },
      aliases: [],
      assets: [
        {
          symbol: "ETH",
          chain: 1,
          address: "0x0000000000000000000000000000000000000003",
          decimals: 18,
        },
        {
          symbol: "USDC",
          chain: 1,
          address: "0x0000000000000000000000000000000000000002",
          decimals: 6,
        },
      ],
      skills: [],
      advisors: [],
      params: [],
      state: { persistent: {}, ephemeral: {} },
      steps: [],
      guards: [],
      triggers: [{ type: "manual" }],
    };

    const ctx = createContext({
      spell: baseIR,
      vault: VAULT,
      chain: 1,
      queryProvider: mockQp,
    });

    const evalCtx = createEvalContext(ctx);

    // price(ETH, USDC)
    const priceExpr = {
      kind: "call" as const,
      fn: "price" as const,
      args: [
        { kind: "literal" as const, value: "ETH", type: "string" as const },
        { kind: "literal" as const, value: "USDC", type: "string" as const },
      ],
    };

    const result = await evaluateAsync(priceExpr, evalCtx);
    expect(result).toBe(3000);
  });

  test("price() with source parameter passes it through", async () => {
    let receivedSource: string | undefined;
    const mockQp = createMockQueryProvider({
      async queryPrice(_base: string, _quote: string, source?: string): Promise<number> {
        receivedSource = source;
        return 3000;
      },
    });

    const baseIR: SpellIR = {
      id: "test",
      version: "1.0.0",
      meta: { name: "test", created: Date.now(), hash: "h" },
      aliases: [],
      assets: [],
      skills: [],
      advisors: [],
      params: [],
      state: { persistent: {}, ephemeral: {} },
      steps: [],
      guards: [],
      triggers: [{ type: "manual" }],
    };

    const ctx = createContext({
      spell: baseIR,
      vault: VAULT,
      chain: 1,
      queryProvider: mockQp,
    });

    const evalCtx = createEvalContext(ctx);

    // price(ETH, USDC, "chainlink")
    const priceExpr = {
      kind: "call" as const,
      fn: "price" as const,
      args: [
        { kind: "literal" as const, value: "ETH", type: "string" as const },
        { kind: "literal" as const, value: "USDC", type: "string" as const },
        { kind: "literal" as const, value: "chainlink", type: "string" as const },
      ],
    };

    await evaluateAsync(priceExpr, evalCtx);
    expect(receivedSource).toBe("chainlink");
  });

  test("price() without queryProvider throws clear error", async () => {
    const baseIR: SpellIR = {
      id: "test",
      version: "1.0.0",
      meta: { name: "test", created: Date.now(), hash: "h" },
      aliases: [],
      assets: [],
      skills: [],
      advisors: [],
      params: [],
      state: { persistent: {}, ephemeral: {} },
      steps: [],
      guards: [],
      triggers: [{ type: "manual" }],
    };

    const ctx = createContext({
      spell: baseIR,
      vault: VAULT,
      chain: 1,
    });

    const evalCtx = createEvalContext(ctx);

    const priceExpr = {
      kind: "call" as const,
      fn: "price" as const,
      args: [
        { kind: "literal" as const, value: "ETH", type: "string" as const },
        { kind: "literal" as const, value: "USDC", type: "string" as const },
      ],
    };

    await expect(evaluateAsync(priceExpr, evalCtx)).rejects.toThrow(
      "Price queries not available in this context"
    );
  });
});

// =============================================================================
// E2E: preview() with mock QueryProvider
// =============================================================================

describe("preview() with QueryProvider", () => {
  test("price() works end-to-end via preview()", async () => {
    const source = `spell PriceTest {
  version: "1.0.0"

  assets: {
    ETH: {
      chain: 1
      address: 0x0000000000000000000000000000000000000003
      decimals: 18
    }
    USDC: {
      chain: 1
      address: 0x0000000000000000000000000000000000000002
      decimals: 6
    }
  }

  on manual: {
    eth_price = price(ETH, USDC)
  }
}`;
    const compileResult = compile(source);
    assertIR(compileResult);

    const mockQp = createMockQueryProvider();
    const result = await preview({
      spell: compileResult.ir,
      vault: VAULT,
      chain: 1,
      queryProvider: mockQp,
    });

    expect(result.success).toBe(true);
    expect(result.receipt).toBeDefined();
  });

  test("balance() works end-to-end via preview()", async () => {
    const source = `spell BalanceTest {
  version: "1.0.0"

  assets: {
    ETH: {
      chain: 1
      address: 0x0000000000000000000000000000000000000003
      decimals: 18
    }
  }

  on manual: {
    bal = balance(ETH)
  }
}`;
    const compileResult = compile(source);
    assertIR(compileResult);

    const mockQp = createMockQueryProvider();
    const result = await preview({
      spell: compileResult.ir,
      vault: VAULT,
      chain: 1,
      queryProvider: mockQp,
    });

    expect(result.success).toBe(true);
  });

  test("apy() works end-to-end via preview()", async () => {
    const source = `spell ApyTest {
  version: "1.0.0"

  assets: [USDC]

  venues: {
    aave: @aave_v3
  }

  on manual: {
    a = apy(aave, USDC)
  }
}`;
    const compileResult = compile(source);
    assertIR(compileResult);

    const mockQp = createMockQueryProvider();
    const result = await preview({
      spell: compileResult.ir,
      vault: VAULT,
      chain: 1,
      queryProvider: mockQp,
    });

    expect(result.success).toBe(true);
  });
});
