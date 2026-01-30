import { describe, expect, test } from "bun:test";
import type { Quote } from "@across-protocol/app-sdk";
import type { Action, Address, Expression, Provider, VenueAdapterContext } from "@grimoire/core";
import { createAcrossAdapter } from "./across.js";

const ctx: VenueAdapterContext = {
  provider: {
    chainId: 1,
    getClient: () => ({
      simulateContract: async () => ({
        request: {
          to: "0x000000000000000000000000000000000000000a",
          data: "0x1234",
          value: 0n,
        },
      }),
      readContract: async () => 0n,
    }),
  } as unknown as Provider,
  walletAddress: "0x0000000000000000000000000000000000000001" as Address,
  chainId: 1,
};

const quote: Quote = {
  deposit: {
    inputAmount: 5n,
    outputAmount: 5n,
    recipient: "0x0000000000000000000000000000000000000001" as Address,
    message: "0x",
    quoteTimestamp: 1,
    fillDeadline: 2,
    exclusiveRelayer: "0x0000000000000000000000000000000000000000" as Address,
    exclusivityDeadline: 0,
    spokePoolAddress: "0x000000000000000000000000000000000000000b" as Address,
    destinationSpokePoolAddress: "0x000000000000000000000000000000000000000c" as Address,
    originChainId: 1,
    destinationChainId: 10,
    inputToken: "0x000000000000000000000000000000000000000d" as Address,
    outputToken: "0x000000000000000000000000000000000000000e" as Address,
    isNative: false,
  },
  limits: {
    minDeposit: 0n,
    maxDeposit: 100n,
    maxDepositInstant: 100n,
  },
  fees: {
    lpFee: { pct: 0n, total: 0n },
    relayerGasFee: { pct: 0n, total: 0n },
    relayerCapitalFee: { pct: 0n, total: 0n },
    totalRelayFee: { pct: 0n, total: 0n },
  },
  isAmountTooLow: false,
  estimatedFillTimeSec: 0,
};

describe("Across adapter", () => {
  const adapter = createAcrossAdapter({
    integratorId: "0x0000",
    assets: {
      USDC: {
        1: "0x000000000000000000000000000000000000000d" as Address,
        10: "0x000000000000000000000000000000000000000e" as Address,
      },
    },
    getQuote: async () => quote,
  });

  test("builds approval + bridge transactions", async () => {
    if (!adapter.buildAction) {
      throw new Error("Missing buildAction");
    }

    const action: Action = {
      type: "bridge",
      venue: "across",
      asset: "USDC",
      amount: 5n as unknown as Expression,
      toChain: 10,
    } as Action;

    const result = await adapter.buildAction(action, ctx);
    const built = Array.isArray(result) ? result : [result];

    expect(built).toHaveLength(2);
    expect(built[0]?.description).toContain("Approve USDC");
    expect(built[1]?.description).toContain("Across bridge");
  });

  test("rejects non-bridge action types", async () => {
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action = {
      type: "swap",
      venue: "across",
      asset: "USDC",
      amount: 5n,
      toChain: 10,
    } as unknown as Action;

    await expect(adapter.buildAction(action, ctx)).rejects.toThrow(
      "Across adapter only supports bridge actions"
    );
  });

  test("rejects non-numeric toChain", async () => {
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action = {
      type: "bridge",
      venue: "across",
      asset: "USDC",
      amount: 5n,
      toChain: "optimism",
    } as unknown as Action;

    await expect(adapter.buildAction(action, ctx)).rejects.toThrow(
      "Across adapter requires numeric toChain"
    );
  });

  test("rejects missing simulateContract provider", async () => {
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const noSimCtx: VenueAdapterContext = {
      provider: {
        chainId: 1,
        getClient: () => ({}),
      } as unknown as Provider,
      walletAddress: "0x0000000000000000000000000000000000000001" as Address,
      chainId: 1,
    };

    const action = {
      type: "bridge",
      venue: "across",
      asset: "USDC",
      amount: 5n,
      toChain: 10,
    } as unknown as Action;

    await expect(adapter.buildAction(action, noSimCtx)).rejects.toThrow(
      "requires a provider with simulateContract"
    );
  });

  test("resolves direct 0x address for asset", async () => {
    const adapterWith0x = createAcrossAdapter({
      integratorId: "0x0000",
      assets: {},
      getQuote: async () => quote,
    });

    if (!adapterWith0x.buildAction) throw new Error("Missing buildAction");

    const action = {
      type: "bridge",
      venue: "across",
      asset: "0x000000000000000000000000000000000000000d",
      amount: 5n,
      toChain: 10,
    } as unknown as Action;

    const result = await adapterWith0x.buildAction(action, ctx);
    const built = Array.isArray(result) ? result : [result];
    expect(built.length).toBeGreaterThanOrEqual(1);
    expect(built[built.length - 1]?.description).toContain("Across bridge");
  });

  test("rejects unknown asset with no mapping", async () => {
    const emptyAdapter = createAcrossAdapter({
      integratorId: "0x0000",
      assets: {},
      getQuote: async () => quote,
    });

    if (!emptyAdapter.buildAction) throw new Error("Missing buildAction");

    const action = {
      type: "bridge",
      venue: "across",
      asset: "UNKNOWN",
      amount: 5n,
      toChain: 10,
    } as unknown as Action;

    await expect(emptyAdapter.buildAction(action, ctx)).rejects.toThrow("No Across asset mapping");
  });

  test("handles number, string, and literal amounts", async () => {
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const numberAction = {
      type: "bridge",
      venue: "across",
      asset: "USDC",
      amount: 5,
      toChain: 10,
    } as unknown as Action;

    const numberResult = await adapter.buildAction(numberAction, ctx);
    const numberBuilt = Array.isArray(numberResult) ? numberResult : [numberResult];
    expect(numberBuilt[numberBuilt.length - 1]?.description).toContain("Across bridge");

    const stringAction = {
      type: "bridge",
      venue: "across",
      asset: "USDC",
      amount: "5",
      toChain: 10,
    } as unknown as Action;

    const stringResult = await adapter.buildAction(stringAction, ctx);
    const stringBuilt = Array.isArray(stringResult) ? stringResult : [stringResult];
    expect(stringBuilt[stringBuilt.length - 1]?.description).toContain("Across bridge");

    const literalAction = {
      type: "bridge",
      venue: "across",
      asset: "USDC",
      amount: { kind: "literal", value: 5n },
      toChain: 10,
    } as unknown as Action;

    const literalResult = await adapter.buildAction(literalAction, ctx);
    const literalBuilt = Array.isArray(literalResult) ? literalResult : [literalResult];
    expect(literalBuilt[literalBuilt.length - 1]?.description).toContain("Across bridge");
  });

  test("rejects unsupported amount type", async () => {
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action = {
      type: "bridge",
      venue: "across",
      asset: "USDC",
      amount: { foo: true },
      toChain: 10,
    } as unknown as Action;

    await expect(adapter.buildAction(action, ctx)).rejects.toThrow(
      "Across adapter requires a numeric amount"
    );
  });

  test("skips approval for native token bridges", async () => {
    const nativeQuote: Quote = {
      ...quote,
      deposit: { ...quote.deposit, isNative: true },
    };

    const nativeAdapter = createAcrossAdapter({
      integratorId: "0x0000",
      assets: {
        ETH: {
          1: "0x000000000000000000000000000000000000000d" as Address,
          10: "0x000000000000000000000000000000000000000e" as Address,
        },
      },
      getQuote: async () => nativeQuote,
    });

    if (!nativeAdapter.buildAction) throw new Error("Missing buildAction");

    const action = {
      type: "bridge",
      venue: "across",
      asset: "ETH",
      amount: 5n,
      toChain: 10,
    } as unknown as Action;

    const result = await nativeAdapter.buildAction(action, ctx);
    const built = Array.isArray(result) ? result : [result];

    expect(built).toHaveLength(1);
    expect(built[0]?.description).toContain("Across bridge");
  });
});
