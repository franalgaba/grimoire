/**
 * Provider tests
 */

import { describe, expect, test } from "bun:test";
import { createProvider, formatGasCostUsd, formatWei } from "./provider.js";

describe("Provider", () => {
  describe("createProvider", () => {
    test("creates provider for mainnet", () => {
      const provider = createProvider(1);
      expect(provider.chainId).toBe(1);
    });

    test("creates provider for sepolia", () => {
      const provider = createProvider(11155111);
      expect(provider.chainId).toBe(11155111);
    });

    test("creates provider with custom RPC URL", () => {
      const provider = createProvider(1, "https://custom.rpc.url");
      expect(provider.chainId).toBe(1);
      expect(provider.rpcUrl).toBe("https://custom.rpc.url");
    });

    test("throws for unknown chain without RPC URL", () => {
      expect(() => createProvider(999999)).toThrow();
    });
  });

  describe("formatWei", () => {
    test("formats whole ETH values", () => {
      const result = formatWei(1000000000000000000n); // 1 ETH
      expect(result).toBe("1");
    });

    test("formats fractional ETH values", () => {
      const result = formatWei(1500000000000000000n); // 1.5 ETH
      expect(result).toBe("1.5");
    });

    test("formats small values", () => {
      const result = formatWei(1000000000n); // 1 gwei
      expect(result).toBe("0.000000001");
    });

    test("formats zero", () => {
      const result = formatWei(0n);
      expect(result).toBe("0");
    });

    test("formats with custom decimals", () => {
      const result = formatWei(1000000n, 6); // 1 USDC
      expect(result).toBe("1");
    });
  });

  describe("formatGasCostUsd", () => {
    test("formats gas cost to USD", () => {
      const gasUsed = 21000n;
      const gasPrice = 20000000000n; // 20 gwei
      const result = formatGasCostUsd(gasUsed, gasPrice, 2000);

      // 21000 * 20 gwei = 0.00042 ETH * $2000 = $0.84
      expect(result).toBe("$0.84");
    });

    test("formats larger gas costs", () => {
      const gasUsed = 500000n;
      const gasPrice = 50000000000n; // 50 gwei
      const result = formatGasCostUsd(gasUsed, gasPrice, 2000);

      // 500000 * 50 gwei = 0.025 ETH * $2000 = $50
      expect(result).toBe("$50.00");
    });
  });

  describe("provider methods", () => {
    test("reads data via stubbed client", async () => {
      const provider = createProvider(1, "http://localhost");
      const stubClient = {
        getBlockNumber: async () => 123n,
        getBalance: async () => 999n,
        getTransactionCount: async () => 7,
        estimateGas: async () => 21000n,
        getBlock: async () => ({ baseFeePerGas: 10n }),
        readContract: async () => "ok",
        waitForTransactionReceipt: async () => ({ hash: "0xabc" }),
      };

      const providerWithClient = provider as unknown as { client: typeof stubClient };
      providerWithClient.client = stubClient;

      expect(await provider.getBlockNumber()).toBe(123n);
      expect(await provider.getBalance("0x0000000000000000000000000000000000000001")).toBe(999n);
      expect(await provider.getNonce("0x0000000000000000000000000000000000000001")).toBe(7);
      expect(
        await provider.estimateGas({
          to: "0x0000000000000000000000000000000000000001",
          from: "0x0000000000000000000000000000000000000002",
        })
      ).toBe(21000n);

      const prices = await provider.getGasPrices();
      expect(prices.maxFeePerGas).toBe(10n * 2n + 1500000000n);

      const estimate = await provider.getGasEstimate({
        to: "0x0000000000000000000000000000000000000001",
      });
      expect(estimate.gasLimit).toBe(25200n);

      const readResult = await provider.readContract<string>({
        address: "0x0000000000000000000000000000000000000001",
        abi: [],
        functionName: "symbol",
      });
      expect(readResult).toBe("ok");

      const receipt = (await provider.waitForTransaction("0xabc", 1)) as { hash: string };
      expect(receipt.hash).toBe("0xabc");
    });

    test("detects rate limit errors", () => {
      const provider = createProvider(1, "http://localhost");
      const providerWithSwitch = provider as unknown as {
        shouldSwitchProvider: (error: Error) => boolean;
      };
      const shouldSwitch = providerWithSwitch.shouldSwitchProvider(new Error("rate limit"));
      expect(shouldSwitch).toBe(true);
    });
  });
});

describe("Provider integration", () => {
  // These tests make actual RPC calls - skip in CI
  const runIntegration = process.env.RUN_INTEGRATION_TESTS === "true";

  test.skipIf(!runIntegration)("gets block number from mainnet", async () => {
    const provider = createProvider(1);
    const blockNumber = await provider.getBlockNumber();
    expect(blockNumber).toBeGreaterThan(0n);
  });

  test.skipIf(!runIntegration)("gets balance of known address", async () => {
    const provider = createProvider(1);
    // Vitalik's address - should have some ETH
    const balance = await provider.getBalance("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
    expect(balance).toBeGreaterThanOrEqual(0n);
  });
});
