import { describe, expect, test } from "bun:test";
import type { Address } from "@grimoirelabs/core";
import {
  isAddressLike,
  registerToken,
  resolveBridgedTokenAddress,
  resolveTokenAddress,
  tryResolveToken,
  tryResolveTokenByAddress,
} from "./token-registry.js";

// =============================================================================
// Existing API sanity
// =============================================================================

describe("resolveTokenAddress", () => {
  test("resolves known token", () => {
    const addr = resolveTokenAddress("USDC", 1);
    expect(addr).toBe("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
  });

  test("tryResolveToken returns undefined for unknown", () => {
    expect(tryResolveToken("DOESNOTEXIST", 1)).toBeUndefined();
  });

  test("isAddressLike matches 0x addresses", () => {
    expect(isAddressLike("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")).toBe(true);
    expect(isAddressLike("USDC")).toBe(false);
    expect(isAddressLike("0xshort")).toBe(false);
  });
});

// =============================================================================
// resolveBridgedTokenAddress
// =============================================================================

describe("resolveBridgedTokenAddress", () => {
  test("USDC 1 → 8453", () => {
    const addr = resolveBridgedTokenAddress("USDC", 1, 8453);
    expect(addr).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  });

  test("USDC 1 → 42161", () => {
    const addr = resolveBridgedTokenAddress("USDC", 1, 42161);
    expect(addr).toBe("0xaf88d065e77c8cC2239327C5EDb3A432268e5831");
  });

  test("WETH 1 → 10", () => {
    const addr = resolveBridgedTokenAddress("WETH", 1, 10);
    expect(addr).toBe("0x4200000000000000000000000000000000000006");
  });

  test("returns undefined for unknown symbol", () => {
    expect(resolveBridgedTokenAddress("DOESNOTEXIST", 1, 10)).toBeUndefined();
  });

  test("returns undefined for unknown target chain", () => {
    expect(resolveBridgedTokenAddress("USDC", 1, 999999)).toBeUndefined();
  });
});

// =============================================================================
// tryResolveTokenByAddress
// =============================================================================

describe("tryResolveTokenByAddress", () => {
  test("resolves known address", () => {
    const record = tryResolveTokenByAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 1);
    expect(record).toBeDefined();
    expect(record?.symbol).toBe("USDC");
    expect(record?.decimals).toBe(6);
  });

  test("returns undefined for wrong chainId", () => {
    expect(
      tryResolveTokenByAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 999999)
    ).toBeUndefined();
  });

  test("case-insensitive address lookup", () => {
    const lower = tryResolveTokenByAddress("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", 1);
    const upper = tryResolveTokenByAddress("0xA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48", 1);
    expect(lower).toBeDefined();
    expect(upper).toBeDefined();
    expect(lower?.symbol).toBe(upper?.symbol);
  });

  test("returns undefined for unknown address", () => {
    expect(
      tryResolveTokenByAddress("0x0000000000000000000000000000000000000000", 1)
    ).toBeUndefined();
  });
});

// =============================================================================
// registerToken
// =============================================================================

describe("registerToken", () => {
  test("new token resolves after registration", () => {
    registerToken(31337, {
      symbol: "TESTTKN",
      address: "0x1111111111111111111111111111111111111111" as Address,
      decimals: 18,
    });
    const record = tryResolveToken("TESTTKN", 31337);
    expect(record).toBeDefined();
    expect(record?.address).toBe("0x1111111111111111111111111111111111111111");
  });

  test("does not overwrite existing symbol", () => {
    registerToken(1, {
      symbol: "USDC",
      address: "0x2222222222222222222222222222222222222222" as Address,
      decimals: 6,
    });
    const record = tryResolveToken("USDC", 1);
    expect(record?.address).toBe("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
  });

  test("does not overwrite existing address in reverse index", () => {
    registerToken(1, {
      symbol: "FAKECOIN",
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
      decimals: 18,
    });
    const record = tryResolveTokenByAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 1);
    expect(record?.symbol).toBe("USDC");
  });

  test("registers on a new chain", () => {
    registerToken(99999, {
      symbol: "EXOTIC",
      address: "0x3333333333333333333333333333333333333333" as Address,
      decimals: 8,
    });
    expect(tryResolveToken("EXOTIC", 99999)).toBeDefined();
    expect(
      tryResolveTokenByAddress("0x3333333333333333333333333333333333333333", 99999)
    ).toBeDefined();
  });
});
