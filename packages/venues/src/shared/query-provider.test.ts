/**
 * Alchemy QueryProvider tests
 */

import { describe, expect, mock, test } from "bun:test";
import { createAlchemyQueryProvider, extractAlchemyKey } from "./query-provider.js";

// =============================================================================
// extractAlchemyKey
// =============================================================================

describe("extractAlchemyKey", () => {
  test("extracts key from standard Alchemy mainnet URL", () => {
    const key = extractAlchemyKey("https://eth-mainnet.g.alchemy.com/v2/abc123xyz");
    expect(key).toBe("abc123xyz");
  });

  test("extracts key from Alchemy arbitrum URL", () => {
    const key = extractAlchemyKey("https://arb-mainnet.g.alchemy.com/v2/my_key-99");
    expect(key).toBe("my_key-99");
  });

  test("extracts key from Alchemy base URL", () => {
    const key = extractAlchemyKey("https://base-mainnet.g.alchemy.com/v2/testKey_ABC");
    expect(key).toBe("testKey_ABC");
  });

  test("returns undefined for non-Alchemy URL", () => {
    expect(extractAlchemyKey("https://eth.llamarpc.com")).toBeUndefined();
  });

  test("returns undefined for undefined input", () => {
    expect(extractAlchemyKey(undefined)).toBeUndefined();
  });

  test("returns undefined for empty string", () => {
    expect(extractAlchemyKey("")).toBeUndefined();
  });
});

// =============================================================================
// createAlchemyQueryProvider
// =============================================================================

describe("createAlchemyQueryProvider", () => {
  test("meta.name is 'alchemy'", () => {
    const mockProvider = createMockProvider();
    const qp = createAlchemyQueryProvider({
      provider: mockProvider,
      chainId: 1,
      vault: "0x0000000000000000000000000000000000000001" as `0x${string}`,
    });
    expect(qp.meta.name).toBe("alchemy");
  });

  test("supportedQueries includes price when apiKey is available", () => {
    const mockProvider = createMockProvider();
    const qp = createAlchemyQueryProvider({
      provider: mockProvider,
      chainId: 1,
      vault: "0x0000000000000000000000000000000000000001" as `0x${string}`,
      alchemyApiKey: "test-key",
    });
    expect(qp.meta.supportedQueries).toContain("price");
    expect(qp.meta.supportedQueries).toContain("balance");
  });

  test("supportedQueries excludes price when no apiKey", () => {
    const mockProvider = createMockProvider();
    const qp = createAlchemyQueryProvider({
      provider: mockProvider,
      chainId: 1,
      vault: "0x0000000000000000000000000000000000000001" as `0x${string}`,
    });
    expect(qp.meta.supportedQueries).toContain("balance");
    expect(qp.meta.supportedQueries).not.toContain("price");
  });

  test("queryBalance for ETH calls provider.getBalance", async () => {
    const mockProvider = createMockProvider({
      getBalance: mock(async () => 1000000000000000000n),
    });

    const qp = createAlchemyQueryProvider({
      provider: mockProvider,
      chainId: 1,
      vault: "0xVAULT" as `0x${string}`,
    });

    const result = await qp.queryBalance?.("ETH");
    expect(result).toBe(1000000000000000000n);
    expect(mockProvider.getBalance).toHaveBeenCalledWith("0xVAULT");
  });

  test("queryBalance for ETH with explicit address uses that address", async () => {
    const mockProvider = createMockProvider({
      getBalance: mock(async () => 500n),
    });

    const qp = createAlchemyQueryProvider({
      provider: mockProvider,
      chainId: 1,
      vault: "0xVAULT" as `0x${string}`,
    });

    const result = await qp.queryBalance?.("ETH", "0xOTHER");
    expect(result).toBe(500n);
    expect(mockProvider.getBalance).toHaveBeenCalledWith("0xOTHER");
  });

  test("queryBalance for ERC20 calls provider.readContract", async () => {
    const mockProvider = createMockProvider({
      readContract: mock(async () => 1000000n),
    });

    const qp = createAlchemyQueryProvider({
      provider: mockProvider,
      chainId: 1,
      vault: "0xVAULT" as `0x${string}`,
    });

    const result = await qp.queryBalance?.("USDC");
    expect(result).toBe(1000000n);
    expect(mockProvider.readContract).toHaveBeenCalled();
  });

  test("queryPrice without Alchemy key throws clear error", async () => {
    const mockProvider = createMockProvider();
    const qp = createAlchemyQueryProvider({
      provider: mockProvider,
      chainId: 1,
      vault: "0x0000000000000000000000000000000000000001" as `0x${string}`,
      // No alchemyApiKey, no rpcUrl → no API key
    });

    await expect(qp.queryPrice?.("ETH", "USDC")).rejects.toThrow(
      "Price queries require an Alchemy API key"
    );
  });

  test("queryPrice extracts API key from rpcUrl", () => {
    const mockProvider = createMockProvider();
    const qp = createAlchemyQueryProvider({
      provider: mockProvider,
      chainId: 1,
      vault: "0x0000000000000000000000000000000000000001" as `0x${string}`,
      rpcUrl: "https://eth-mainnet.g.alchemy.com/v2/my-secret-key",
    });
    expect(qp.meta.supportedQueries).toContain("price");
  });
});

// =============================================================================
// HELPERS
// =============================================================================

function createMockProvider(overrides?: Record<string, unknown>) {
  return {
    getBalance: mock(async () => 0n),
    readContract: mock(async () => 0n),
    getBlockNumber: mock(async () => 0n),
    getNonce: mock(async () => 0),
    estimateGas: mock(async () => ({
      gasLimit: 21000n,
      gasPrice: 0n,
      maxFeePerGas: 0n,
      maxPriorityFeePerGas: 0n,
    })),
    chainId: 1,
    rpcUrl: "https://eth.llamarpc.com",
    ...overrides,
  } as unknown as Parameters<typeof createAlchemyQueryProvider>[0]["provider"];
}
