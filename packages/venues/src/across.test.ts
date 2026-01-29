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
  test("builds approval + bridge transactions", async () => {
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
});
