import { describe, expect, test } from "bun:test";
import type { Address, Expression, Provider, VenueAdapterContext } from "@grimoire/core";
import { createUniswapV3Adapter } from "./uniswap-v3.js";

/** Mock pool state: sqrtPriceX96 = 2^96 (price = 1 in raw units), tick = 0 */
const MOCK_SLOT0 = [
  79228162514264337593543950336n, // sqrtPriceX96
  0n, // tick
  0n, // observationIndex
  0n, // observationCardinality
  0n, // observationCardinalityNext
  0n, // feeProtocol
  true, // unlocked
] as const;
const MOCK_LIQUIDITY = 1_000_000_000_000_000_000n;

const mockReadContract = async (params: { functionName: string }) => {
  if (params.functionName === "slot0") return MOCK_SLOT0;
  if (params.functionName === "liquidity") return MOCK_LIQUIDITY;
  return 0n;
};

const provider = {
  chainId: 1,
  readContract: mockReadContract,
  getClient: () => ({
    readContract: async () => 0n, // 0 allowance → needs approval
  }),
} as unknown as Provider;

const ctx: VenueAdapterContext = {
  provider,
  walletAddress: "0x0000000000000000000000000000000000000001" as Address,
  chainId: 1,
};

describe("Uniswap V3 adapter", () => {
  test("adds approval before swap when allowance is insufficient", async () => {
    const adapter = createUniswapV3Adapter();

    if (!adapter.buildAction) {
      throw new Error("Adapter does not support buildAction");
    }

    const amount: Expression = { kind: "literal", value: 10n, type: "int" };

    const result = await adapter.buildAction(
      {
        type: "swap",
        venue: "uniswap_v3",
        assetIn: "USDC",
        assetOut: "WETH",
        amount,
        mode: "exact_in",
      },
      ctx
    );

    const built = Array.isArray(result) ? result : [result];

    expect(built).toHaveLength(2);
    expect(built[0]?.description).toContain("Approve USDC");
    expect(built[1]?.description).toContain("Uniswap V3 swap");
  });

  test("skips approval when allowance is sufficient", async () => {
    const adapter = createUniswapV3Adapter();
    if (!adapter.buildAction) {
      throw new Error("Adapter does not support buildAction");
    }

    const richProvider = {
      chainId: 1,
      readContract: mockReadContract,
      getClient: () => ({
        readContract: async () => 1000000n, // high allowance
      }),
    } as unknown as Provider;

    const richCtx: VenueAdapterContext = {
      ...ctx,
      provider: richProvider,
    };

    const amount: Expression = { kind: "literal", value: 10n, type: "int" };

    const result = await adapter.buildAction(
      {
        type: "swap",
        venue: "uniswap_v3",
        assetIn: "USDC",
        assetOut: "WETH",
        amount,
        mode: "exact_in",
      },
      richCtx
    );

    const built = Array.isArray(result) ? result : [result];

    expect(built).toHaveLength(1);
    expect(built[0]?.description).toContain("Uniswap V3 swap");
  });

  test("rejects non-swap action types", async () => {
    const adapter = createUniswapV3Adapter();
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action = {
      type: "bridge",
      venue: "uniswap_v3",
      assetIn: "USDC",
      assetOut: "WETH",
      amount: 10n,
      mode: "exact_in",
    } as unknown as Parameters<NonNullable<typeof adapter.buildAction>>[0];

    await expect(adapter.buildAction(action, ctx)).rejects.toThrow(
      "Uniswap adapter only supports swap actions"
    );
  });

  test("rejects unconfigured chain", async () => {
    const adapter = createUniswapV3Adapter({ routers: {} });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const amount: Expression = { kind: "literal", value: 10n, type: "int" };

    await expect(
      adapter.buildAction(
        {
          type: "swap",
          venue: "uniswap_v3",
          assetIn: "USDC",
          assetOut: "WETH",
          amount,
          mode: "exact_in",
        },
        ctx
      )
    ).rejects.toThrow("No Uniswap router configured");
  });

  test("builds exact_out swap with amountInMaximum", async () => {
    const adapter = createUniswapV3Adapter();
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const result = await adapter.buildAction(
      {
        type: "swap",
        venue: "uniswap_v3",
        assetIn: "USDC",
        assetOut: "WETH",
        amount: 10n as unknown as Expression,
        mode: "exact_out",
      },
      ctx
    );

    const built = Array.isArray(result) ? result : [result];
    const swapTx = built[built.length - 1];

    expect(swapTx?.description).toContain("Uniswap V3 swap");
    expect(swapTx?.tx.data).toBeDefined();
  });

  test("resolves direct 0x address for token", async () => {
    const adapter = createUniswapV3Adapter();
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const result = await adapter.buildAction(
      {
        type: "swap",
        venue: "uniswap_v3",
        assetIn: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        assetOut: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        amount: 10n as unknown as Expression,
        mode: "exact_in",
      },
      ctx
    );

    const built = Array.isArray(result) ? result : [result];
    expect(built[built.length - 1]?.description).toContain("Uniswap V3 swap");
  });

  test("rejects unknown asset symbol", async () => {
    const adapter = createUniswapV3Adapter();
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    await expect(
      adapter.buildAction(
        {
          type: "swap",
          venue: "uniswap_v3",
          assetIn: "UNKNOWN",
          assetOut: "WETH",
          amount: 10n as unknown as Expression,
          mode: "exact_in",
        },
        ctx
      )
    ).rejects.toThrow("Unknown asset");
  });

  test("handles various amount types and rejects unsupported", async () => {
    const adapter = createUniswapV3Adapter();
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    // number amount
    const numResult = await adapter.buildAction(
      {
        type: "swap",
        venue: "uniswap_v3",
        assetIn: "USDC",
        assetOut: "WETH",
        amount: 10 as unknown as Expression,
        mode: "exact_in",
      },
      ctx
    );
    const numBuilt = Array.isArray(numResult) ? numResult : [numResult];
    expect(numBuilt[numBuilt.length - 1]?.description).toContain("Uniswap V3 swap");

    // string amount
    const strResult = await adapter.buildAction(
      {
        type: "swap",
        venue: "uniswap_v3",
        assetIn: "USDC",
        assetOut: "WETH",
        amount: "10" as unknown as Expression,
        mode: "exact_in",
      },
      ctx
    );
    const strBuilt = Array.isArray(strResult) ? strResult : [strResult];
    expect(strBuilt[strBuilt.length - 1]?.description).toContain("Uniswap V3 swap");

    // unsupported amount type
    await expect(
      adapter.buildAction(
        {
          type: "swap",
          venue: "uniswap_v3",
          assetIn: "USDC",
          assetOut: "WETH",
          amount: { foo: true } as unknown as Expression,
          mode: "exact_in",
        },
        ctx
      )
    ).rejects.toThrow("Unsupported amount type");
  });

  test("description includes expected output and slippage", async () => {
    const adapter = createUniswapV3Adapter();
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const result = await adapter.buildAction(
      {
        type: "swap",
        venue: "uniswap_v3",
        assetIn: "USDC",
        assetOut: "WETH",
        amount: 1000000n as unknown as Expression,
        mode: "exact_in",
      },
      ctx
    );

    const built = Array.isArray(result) ? result : [result];
    const swapTx = built[built.length - 1];
    expect(swapTx?.description).toContain("expected:");
    expect(swapTx?.description).toContain("min output:");
    expect(swapTx?.description).toContain("pool:");
  });

  test("wraps ETH and approves WETH for native ETH input", async () => {
    const adapter = createUniswapV3Adapter();
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const amount = 1000000000000000n; // 0.001 ETH

    const result = await adapter.buildAction(
      {
        type: "swap",
        venue: "uniswap_v3",
        assetIn: "ETH",
        assetOut: "USDC",
        amount: amount as unknown as Expression,
        mode: "exact_in",
      },
      ctx
    );

    const built = Array.isArray(result) ? result : [result];
    // Wrap ETH + approve WETH + swap = 3 transactions
    expect(built).toHaveLength(3);
    // First tx: wrap ETH → WETH (sends ETH value to WETH contract)
    expect(built[0]?.description).toContain("Wrap");
    expect(built[0]?.tx.value).toBe(amount);
    // Second tx: approve WETH
    expect(built[1]?.description).toContain("Approve WETH");
    // Third tx: the swap (value should be 0 since we use WETH now)
    expect(built[2]?.description).toContain("Uniswap V3 swap");
    expect(built[2]?.tx.value).toBe(0n);
  });
});
