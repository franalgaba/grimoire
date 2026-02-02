import { describe, expect, test } from "bun:test";
import type { Address, Expression, Provider, VenueAdapterContext } from "@grimoire/core";
import { createUniswapV4Adapter } from "./uniswap-v4.js";

/** Mock quoter: returns 3000 USDC (3000e6) for 1 ETH input, and 1 ETH for 3000 USDC output */
const MOCK_QUOTE_OUT = 3_000_000_000n; // 3000 USDC in 6-decimal
const MOCK_QUOTE_IN = 1_000_000_000_000_000_000n; // 1 ETH in 18-decimal
const MOCK_GAS = 150_000n;

const mockReadContract = async (params: { functionName: string }) => {
  if (params.functionName === "quoteExactInputSingle") {
    return [MOCK_QUOTE_OUT, MOCK_GAS] as const;
  }
  if (params.functionName === "quoteExactOutputSingle") {
    return [MOCK_QUOTE_IN, MOCK_GAS] as const;
  }
  return 0n;
};

const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

const provider = {
  chainId: 1,
  readContract: mockReadContract,
  getClient: () => ({
    readContract: async (params: { address: string }) => {
      // Permit2 allowance returns (uint160 amount, uint48 expiration, uint48 nonce)
      if (params.address.toLowerCase() === PERMIT2_ADDRESS.toLowerCase()) {
        return [0n, 0n, 0n] as const;
      }
      // ERC20 allowance returns uint256
      return 0n;
    },
  }),
} as unknown as Provider;

const ctx: VenueAdapterContext = {
  provider,
  walletAddress: "0x0000000000000000000000000000000000000001" as Address,
  chainId: 1,
};

describe("Uniswap V4 adapter", () => {
  test("builds single-tx swap for native ETH input (no wrapping)", async () => {
    const adapter = createUniswapV4Adapter();
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const result = await adapter.buildAction(
      {
        type: "swap",
        venue: "uniswap_v4",
        assetIn: "ETH",
        assetOut: "USDC",
        amount: 1_000_000_000_000_000n as unknown as Expression, // 0.001 ETH
        mode: "exact_in",
      },
      ctx
    );

    const built = Array.isArray(result) ? result : [result];

    // Native ETH → single tx (no approval, no wrapping)
    expect(built).toHaveLength(1);
    expect(built[0]?.description).toContain("Uniswap V4 swap");
    expect(built[0]?.tx.value).toBe(1_000_000_000_000_000n);
    expect(built[0]?.tx.data).toBeDefined();
  });

  test("adds Permit2 approvals for ERC20 input", async () => {
    const adapter = createUniswapV4Adapter();
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const amount: Expression = { kind: "literal", value: 1_000_000n, type: "int" };

    const result = await adapter.buildAction(
      {
        type: "swap",
        venue: "uniswap_v4",
        assetIn: "USDC",
        assetOut: "ETH",
        amount,
        mode: "exact_in",
      },
      ctx
    );

    const built = Array.isArray(result) ? result : [result];

    // ERC20 → Permit2 approval + Permit2→Router approval + swap = 3 txs
    expect(built).toHaveLength(3);
    expect(built[0]?.description).toContain("Approve USDC for Permit2");
    expect(built[1]?.description).toContain("Approve Universal Router on Permit2");
    expect(built[2]?.description).toContain("Uniswap V4 swap");
    // ERC20 input → no ETH value
    expect(built[2]?.tx.value).toBe(0n);
  });

  test("skips approvals when allowance is sufficient", async () => {
    const adapter = createUniswapV4Adapter();
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const richProvider = {
      chainId: 1,
      readContract: mockReadContract,
      getClient: () => ({
        readContract: async (params: { address: string; functionName: string }) => {
          if (params.functionName === "allowance") {
            // Permit2 allowance returns [amount, expiration, nonce]
            if (params.address === "0x000000000022D473030F116dDEE9F6B43aC78BA3") {
              const farFuture = BigInt(Math.floor(Date.now() / 1000) + 86400 * 365);
              return [1_000_000_000n, farFuture, 0n] as const;
            }
            // ERC20 allowance
            return 1_000_000_000n;
          }
          return 0n;
        },
      }),
    } as unknown as Provider;

    const richCtx: VenueAdapterContext = { ...ctx, provider: richProvider };
    const amount: Expression = { kind: "literal", value: 1_000_000n, type: "int" };

    const result = await adapter.buildAction(
      {
        type: "swap",
        venue: "uniswap_v4",
        assetIn: "USDC",
        assetOut: "ETH",
        amount,
        mode: "exact_in",
      },
      richCtx
    );

    const built = Array.isArray(result) ? result : [result];
    // Sufficient allowance → only the swap tx
    expect(built).toHaveLength(1);
    expect(built[0]?.description).toContain("Uniswap V4 swap");
  });

  test("rejects non-swap action types", async () => {
    const adapter = createUniswapV4Adapter();
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action = {
      type: "bridge",
      venue: "uniswap_v4",
      assetIn: "USDC",
      assetOut: "WETH",
      amount: 10n,
      mode: "exact_in",
    } as unknown as Parameters<NonNullable<typeof adapter.buildAction>>[0];

    await expect(adapter.buildAction(action, ctx)).rejects.toThrow(
      "Uniswap V4 adapter only supports swap actions"
    );
  });

  test("rejects unconfigured chain", async () => {
    const adapter = createUniswapV4Adapter({ routers: {} });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const amount: Expression = { kind: "literal", value: 10n, type: "int" };

    await expect(
      adapter.buildAction(
        {
          type: "swap",
          venue: "uniswap_v4",
          assetIn: "USDC",
          assetOut: "ETH",
          amount,
          mode: "exact_in",
        },
        ctx
      )
    ).rejects.toThrow("No Universal Router configured");
  });

  test("builds exact_out swap with SWEEP for native ETH", async () => {
    const adapter = createUniswapV4Adapter();
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const result = await adapter.buildAction(
      {
        type: "swap",
        venue: "uniswap_v4",
        assetIn: "ETH",
        assetOut: "USDC",
        amount: 3_000_000_000n as unknown as Expression, // exact USDC out
        mode: "exact_out",
      },
      ctx
    );

    const built = Array.isArray(result) ? result : [result];
    // exact_out ETH → single tx (value = settleAmount with slippage)
    expect(built).toHaveLength(1);
    expect(built[0]?.description).toContain("Uniswap V4 swap");
    // Value should be > 0 (ETH to send)
    expect(built[0]?.tx.value).toBeGreaterThan(0n);
  });

  test("resolves direct 0x address for token", async () => {
    const adapter = createUniswapV4Adapter();
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const result = await adapter.buildAction(
      {
        type: "swap",
        venue: "uniswap_v4",
        assetIn: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        assetOut: "ETH",
        amount: 1_000_000n as unknown as Expression,
        mode: "exact_in",
      },
      ctx
    );

    const built = Array.isArray(result) ? result : [result];
    expect(built[built.length - 1]?.description).toContain("Uniswap V4 swap");
  });

  test("rejects unknown asset symbol", async () => {
    const adapter = createUniswapV4Adapter();
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    await expect(
      adapter.buildAction(
        {
          type: "swap",
          venue: "uniswap_v4",
          assetIn: "UNKNOWN",
          assetOut: "ETH",
          amount: 10n as unknown as Expression,
          mode: "exact_in",
        },
        ctx
      )
    ).rejects.toThrow("Unknown asset");
  });

  test("handles various amount types and rejects unsupported", async () => {
    const adapter = createUniswapV4Adapter();
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    // bigint amount
    const bigintResult = await adapter.buildAction(
      {
        type: "swap",
        venue: "uniswap_v4",
        assetIn: "ETH",
        assetOut: "USDC",
        amount: 10n as unknown as Expression,
        mode: "exact_in",
      },
      ctx
    );
    expect(Array.isArray(bigintResult) ? bigintResult : [bigintResult]).toHaveLength(1);

    // number amount
    const numResult = await adapter.buildAction(
      {
        type: "swap",
        venue: "uniswap_v4",
        assetIn: "ETH",
        assetOut: "USDC",
        amount: 10 as unknown as Expression,
        mode: "exact_in",
      },
      ctx
    );
    expect((Array.isArray(numResult) ? numResult : [numResult])[0]?.description).toContain(
      "Uniswap V4 swap"
    );

    // string amount
    const strResult = await adapter.buildAction(
      {
        type: "swap",
        venue: "uniswap_v4",
        assetIn: "ETH",
        assetOut: "USDC",
        amount: "10" as unknown as Expression,
        mode: "exact_in",
      },
      ctx
    );
    expect((Array.isArray(strResult) ? strResult : [strResult])[0]?.description).toContain(
      "Uniswap V4 swap"
    );

    // unsupported amount type
    await expect(
      adapter.buildAction(
        {
          type: "swap",
          venue: "uniswap_v4",
          assetIn: "ETH",
          assetOut: "USDC",
          amount: { foo: true } as unknown as Expression,
          mode: "exact_in",
        },
        ctx
      )
    ).rejects.toThrow("Unsupported amount type");
  });

  test("description includes expected output and slippage", async () => {
    const adapter = createUniswapV4Adapter();
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const result = await adapter.buildAction(
      {
        type: "swap",
        venue: "uniswap_v4",
        assetIn: "ETH",
        assetOut: "USDC",
        amount: 1_000_000_000_000_000_000n as unknown as Expression, // 1 ETH
        mode: "exact_in",
      },
      ctx
    );

    const built = Array.isArray(result) ? result : [result];
    const swapTx = built[built.length - 1];
    expect(swapTx?.description).toContain("expected:");
    expect(swapTx?.description).toContain("min output:");
    expect(swapTx?.description).toContain("fee tier:");
    expect(swapTx?.description).toContain("tickSpacing:");
  });

  test("native ETH is always currency0 (sorted lower)", async () => {
    const adapter = createUniswapV4Adapter();
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    // ETH → USDC: ETH (0x000...) is currency0
    const result = await adapter.buildAction(
      {
        type: "swap",
        venue: "uniswap_v4",
        assetIn: "ETH",
        assetOut: "USDC",
        amount: 1000n as unknown as Expression,
        mode: "exact_in",
      },
      ctx
    );

    const built = Array.isArray(result) ? result : [result];
    // Description should show currencyIn as ETH with 0x0000... address
    expect(built[0]?.description).toContain("0x0000...0000");
  });
});
