/**
 * Wallet types tests
 */

import { describe, expect, test } from "bun:test";
import {
  CHAIN_CONFIGS,
  getChainName,
  getNativeCurrencySymbol,
  isNativeCurrency,
  isTestnet,
} from "./types.js";

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

  describe("getNativeCurrencySymbol", () => {
    test("returns ETH for mainnet", () => {
      expect(getNativeCurrencySymbol(1)).toBe("ETH");
    });

    test("returns ETH for Arbitrum", () => {
      expect(getNativeCurrencySymbol(42161)).toBe("ETH");
    });

    test("returns ETH for Base", () => {
      expect(getNativeCurrencySymbol(8453)).toBe("ETH");
    });

    test("returns ETH for Optimism", () => {
      expect(getNativeCurrencySymbol(10)).toBe("ETH");
    });

    test("returns ETH for HyperEVM", () => {
      expect(getNativeCurrencySymbol(999)).toBe("ETH");
    });

    test("returns POL for Polygon", () => {
      expect(getNativeCurrencySymbol(137)).toBe("POL");
    });

    test("returns POL for Mumbai", () => {
      expect(getNativeCurrencySymbol(80001)).toBe("POL");
    });

    test("returns ETH as fallback for unknown chains", () => {
      expect(getNativeCurrencySymbol(999999)).toBe("ETH");
    });
  });

  describe("isNativeCurrency", () => {
    test("ETH is native on mainnet", () => {
      expect(isNativeCurrency("ETH", 1)).toBe(true);
    });

    test("ETH is not native on Polygon", () => {
      expect(isNativeCurrency("ETH", 137)).toBe(false);
    });

    test("POL is native on Polygon", () => {
      expect(isNativeCurrency("POL", 137)).toBe(true);
    });

    test("is case insensitive", () => {
      expect(isNativeCurrency("eth", 1)).toBe(true);
      expect(isNativeCurrency("Eth", 1)).toBe(true);
      expect(isNativeCurrency("pol", 137)).toBe(true);
    });

    test("USDC is not native on any chain", () => {
      expect(isNativeCurrency("USDC", 1)).toBe(false);
      expect(isNativeCurrency("USDC", 137)).toBe(false);
    });
  });
});
