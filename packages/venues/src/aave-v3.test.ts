import { describe, expect, test } from "bun:test";
import type { AaveClient } from "@aave/client";
import type { Action, Address, Expression, Provider, VenueAdapterContext } from "@grimoire/core";
import { type AaveV3AdapterConfig, createAaveV3Adapter } from "./aave-v3.js";

const market = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2" as Address;

const ctx: VenueAdapterContext = {
  provider: { chainId: 1 } as unknown as Provider,
  walletAddress: "0x0000000000000000000000000000000000000001" as Address,
  chainId: 1,
};

const amount1: Expression = { kind: "literal", value: 1n, type: "int" };
const amount2: Expression = { kind: "literal", value: 2n, type: "int" };
const amount5: Expression = { kind: "literal", value: 5n, type: "int" };
const lendAction: Action = {
  type: "lend",
  venue: "aave_v3",
  asset: "USDC",
  amount: amount1,
};

describe("Aave V3 adapter", () => {
  test("builds approval + action transactions when required", async () => {
    const adapter = createAaveV3Adapter({
      markets: { 1: market },
      client: {} as AaveClient,
      actions: {
        supply: async () => ({
          __typename: "ApprovalRequired",
          approval: {
            __typename: "TransactionRequest",
            to: "0x0000000000000000000000000000000000000002",
            data: "0x01",
            value: "0",
          },
          originalTransaction: {
            __typename: "TransactionRequest",
            to: "0x0000000000000000000000000000000000000003",
            data: "0x02",
            value: "0",
          },
        }),
        withdraw: async () => ({
          __typename: "TransactionRequest",
          to: "0x",
          data: "0x",
          value: "0",
        }),
        borrow: async () => ({
          __typename: "TransactionRequest",
          to: "0x",
          data: "0x",
          value: "0",
        }),
        repay: async () => ({
          __typename: "TransactionRequest",
          to: "0x",
          data: "0x",
          value: "0",
        }),
      } as unknown as AaveV3AdapterConfig["actions"],
    });

    if (!adapter.buildAction) {
      throw new Error("Missing buildAction");
    }

    const result = await adapter.buildAction(lendAction, ctx);

    const built = Array.isArray(result) ? result : [result];

    expect(built).toHaveLength(2);
    expect(built[0]?.description).toContain("approve");
    expect(built[1]?.description).toContain("Aave V3 lend");
  });

  test("builds single transaction when approval is not required", async () => {
    const adapter = createAaveV3Adapter({
      markets: { 1: market },
      client: {} as AaveClient,
      actions: {
        supply: async () => ({
          __typename: "TransactionRequest",
          to: "0x0000000000000000000000000000000000000004",
          data: "0x03",
          value: "0",
        }),
        withdraw: async () => ({
          __typename: "TransactionRequest",
          to: "0x",
          data: "0x",
          value: "0",
        }),
        borrow: async () => ({
          __typename: "TransactionRequest",
          to: "0x",
          data: "0x",
          value: "0",
        }),
        repay: async () => ({
          __typename: "TransactionRequest",
          to: "0x",
          data: "0x",
          value: "0",
        }),
      } as unknown as AaveV3AdapterConfig["actions"],
    });

    if (!adapter.buildAction) {
      throw new Error("Missing buildAction");
    }

    const result = await adapter.buildAction(lendAction, ctx);

    const built = Array.isArray(result) ? result : [result];

    expect(built).toHaveLength(1);
    expect(built[0]?.description).toContain("Aave V3 lend");
  });

  test("builds withdraw, borrow, and repay transactions", async () => {
    const adapter = createAaveV3Adapter({
      markets: { 1: market },
      client: {} as AaveClient,
      actions: {
        supply: async () => ({
          __typename: "TransactionRequest",
          to: "0x",
          data: "0x",
          value: "0",
        }),
        withdraw: async () => ({
          __typename: "TransactionRequest",
          to: "0x0000000000000000000000000000000000000005",
          data: "0x04",
          value: "0",
        }),
        borrow: async () => ({
          __typename: "TransactionRequest",
          to: "0x0000000000000000000000000000000000000006",
          data: "0x05",
          value: "0",
        }),
        repay: async () => ({
          __typename: "TransactionRequest",
          to: "0x0000000000000000000000000000000000000007",
          data: "0x06",
          value: "0",
        }),
      } as unknown as AaveV3AdapterConfig["actions"],
    });

    if (!adapter.buildAction) {
      throw new Error("Missing buildAction");
    }

    const withdrawAction: Action = {
      type: "withdraw",
      venue: "aave_v3",
      asset: "USDC",
      amount: amount5,
    };
    const borrowAction: Action = {
      type: "borrow",
      venue: "aave_v3",
      asset: "USDC",
      amount: amount2,
    };
    const repayAction: Action = {
      type: "repay",
      venue: "aave_v3",
      asset: "USDC",
      amount: amount2,
    };

    const withdrawTxs = await adapter.buildAction(withdrawAction, ctx);
    const borrowTxs = await adapter.buildAction(borrowAction, ctx);
    const repayTxs = await adapter.buildAction(repayAction, ctx);

    const withdraw = Array.isArray(withdrawTxs) ? withdrawTxs[0] : withdrawTxs;
    const borrow = Array.isArray(borrowTxs) ? borrowTxs[0] : borrowTxs;
    const repay = Array.isArray(repayTxs) ? repayTxs[0] : repayTxs;

    expect(withdraw.description).toContain("Aave V3 withdraw");
    expect(borrow.description).toContain("Aave V3 borrow");
    expect(repay.description).toContain("Aave V3 repay");
  });

  test("uses default markets and parses string amounts", async () => {
    const adapter = createAaveV3Adapter();
    expect(adapter.meta.supportedChains).toContain(1);

    const wrappedAdapter = createAaveV3Adapter({
      markets: { 1: market },
      client: {} as AaveClient,
      actions: {
        supply: async () => ({
          value: {
            __typename: "TransactionRequest",
            to: "0x0000000000000000000000000000000000000008",
            data: "0x07",
            value: "1",
          },
        }),
        withdraw: async () => ({
          __typename: "TransactionRequest",
          to: "0x",
          data: "0x",
          value: "0",
        }),
        borrow: async () => ({
          __typename: "TransactionRequest",
          to: "0x",
          data: "0x",
          value: "0",
        }),
        repay: async () => ({
          __typename: "TransactionRequest",
          to: "0x",
          data: "0x",
          value: "0",
        }),
      } as unknown as AaveV3AdapterConfig["actions"],
    });

    if (!wrappedAdapter.buildAction) {
      throw new Error("Missing buildAction");
    }

    const stringAmountAction = {
      type: "lend",
      venue: "aave_v3",
      asset: "0x0000000000000000000000000000000000000009",
      amount: "10",
    } as unknown as Action;

    const result = await wrappedAdapter.buildAction(stringAmountAction, ctx);

    const built = Array.isArray(result) ? result : [result];
    expect(built[0]?.description).toContain("Aave V3 lend");
  });

  test("rejects unsupported amount type and missing asset", async () => {
    const adapter = createAaveV3Adapter({
      markets: { 1: market },
      client: {} as AaveClient,
      actions: {
        supply: async () => ({
          __typename: "TransactionRequest",
          to: "0x",
          data: "0x",
          value: "0",
        }),
        withdraw: async () => ({
          __typename: "TransactionRequest",
          to: "0x",
          data: "0x",
          value: "0",
        }),
        borrow: async () => ({
          __typename: "TransactionRequest",
          to: "0x",
          data: "0x",
          value: "0",
        }),
        repay: async () => ({
          __typename: "TransactionRequest",
          to: "0x",
          data: "0x",
          value: "0",
        }),
      } as unknown as AaveV3AdapterConfig["actions"],
    });

    if (!adapter.buildAction) {
      throw new Error("Missing buildAction");
    }

    const invalidAmountAction = {
      type: "lend",
      venue: "aave_v3",
      asset: "USDC",
      amount: { foo: true },
    } as unknown as Action;

    await expect(adapter.buildAction(invalidAmountAction, ctx)).rejects.toThrow(
      "Unsupported amount type"
    );

    const missingAssetAction = {
      type: "lend",
      venue: "aave_v3",
      asset: undefined,
      amount: amount1,
    } as unknown as Action;

    await expect(adapter.buildAction(missingAssetAction, ctx)).rejects.toThrow("Asset is required");
  });

  test("rejects max amount and unknown assets", async () => {
    const adapter = createAaveV3Adapter({
      markets: { 1: market },
      client: {} as AaveClient,
      actions: {
        supply: async () => ({
          __typename: "TransactionRequest",
          to: "0x",
          data: "0x",
          value: "0",
        }),
        withdraw: async () => ({
          __typename: "TransactionRequest",
          to: "0x",
          data: "0x",
          value: "0",
        }),
        borrow: async () => ({
          __typename: "TransactionRequest",
          to: "0x",
          data: "0x",
          value: "0",
        }),
        repay: async () => ({
          __typename: "TransactionRequest",
          to: "0x",
          data: "0x",
          value: "0",
        }),
      } as unknown as AaveV3AdapterConfig["actions"],
    });

    if (!adapter.buildAction) {
      throw new Error("Missing buildAction");
    }

    const maxAmountAction = {
      type: "lend",
      venue: "aave_v3",
      asset: "USDC",
      amount: "max",
    } as unknown as Action;

    await expect(adapter.buildAction(maxAmountAction, ctx)).rejects.toThrow("explicit amount");

    const unknownAssetAction = {
      type: "lend",
      venue: "aave_v3",
      asset: "UNKNOWN",
      amount: amount1,
    } as unknown as Action;

    await expect(adapter.buildAction(unknownAssetAction, ctx)).rejects.toThrow("Unknown asset");
  });

  test("rejects unconfigured chain", async () => {
    const adapter = createAaveV3Adapter({
      markets: {},
      client: {} as AaveClient,
      actions: {
        supply: async () => ({}),
        withdraw: async () => ({}),
        borrow: async () => ({}),
        repay: async () => ({}),
      } as unknown as AaveV3AdapterConfig["actions"],
    });

    if (!adapter.buildAction) throw new Error("Missing buildAction");

    await expect(adapter.buildAction(lendAction, ctx)).rejects.toThrow(
      "No Aave V3 market configured"
    );
  });

  test("rejects unsupported action type", async () => {
    const adapter = createAaveV3Adapter({
      markets: { 1: market },
      client: {} as AaveClient,
      actions: {
        supply: async () => ({}),
        withdraw: async () => ({}),
        borrow: async () => ({}),
        repay: async () => ({}),
      } as unknown as AaveV3AdapterConfig["actions"],
    });

    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const swapAction = {
      type: "swap",
      venue: "aave_v3",
      asset: "USDC",
      amount: amount1,
    } as unknown as Action;

    await expect(adapter.buildAction(swapAction, ctx)).rejects.toThrow("Unsupported Aave action");
  });

  test("throws on isErr plan result", async () => {
    const adapter = createAaveV3Adapter({
      markets: { 1: market },
      client: {} as AaveClient,
      actions: {
        supply: async () => ({
          isErr: () => true,
          error: { message: "Insufficient collateral" },
        }),
        withdraw: async () => ({}),
        borrow: async () => ({}),
        repay: async () => ({}),
      } as unknown as AaveV3AdapterConfig["actions"],
    });

    if (!adapter.buildAction) throw new Error("Missing buildAction");

    await expect(adapter.buildAction(lendAction, ctx)).rejects.toThrow("Insufficient collateral");
  });

  test("converts numeric value to bigint in transaction", async () => {
    const adapter = createAaveV3Adapter({
      markets: { 1: market },
      client: {} as AaveClient,
      actions: {
        supply: async () => ({
          __typename: "TransactionRequest",
          to: "0x0000000000000000000000000000000000000004",
          data: "0x03",
          value: 42,
        }),
        withdraw: async () => ({}),
        borrow: async () => ({}),
        repay: async () => ({}),
      } as unknown as AaveV3AdapterConfig["actions"],
    });

    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const result = await adapter.buildAction(lendAction, ctx);
    const built = Array.isArray(result) ? result : [result];
    expect(built[0]?.tx.value).toBe(42n);
  });

  test("handles plan result without __typename wrapper", async () => {
    const adapter = createAaveV3Adapter({
      markets: { 1: market },
      client: {} as AaveClient,
      actions: {
        supply: async () => ({
          notTypename: true,
          notValue: true,
        }),
        withdraw: async () => ({}),
        borrow: async () => ({}),
        repay: async () => ({}),
      } as unknown as AaveV3AdapterConfig["actions"],
    });

    if (!adapter.buildAction) throw new Error("Missing buildAction");

    // This plan result has no __typename and no value property, so extractExecutionPlan
    // falls through to the last return. Then buildAaveTransactions will reject it.
    await expect(adapter.buildAction(lendAction, ctx)).rejects.toThrow(
      "Unsupported Aave execution plan"
    );
  });

  test("rejects unsupported execution plan type", async () => {
    const adapter = createAaveV3Adapter({
      markets: { 1: market },
      client: {} as AaveClient,
      actions: {
        supply: async () => ({
          __typename: "UnknownPlanType",
        }),
        withdraw: async () => ({}),
        borrow: async () => ({}),
        repay: async () => ({}),
      } as unknown as AaveV3AdapterConfig["actions"],
    });

    if (!adapter.buildAction) throw new Error("Missing buildAction");

    await expect(adapter.buildAction(lendAction, ctx)).rejects.toThrow(
      "Unsupported Aave execution plan"
    );
  });
});
