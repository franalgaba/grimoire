/**
 * Wallet types tests
 */

import { describe, expect, test } from "bun:test";
import { CHAIN_CONFIGS, getChainName, isTestnet } from "./types.js";

describe("Wallet Types", () => {
  describe("CHAIN_CONFIGS", () => {
    test("has mainnet config", () => {
      expect(CHAIN_CONFIGS[1]).toBeDefined();
      expect(CHAIN_CONFIGS[1].chainId).toBe(1);
      expect(CHAIN_CONFIGS[1].rpcUrl).toBeTruthy();
    });

    test("has optimism config", () => {
      expect(CHAIN_CONFIGS[10]).toBeDefined();
      expect(CHAIN_CONFIGS[10].chainId).toBe(10);
    });

    test("has sepolia config", () => {
      expect(CHAIN_CONFIGS[11155111]).toBeDefined();
      expect(CHAIN_CONFIGS[11155111].chainId).toBe(11155111);
    });

    test("configs have fallback URLs", () => {
      expect(CHAIN_CONFIGS[1].fallbackUrls).toBeDefined();
      expect(CHAIN_CONFIGS[1].fallbackUrls?.length).toBeGreaterThan(0);
    });
  });

  describe("isTestnet", () => {
    test("returns false for mainnet", () => {
      expect(isTestnet(1)).toBe(false);
    });

    test("returns false for optimism", () => {
      expect(isTestnet(10)).toBe(false);
    });

    test("returns true for sepolia", () => {
      expect(isTestnet(11155111)).toBe(true);
    });

    test("returns true for goerli", () => {
      expect(isTestnet(5)).toBe(true);
    });

    test("returns false for unknown chain", () => {
      expect(isTestnet(999999)).toBe(false);
    });
  });

  describe("getChainName", () => {
    test("returns correct name for mainnet", () => {
      expect(getChainName(1)).toBe("Ethereum Mainnet");
    });

    test("returns correct name for optimism", () => {
      expect(getChainName(10)).toBe("Optimism");
    });

    test("returns correct name for polygon", () => {
      expect(getChainName(137)).toBe("Polygon");
    });

    test("returns correct name for arbitrum", () => {
      expect(getChainName(42161)).toBe("Arbitrum One");
    });

    test("returns correct name for base", () => {
      expect(getChainName(8453)).toBe("Base");
    });

    test("returns correct name for sepolia", () => {
      expect(getChainName(11155111)).toBe("Sepolia");
    });

    test("returns fallback for unknown chain", () => {
      expect(getChainName(999999)).toBe("Chain 999999");
    });
  });
});
