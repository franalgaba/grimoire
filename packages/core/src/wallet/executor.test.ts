/**
 * Executor tests
 */

import { describe, expect, test } from "bun:test";
import type { Action } from "../types/actions.js";
import type { Expression } from "../types/expressions.js";
import type { Address } from "../types/primitives.js";
import type { VenueAdapter } from "../venues/types.js";
import { Executor } from "./executor.js";
import type { Provider } from "./provider.js";
import type { Wallet } from "./types.js";

const fromAddress = "0x0000000000000000000000000000000000000001" as Address;

const providerStub = {
  chainId: 1,
  rpcUrl: "http://localhost",
  getGasEstimate: async () => ({
    gasLimit: 21000n,
    maxFeePerGas: 100n,
    maxPriorityFeePerGas: 2n,
    estimatedCost: 21000n * 100n,
  }),
  readContract: async () => 0n,
} as unknown as Provider;

const walletStub = {
  address: fromAddress,
  chainId: 1,
  signTransaction: async () => "0x",
  signMessage: async () => "0x",
  sendTransaction: async () => ({
    hash: "0xabc",
    blockNumber: 1n,
    blockHash: "0xdef",
    gasUsed: 21000n,
    effectiveGasPrice: 100n,
    status: "success",
    logs: [],
  }),
} as Wallet;

const transferAmount = 10n as unknown as Expression;
const lendAmount = 1n as unknown as Expression;

describe("Executor", () => {
  test("simulates actions", async () => {
    const executor = new Executor({
      wallet: walletStub,
      provider: providerStub,
      mode: "simulate",
    });

    const action: Action = {
      type: "transfer",
      asset: "USDC",
      amount: transferAmount,
      to: "0x0000000000000000000000000000000000000002" as Address,
    };

    const result = await executor.executeActions([action]);

    expect(result.success).toBe(true);
    expect(result.transactions.length).toBe(1);
  });

  test("executes actions with confirmation", async () => {
    const executor = new Executor({
      wallet: walletStub,
      provider: providerStub,
      mode: "execute",
      confirmCallback: async () => true,
      progressCallback: () => undefined,
    });

    const action: Action = {
      type: "transfer",
      asset: "USDC",
      amount: transferAmount,
      to: "0x0000000000000000000000000000000000000002" as Address,
    };

    const result = await executor.executeActions([action]);

    expect(result.success).toBe(true);
    expect(result.totalGasUsed).toBe(21000n);
  });

  test("dry run does not send transactions", async () => {
    const executor = new Executor({
      wallet: walletStub,
      provider: providerStub,
      mode: "dry-run",
    });

    const action: Action = {
      type: "transfer",
      asset: "USDC",
      amount: transferAmount,
      to: "0x0000000000000000000000000000000000000002" as Address,
    };

    const result = await executor.executeActions([action]);

    expect(result.success).toBe(true);
    expect(result.transactions[0]?.hash).toBeUndefined();
  });

  test("cancels execution when confirmation denied", async () => {
    const executor = new Executor({
      wallet: walletStub,
      provider: providerStub,
      mode: "execute",
      confirmCallback: async () => false,
    });

    const action: Action = {
      type: "transfer",
      asset: "USDC",
      amount: transferAmount,
      to: "0x0000000000000000000000000000000000000002" as Address,
    };

    const result = await executor.executeActions([action]);

    expect(result.success).toBe(false);
    expect(result.error).toContain("cancelled");
  });

  test("applies gas multiplier", async () => {
    const executor = new Executor({
      wallet: walletStub,
      provider: providerStub,
      mode: "execute",
      confirmCallback: async () => true,
      gasMultiplier: 1.2,
    });

    const action: Action = {
      type: "transfer",
      asset: "USDC",
      amount: transferAmount,
      to: "0x0000000000000000000000000000000000000002" as Address,
    };

    const result = await executor.executeActions([action]);

    expect(result.success).toBe(true);
    expect(result.totalGasUsed).toBe(21000n);
  });

  test("uses venue adapter when available", async () => {
    const adapter: VenueAdapter = {
      meta: {
        name: "aave_v3",
        supportedChains: [1],
        actions: ["lend"],
      },
      buildAction: async (action: Action) => [
        {
          tx: { to: fromAddress, data: "0x" },
          description: "Adapter",
          action,
        },
      ],
    };

    const executor = new Executor({
      wallet: walletStub,
      provider: providerStub,
      mode: "simulate",
      adapters: [adapter],
    });

    const action: Action = {
      type: "lend",
      venue: "aave_v3",
      asset: "USDC",
      amount: lendAmount,
    };

    const result = await executor.executeActions([action]);

    expect(result.success).toBe(true);
    expect(result.transactions[0]?.builtTx.description).toBe("Adapter");
  });

  test("handles multi-transaction adapter output", async () => {
    const adapter: VenueAdapter = {
      meta: {
        name: "aave_v3",
        supportedChains: [1],
        actions: ["lend"],
      },
      buildAction: async (action: Action) => [
        {
          tx: { to: fromAddress, data: "0x" },
          description: "Approve",
          action,
        },
        {
          tx: { to: fromAddress, data: "0x01" },
          description: "Supply",
          action,
        },
      ],
    };

    const executor = new Executor({
      wallet: walletStub,
      provider: providerStub,
      mode: "simulate",
      adapters: [adapter],
    });

    const action: Action = {
      type: "lend",
      venue: "aave_v3",
      asset: "USDC",
      amount: lendAmount,
    };

    const result = await executor.executeActions([action]);

    expect(result.success).toBe(true);
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]?.builtTx.description).toBe("Approve");
    expect(result.transactions[1]?.builtTx.description).toBe("Supply");
  });
});
