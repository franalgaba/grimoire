import { describe, expect, mock, test } from "bun:test";
import { estimateGasIfSupported } from "./gas.js";

// =============================================================================
// estimateGasIfSupported
// =============================================================================

describe("estimateGasIfSupported", () => {
  test("returns undefined when provider lacks getGasEstimate", async () => {
    const ctx = createMockCtx({});
    const result = await estimateGasIfSupported(ctx, {
      to: "0x1111111111111111111111111111111111111111" as `0x${string}`,
    });
    expect(result).toBeUndefined();
  });

  test("returns gas estimate on success", async () => {
    const gasEstimate = {
      gasLimit: 21000n,
      maxFeePerGas: 1000000000n,
      maxPriorityFeePerGas: 100000000n,
      estimatedCost: 21000n * 1000000000n,
    };
    const ctx = createMockCtx({
      getGasEstimate: mock(async () => gasEstimate),
    });
    const result = await estimateGasIfSupported(ctx, {
      to: "0x1111111111111111111111111111111111111111" as `0x${string}`,
      data: "0xabcdef",
      value: 0n,
    });
    expect(result).toEqual(gasEstimate);
  });

  test("returns undefined when getGasEstimate throws", async () => {
    const ctx = createMockCtx({
      getGasEstimate: mock(async () => {
        throw new Error("estimation failed");
      }),
    });
    const result = await estimateGasIfSupported(ctx, {
      to: "0x1111111111111111111111111111111111111111" as `0x${string}`,
    });
    expect(result).toBeUndefined();
  });
});

// =============================================================================
// HELPERS
// =============================================================================

function createMockCtx(providerOverrides: Record<string, unknown>) {
  return {
    walletAddress: "0x0000000000000000000000000000000000000001" as `0x${string}`,
    chainId: 1,
    provider: {
      chainId: 1,
      rpcUrl: "https://eth.llamarpc.com",
      ...providerOverrides,
    },
  } as unknown as Parameters<typeof estimateGasIfSupported>[0];
}
