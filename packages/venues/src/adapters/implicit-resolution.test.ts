/**
 * Integration tests: validate implicit resolution elimination
 *
 * These tests verify that:
 * 1. Morpho Blue requires explicit market_id when multiple markets match
 * 2. Morpho Blue requires explicit market_id even when exactly 1 market matches
 * 3. Morpho Blue resolves with explicit market_id when multiple match
 * 4. Uniswap V3 throws without fee_tier
 * 5. Uniswap V4 throws without fee_tier
 * 6. Vault deposit/withdraw routes correctly through adapter
 */

import { describe, expect, test } from "bun:test";
import type {
  Action,
  Address,
  Expression,
  Provider,
  VenueAdapterContext,
} from "@grimoirelabs/core";
import { createMorphoBlueAdapter } from "./morpho-blue/index.js";
import { createUniswapV3Adapter } from "./uniswap-v3.js";
import { createUniswapV4Adapter } from "./uniswap-v4/index.js";

// ─── Shared helpers ──────────────────────────────────────────────────────────

const amount: Expression = { kind: "literal", value: 1000n, type: "int" };

function createMorphoCtx(): VenueAdapterContext {
  return {
    provider: {
      chainId: 1,
      getClient: () => ({
        readContract: async ({ functionName }: { functionName: string }) => {
          if (functionName === "allowance") return 0n;
          if (functionName === "position") return [0n, 0n, 1000n] as const;
          if (functionName === "market") return [1000000n, 0n, 100n, 100n, 0n, 0n] as const;
          return 0n;
        },
      }),
    } as unknown as Provider,
    walletAddress: "0x0000000000000000000000000000000000000001" as Address,
    chainId: 1,
  };
}

const usdcAddress = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;
const wethAddress = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address;
const daiAddress = "0x6B175474E89094C44Da98b954EedeAC495271d0F" as Address;

const marketA = {
  id: "weth-usdc",
  loanToken: usdcAddress,
  collateralToken: wethAddress,
  oracle: "0x0000000000000000000000000000000000000007" as Address,
  irm: "0x0000000000000000000000000000000000000008" as Address,
  lltv: 860000000000000000n,
};

const marketB = {
  id: "dai-usdc",
  loanToken: usdcAddress,
  collateralToken: daiAddress,
  oracle: "0x0000000000000000000000000000000000000009" as Address,
  irm: "0x0000000000000000000000000000000000000008" as Address,
  lltv: 770000000000000000n,
};

// ─── Morpho Blue: ambiguity detection ────────────────────────────────────────

describe("Implicit resolution elimination", () => {
  describe("Morpho Blue market ambiguity", () => {
    test("throws when 2+ markets match and market_id is omitted", async () => {
      const adapter = createMorphoBlueAdapter({ markets: [marketA, marketB] });
      if (!adapter.buildAction) throw new Error("Missing buildAction");

      const action = {
        type: "lend",
        venue: "morpho_blue",
        asset: "USDC",
        amount,
      } as unknown as Action;

      await expect(adapter.buildAction(action, createMorphoCtx())).rejects.toThrow(
        "requires explicit market_id"
      );
    });

    test("throws when 1 market matches and market_id is omitted", async () => {
      const adapter = createMorphoBlueAdapter({ markets: [marketA] });
      if (!adapter.buildAction) throw new Error("Missing buildAction");

      const action = {
        type: "lend",
        venue: "morpho_blue",
        asset: "USDC",
        amount,
      } as unknown as Action;

      await expect(adapter.buildAction(action, createMorphoCtx())).rejects.toThrow(
        "requires explicit market_id"
      );
    });

    test("resolves with explicit market_id when multiple match", async () => {
      const adapter = createMorphoBlueAdapter({ markets: [marketA, marketB] });
      if (!adapter.buildAction) throw new Error("Missing buildAction");

      const action = {
        type: "lend",
        venue: "morpho_blue",
        asset: "USDC",
        amount,
        marketId: "dai-usdc",
      } as unknown as Action;

      const result = await adapter.buildAction(action, createMorphoCtx());
      const built = Array.isArray(result) ? result : [result];
      expect(built[built.length - 1]?.description).toContain("Morpho Blue lend");
    });
  });

  // ─── Morpho Blue: vault deposit/withdraw ─────────────────────────────────

  describe("MetaMorpho vault actions", () => {
    test("vault_deposit produces approval + deposit tx targeting vault address", async () => {
      const adapter = createMorphoBlueAdapter({ markets: [marketA] });
      if (!adapter.buildAction) throw new Error("Missing buildAction");

      const vaultAddr = "0x186514400e52270cef3D80e1c6F8d10A75d47344" as Address;
      const action = {
        type: "vault_deposit",
        venue: "morpho_blue",
        asset: "USDC",
        amount,
        vault: vaultAddr,
      } as unknown as Action;

      const result = await adapter.buildAction(action, createMorphoCtx());
      const built = Array.isArray(result) ? result : [result];

      // approval + deposit = 2
      expect(built).toHaveLength(2);
      expect(built[0]?.description).toContain("Approve");
      expect(built[1]?.tx.to).toBe(vaultAddr);
      expect(built[1]?.description).toContain("MetaMorpho vault_deposit");
      // calldata should be non-empty (MetaMorphoAction.deposit encoded)
      expect(built[1]?.tx.data).toBeDefined();
      expect((built[1]?.tx.data as string).length).toBeGreaterThan(10);
    });

    test("vault_withdraw produces single tx targeting vault address", async () => {
      const adapter = createMorphoBlueAdapter({ markets: [marketA] });
      if (!adapter.buildAction) throw new Error("Missing buildAction");

      const vaultAddr = "0x186514400e52270cef3D80e1c6F8d10A75d47344" as Address;
      const action = {
        type: "vault_withdraw",
        venue: "morpho_blue",
        asset: "USDC",
        amount,
        vault: vaultAddr,
      } as unknown as Action;

      const result = await adapter.buildAction(action, createMorphoCtx());
      const built = Array.isArray(result) ? result : [result];

      expect(built).toHaveLength(1);
      expect(built[0]?.tx.to).toBe(vaultAddr);
      expect(built[0]?.description).toContain("MetaMorpho vault_withdraw");
    });

    test("vault_deposit without vault address throws", async () => {
      const adapter = createMorphoBlueAdapter({ markets: [marketA] });
      if (!adapter.buildAction) throw new Error("Missing buildAction");

      const action = {
        type: "vault_deposit",
        venue: "morpho_blue",
        asset: "USDC",
        amount,
      } as unknown as Action;

      await expect(adapter.buildAction(action, createMorphoCtx())).rejects.toThrow(
        "requires an explicit vault address"
      );
    });
  });

  // ─── Uniswap: fee_tier requirement ───────────────────────────────────────

  describe("Uniswap fee_tier requirement", () => {
    test("V3 throws without fee_tier", async () => {
      const adapter = createUniswapV3Adapter();
      if (!adapter.buildAction) throw new Error("Missing buildAction");

      const action = {
        type: "swap",
        venue: "uniswap_v3",
        assetIn: "USDC",
        assetOut: "WETH",
        amount,
        mode: "exact_in",
      } as unknown as Action;

      const v3Ctx: VenueAdapterContext = {
        provider: {
          chainId: 1,
          readContract: async () => 0n,
          getClient: () => ({ readContract: async () => 0n }),
        } as unknown as Provider,
        walletAddress: "0x0000000000000000000000000000000000000001" as Address,
        chainId: 1,
      };

      await expect(adapter.buildAction(action, v3Ctx)).rejects.toThrow(
        "requires explicit fee_tier"
      );
    });

    test("V4 throws without fee_tier", async () => {
      const adapter = createUniswapV4Adapter();
      if (!adapter.buildAction) throw new Error("Missing buildAction");

      const action = {
        type: "swap",
        venue: "uniswap_v4",
        assetIn: "ETH",
        assetOut: "USDC",
        amount,
        mode: "exact_in",
      } as unknown as Action;

      const v4Ctx: VenueAdapterContext = {
        provider: {
          chainId: 1,
          readContract: async () => [0n, 0n],
          getClient: () => ({ readContract: async () => 0n }),
        } as unknown as Provider,
        walletAddress: "0x0000000000000000000000000000000000000001" as Address,
        chainId: 1,
      };

      await expect(adapter.buildAction(action, v4Ctx)).rejects.toThrow(
        "requires explicit fee_tier"
      );
    });
  });
});
