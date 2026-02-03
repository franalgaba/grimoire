import { describe, expect, test } from "bun:test";
import type { Action, Address, Provider, VenueAdapterContext } from "@grimoirelabs/core";
import { buildApprovalIfNeeded } from "./erc20.js";

const baseAction: Action = {
  type: "lend",
  venue: "test",
  asset: "USDC",
  amount: 100n,
} as unknown as Action;

const token = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;
const spender = "0x0000000000000000000000000000000000000002" as Address;
const wallet = "0x0000000000000000000000000000000000000001" as Address;

describe("ERC20 approval helper", () => {
  test("returns empty array for zero or negative amount", async () => {
    const ctx: VenueAdapterContext = {
      provider: {} as unknown as Provider,
      walletAddress: wallet,
      chainId: 1,
    };

    const zeroResult = await buildApprovalIfNeeded({
      ctx,
      token,
      spender,
      amount: 0n,
      action: baseAction,
      description: "Approve",
    });
    expect(zeroResult).toHaveLength(0);

    const negResult = await buildApprovalIfNeeded({
      ctx,
      token,
      spender,
      amount: -1n,
      action: baseAction,
      description: "Approve",
    });
    expect(negResult).toHaveLength(0);
  });

  test("assumes approval needed when provider has no readContract", async () => {
    const ctx: VenueAdapterContext = {
      provider: {
        chainId: 1,
        getClient: () => ({}),
      } as unknown as Provider,
      walletAddress: wallet,
      chainId: 1,
    };

    const result = await buildApprovalIfNeeded({
      ctx,
      token,
      spender,
      amount: 100n,
      action: baseAction,
      description: "Approve USDC",
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.description).toBe("Approve USDC");
  });

  test("assumes approval needed when readContract throws", async () => {
    const ctx: VenueAdapterContext = {
      provider: {
        chainId: 1,
        getClient: () => ({
          readContract: async () => {
            throw new Error("RPC error");
          },
        }),
      } as unknown as Provider,
      walletAddress: wallet,
      chainId: 1,
    };

    const result = await buildApprovalIfNeeded({
      ctx,
      token,
      spender,
      amount: 100n,
      action: baseAction,
      description: "Approve USDC",
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.description).toBe("Approve USDC");
  });
});
