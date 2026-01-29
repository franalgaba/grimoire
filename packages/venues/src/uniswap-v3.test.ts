import { describe, expect, test } from "bun:test";
import type { Address, Expression, Provider, VenueAdapterContext } from "@grimoire/core";
import { createUniswapV3Adapter } from "./uniswap-v3.js";

const provider = {
  chainId: 1,
  getClient: () => ({
    readContract: async () => 0n,
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
      getClient: () => ({
        readContract: async () => 1000000n,
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
});
