/**
 * Transaction builder tests
 */

import { describe, expect, test } from "bun:test";
import type { Action } from "../types/actions.js";
import type { Expression } from "../types/expressions.js";
import type { Address } from "../types/primitives.js";
import type { Provider } from "./provider.js";
import { TransactionBuilder } from "./tx-builder.js";

const fromAddress = "0x0000000000000000000000000000000000000001" as Address;

const providerStub = {
  getGasEstimate: async () => ({
    gasLimit: 21000n,
    maxFeePerGas: 100n,
    maxPriorityFeePerGas: 2n,
    estimatedCost: 21000n * 100n,
  }),
  readContract: async ({ functionName }: { functionName: string }) => {
    if (functionName === "allowance") return 5n;
    if (functionName === "balanceOf") return 10n;
    if (functionName === "decimals") return 6;
    if (functionName === "symbol") return "USDC";
    return 0n;
  },
} as unknown as Provider;

const amount1 = 1n as unknown as Expression;
const amount5 = 5n as unknown as Expression;
const amount100 = 100n as unknown as Expression;
const amount200 = 200n as unknown as Expression;

describe("TransactionBuilder", () => {
  test("builds ERC20 transfer", async () => {
    const builder = new TransactionBuilder(providerStub, fromAddress);
    const action: Action = {
      type: "transfer",
      asset: "USDC",
      amount: amount100,
      to: "0x0000000000000000000000000000000000000002" as Address,
    };

    const built = await builder.buildTransfer(action);

    expect(built.tx.to).toBeDefined();
    expect(built.tx.data?.startsWith("0xa9059cbb")).toBe(true);
    expect(built.gasEstimate?.gasLimit).toBe(21000n);
  });

  test("builds ERC20 approve", async () => {
    const builder = new TransactionBuilder(providerStub, fromAddress);
    const action: Action = {
      type: "approve",
      asset: "USDC",
      amount: amount200,
      spender: "0x0000000000000000000000000000000000000003" as Address,
    };

    const built = await builder.buildApprove(action);

    expect(built.tx.data?.startsWith("0x095ea7b3")).toBe(true);
    expect(built.description).toContain("Approve");
  });

  test("checks allowance and balance", async () => {
    const builder = new TransactionBuilder(providerStub, fromAddress);
    const token = "0x0000000000000000000000000000000000000004" as Address;

    const allowance = await builder.checkAllowance(token, fromAddress);
    const balance = await builder.checkBalance(token);
    const decimals = await builder.getTokenDecimals(token);
    const symbol = await builder.getTokenSymbol(token);

    expect(allowance).toBe(5n);
    expect(balance).toBe(10n);
    expect(decimals).toBe(6);
    expect(symbol).toBe("USDC");
  });

  test("throws on unknown asset", async () => {
    const builder = new TransactionBuilder(providerStub, fromAddress);
    const action: Action = {
      type: "transfer",
      asset: "UNKNOWN",
      amount: amount1,
      to: "0x0000000000000000000000000000000000000002" as Address,
    };

    await expect(builder.buildTransfer(action)).rejects.toThrow("Unknown asset");
  });

  test("builds raw transaction", async () => {
    const builder = new TransactionBuilder(providerStub, fromAddress);
    const built = await builder.buildRaw(
      "0x0000000000000000000000000000000000000005" as Address,
      "0x1234",
      0n,
      "Raw"
    );

    expect(built.description).toBe("Raw");
    expect(built.tx.to).toBe("0x0000000000000000000000000000000000000005");
  });

  test("accepts address asset directly", async () => {
    const builder = new TransactionBuilder(providerStub, fromAddress);
    const action: Action = {
      type: "transfer",
      asset: "0x0000000000000000000000000000000000000006",
      amount: amount5,
      to: "0x0000000000000000000000000000000000000002" as Address,
    };

    const built = await builder.buildTransfer(action);
    expect(built.tx.to).toBe("0x0000000000000000000000000000000000000006");
  });

  test("throws for unsupported venue actions", async () => {
    const builder = new TransactionBuilder(providerStub, fromAddress);

    await expect(
      builder.buildSwap({
        type: "swap",
        venue: "uniswap",
        assetIn: "USDC",
        assetOut: "USDC",
        amount: amount1,
        mode: "exact_in",
      })
    ).rejects.toThrow("Swap transactions require venue adapters");

    await expect(
      builder.buildLend({
        type: "lend",
        venue: "aave",
        asset: "USDC",
        amount: amount1,
      })
    ).rejects.toThrow("Lend transactions require venue adapters");

    await expect(
      builder.buildWithdraw({
        type: "withdraw",
        venue: "aave",
        asset: "USDC",
        amount: amount1,
      })
    ).rejects.toThrow("Withdraw transactions require venue adapters");
  });
});
