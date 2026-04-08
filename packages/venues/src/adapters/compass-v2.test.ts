import { describe, expect, test } from "bun:test";
import type {
  Action,
  Address,
  Expression,
  Provider,
  VenueAdapterContext,
} from "@grimoirelabs/core";
import { createCompassV2Adapter } from "./compass-v2.js";

// --- Mock SDK factory ---

function createMockSdk() {
  const calls: Array<{ namespace: string; method: string; args: unknown }> = [];
  const mockTxResponse = {
    unsigned_tx: {
      to: "0x0000000000000000000000000000000000000042",
      data: "0xdeadbeef",
      value: "0",
    },
  };
  const mockCreateAccountResponse = {
    unsigned_tx: {
      to: "0x0000000000000000000000000000000000000099",
      data: "0xaccount",
      value: "0",
    },
  };
  const mockTiResponse = {
    id: "ti-123",
    status: "submitted",
    reference: "0xti-ref",
  };

  return {
    calls,
    sdk: {
      earn: {
        earnBalances: async (args: unknown) => {
          calls.push({ namespace: "earn", method: "earnBalances", args });
          throw new Error("404");
        },
        earnCreateAccount: async (args: unknown) => {
          calls.push({
            namespace: "earn",
            method: "earnCreateAccount",
            args,
          });
          return mockCreateAccountResponse;
        },
        earnManage: async (args: unknown) => {
          calls.push({ namespace: "earn", method: "earnManage", args });
          return mockTxResponse;
        },
        earnSwap: async (args: unknown) => {
          calls.push({ namespace: "earn", method: "earnSwap", args });
          return mockTxResponse;
        },
        earnTransfer: async (args: unknown) => {
          calls.push({ namespace: "earn", method: "earnTransfer", args });
          return mockTxResponse;
        },
      },
      credit: {
        creditPositions: async (args: unknown) => {
          calls.push({
            namespace: "credit",
            method: "creditPositions",
            args,
          });
          throw new Error("404");
        },
        creditCreateAccount: async (args: unknown) => {
          calls.push({
            namespace: "credit",
            method: "creditCreateAccount",
            args,
          });
          return mockCreateAccountResponse;
        },
        creditTransfer: async (args: unknown) => {
          calls.push({ namespace: "credit", method: "creditTransfer", args });
          return mockTxResponse;
        },
        creditBorrow: async (args: unknown) => {
          calls.push({ namespace: "credit", method: "creditBorrow", args });
          return mockTxResponse;
        },
        creditRepay: async (args: unknown) => {
          calls.push({ namespace: "credit", method: "creditRepay", args });
          return mockTxResponse;
        },
      },
      bridge: {
        cctpBurn: async (args: unknown) => {
          calls.push({ namespace: "bridge", method: "cctpBurn", args });
          return mockTxResponse;
        },
        cctpMint: async (args: unknown) => {
          calls.push({ namespace: "bridge", method: "cctpMint", args });
          return mockTxResponse;
        },
      },
      traditionalInvesting: {
        traditionalInvestingMarketOrder: async (args: unknown) => {
          calls.push({
            namespace: "ti",
            method: "traditionalInvestingMarketOrder",
            args,
          });
          return mockTiResponse;
        },
        traditionalInvestingLimitOrder: async (args: unknown) => {
          calls.push({
            namespace: "ti",
            method: "traditionalInvestingLimitOrder",
            args,
          });
          return mockTiResponse;
        },
        traditionalInvestingCancelOrder: async (args: unknown) => {
          calls.push({
            namespace: "ti",
            method: "traditionalInvestingCancelOrder",
            args,
          });
          return mockTiResponse;
        },
        traditionalInvestingDeposit: async (args: unknown) => {
          calls.push({
            namespace: "ti",
            method: "traditionalInvestingDeposit",
            args,
          });
          return mockTiResponse;
        },
        traditionalInvestingWithdraw: async (args: unknown) => {
          calls.push({
            namespace: "ti",
            method: "traditionalInvestingWithdraw",
            args,
          });
          return mockTiResponse;
        },
        traditionalInvestingEnableUnifiedAccount: async (args: unknown) => {
          calls.push({
            namespace: "ti",
            method: "traditionalInvestingEnableUnifiedAccount",
            args,
          });
          return {};
        },
        traditionalInvestingApproveBuilderFee: async (args: unknown) => {
          calls.push({
            namespace: "ti",
            method: "traditionalInvestingApproveBuilderFee",
            args,
          });
          return {};
        },
        traditionalInvestingEnsureLeverage: async (args: unknown) => {
          calls.push({
            namespace: "ti",
            method: "traditionalInvestingEnsureLeverage",
            args,
          });
          return mockTiResponse;
        },
      },
    },
  };
}

// --- Shared test fixtures ---

const ctx: VenueAdapterContext = {
  provider: { chainId: 1 } as unknown as Provider,
  walletAddress: "0x0000000000000000000000000000000000000001" as Address,
  chainId: 1,
};

const amount1: Expression = { kind: "literal", value: 1000000n, type: "int" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MockSdk = ReturnType<typeof createMockSdk>["sdk"];

function makeAdapter(sdk: MockSdk, privateKey?: `0x${string}`) {
  // biome-ignore lint/suspicious/noExplicitAny: Mock SDK is intentionally loosely typed for testing
  return createCompassV2Adapter({ sdk: sdk as any, privateKey });
}

// --- Tests ---

describe("Compass V2 adapter", () => {
  // --- Meta ---

  test("meta.name is compass_v2", () => {
    const { sdk } = createMockSdk();
    const adapter = makeAdapter(sdk);
    expect(adapter.meta.name).toBe("compass_v2");
  });

  test("meta.supportedChains contains expected chains", () => {
    const { sdk } = createMockSdk();
    const adapter = makeAdapter(sdk);
    expect(adapter.meta.supportedChains).toContain(1);
    expect(adapter.meta.supportedChains).toContain(8453);
    expect(adapter.meta.supportedChains).toContain(42161);
  });

  test("meta.actions lists all supported types", () => {
    const { sdk } = createMockSdk();
    const adapter = makeAdapter(sdk);
    expect(adapter.meta.actions).toEqual(
      expect.arrayContaining([
        "lend",
        "withdraw",
        "swap",
        "transfer",
        "supply_collateral",
        "withdraw_collateral",
        "borrow",
        "repay",
        "bridge",
        "custom",
      ])
    );
  });

  // --- Account auto-management ---

  test("first earn action creates account, second skips", async () => {
    const { sdk } = createMockSdk();
    let balanceCalled = 0;
    sdk.earn.earnBalances = async (_args: unknown) => {
      balanceCalled++;
      if (balanceCalled === 1) throw new Error("404");
      return {} as never;
    };

    const adapter = makeAdapter(sdk);
    const action: Action = {
      type: "lend",
      venue: "compass_v2",
      asset: "USDC",
      amount: amount1,
    } as Action;

    const result1 = await adapter.buildAction?.(action, ctx);
    const built1 = Array.isArray(result1) ? result1 : [result1];
    expect(built1.length).toBeGreaterThanOrEqual(2);
    expect(built1[0]?.description).toContain("create");

    const result2 = await adapter.buildAction?.(action, ctx);
    const built2 = Array.isArray(result2) ? result2 : [result2];
    expect(built2.length).toBe(1);
  });

  test("earn and credit accounts are independent", async () => {
    const { sdk, calls } = createMockSdk();
    const adapter = makeAdapter(sdk);

    const lendAction: Action = {
      type: "lend",
      venue: "compass_v2",
      asset: "USDC",
      amount: amount1,
    } as Action;
    const supplyAction: Action = {
      type: "supply_collateral",
      venue: "compass_v2",
      asset: "USDC",
      amount: amount1,
    } as Action;

    await adapter.buildAction?.(lendAction, ctx);
    await adapter.buildAction?.(supplyAction, ctx);

    const createCalls = calls.filter((c) => c.method.includes("CreateAccount"));
    expect(createCalls).toHaveLength(2);
    expect(createCalls[0]?.namespace).toBe("earn");
    expect(createCalls[1]?.namespace).toBe("credit");
  });

  // --- Earn actions ---

  test("lend calls earnManage with DEPOSIT", async () => {
    const { sdk, calls } = createMockSdk();
    const adapter = makeAdapter(sdk);

    const action: Action = {
      type: "lend",
      venue: "compass_v2",
      asset: "USDC",
      amount: amount1,
    } as Action;

    await adapter.buildAction?.(action, ctx);

    const manageCalls = calls.filter((c) => c.method === "earnManage");
    expect(manageCalls).toHaveLength(1);
    expect((manageCalls[0]?.args as Record<string, unknown>).action).toBe("DEPOSIT");
  });

  test("lend with vault uses VAULT venue type", async () => {
    const { sdk, calls } = createMockSdk();
    const adapter = makeAdapter(sdk);

    const action: Action = {
      type: "lend",
      venue: "compass_v2",
      asset: "USDC",
      amount: amount1,
    } as Action;

    const vaultCtx = {
      ...ctx,
      vault: "0x1234567890abcdef1234567890abcdef12345678" as Address,
    };

    await adapter.buildAction?.(action, vaultCtx);

    const manageCalls = calls.filter((c) => c.method === "earnManage");
    const args = manageCalls[0]?.args as Record<string, unknown>;
    const venue = args.venue as Record<string, unknown>;
    expect(venue.type).toBe("VAULT");
    expect(venue.vaultAddress).toBe("0x1234567890abcdef1234567890abcdef12345678");
  });

  test("lend without vault uses AAVE venue type", async () => {
    const { sdk, calls } = createMockSdk();
    const adapter = makeAdapter(sdk);

    const action: Action = {
      type: "lend",
      venue: "compass_v2",
      asset: "USDC",
      amount: amount1,
    } as Action;

    await adapter.buildAction?.(action, ctx);

    const manageCalls = calls.filter((c) => c.method === "earnManage");
    const args = manageCalls[0]?.args as Record<string, unknown>;
    const venue = args.venue as Record<string, unknown>;
    expect(venue.type).toBe("AAVE");
  });

  test("withdraw calls earnManage with WITHDRAW", async () => {
    const { sdk, calls } = createMockSdk();
    const adapter = makeAdapter(sdk);

    const action: Action = {
      type: "withdraw",
      venue: "compass_v2",
      asset: "USDC",
      amount: amount1,
    } as Action;

    await adapter.buildAction?.(action, ctx);

    const manageCalls = calls.filter((c) => c.method === "earnManage");
    expect(manageCalls).toHaveLength(1);
    expect((manageCalls[0]?.args as Record<string, unknown>).action).toBe("WITHDRAW");
  });

  test("swap calls earnSwap with correct token mapping", async () => {
    const { sdk, calls } = createMockSdk();
    const adapter = makeAdapter(sdk);

    const action = {
      type: "swap",
      venue: "compass_v2",
      assetIn: "USDC",
      assetOut: "WETH",
      amount: amount1,
      mode: "exact_in",
      constraints: { maxSlippageBps: 50 },
    } as unknown as Action;

    await adapter.buildAction?.(action, ctx);

    const swapCalls = calls.filter((c) => c.method === "earnSwap");
    expect(swapCalls).toHaveLength(1);
    const args = swapCalls[0]?.args as Record<string, unknown>;
    expect(args.tokenIn).toBe("USDC");
    expect(args.tokenOut).toBe("WETH");
    expect(args.slippage).toBe(0.5);
  });

  test("transfer calls earnTransfer", async () => {
    const { sdk, calls } = createMockSdk();
    const adapter = makeAdapter(sdk);

    const action = {
      type: "transfer",
      asset: "USDC",
      amount: amount1,
      to: "0x0000000000000000000000000000000000000002",
    } as unknown as Action;

    await adapter.buildAction?.(action, ctx);

    const transferCalls = calls.filter((c) => c.method === "earnTransfer");
    expect(transferCalls).toHaveLength(1);
    const args = transferCalls[0]?.args as Record<string, unknown>;
    expect(args.token).toBe("USDC");
  });

  // --- Credit actions ---

  test("supply_collateral calls creditTransfer with DEPOSIT", async () => {
    const { sdk, calls } = createMockSdk();
    const adapter = makeAdapter(sdk);

    const action: Action = {
      type: "supply_collateral",
      venue: "compass_v2",
      asset: "WETH",
      amount: amount1,
    } as Action;

    await adapter.buildAction?.(action, ctx);

    const transferCalls = calls.filter((c) => c.method === "creditTransfer");
    expect(transferCalls).toHaveLength(1);
    expect((transferCalls[0]?.args as Record<string, unknown>).action).toBe("DEPOSIT");
  });

  test("withdraw_collateral calls creditTransfer with WITHDRAW", async () => {
    const { sdk, calls } = createMockSdk();
    const adapter = makeAdapter(sdk);

    const action: Action = {
      type: "withdraw_collateral",
      venue: "compass_v2",
      asset: "WETH",
      amount: amount1,
    } as Action;

    await adapter.buildAction?.(action, ctx);

    const transferCalls = calls.filter((c) => c.method === "creditTransfer");
    expect(transferCalls).toHaveLength(1);
    expect((transferCalls[0]?.args as Record<string, unknown>).action).toBe("WITHDRAW");
  });

  test("borrow calls creditBorrow with correct params", async () => {
    const { sdk, calls } = createMockSdk();
    const adapter = makeAdapter(sdk);

    const action = {
      type: "borrow",
      venue: "compass_v2",
      asset: "USDC",
      amount: amount1,
      collateral: "WETH",
    } as unknown as Action;

    await adapter.buildAction?.(action, ctx);

    const borrowCalls = calls.filter((c) => c.method === "creditBorrow");
    expect(borrowCalls).toHaveLength(1);
    const args = borrowCalls[0]?.args as Record<string, unknown>;
    expect(args.borrowToken).toBe("USDC");
    expect(args.collateralToken).toBe("WETH");
    expect(args.interestRateMode).toBe("variable");
  });

  test("repay calls creditRepay with correct params", async () => {
    const { sdk, calls } = createMockSdk();
    const adapter = makeAdapter(sdk);

    const action: Action = {
      type: "repay",
      venue: "compass_v2",
      asset: "USDC",
      amount: amount1,
    } as Action;

    await adapter.buildAction?.(action, ctx);

    const repayCalls = calls.filter((c) => c.method === "creditRepay");
    expect(repayCalls).toHaveLength(1);
    const args = repayCalls[0]?.args as Record<string, unknown>;
    expect(args.repayToken).toBe("USDC");
    expect(args.interestRateMode).toBe("variable");
  });

  // --- Bridge ---

  test("bridge with USDC calls cctpBurn", async () => {
    const { sdk, calls } = createMockSdk();
    const adapter = makeAdapter(sdk);

    const action = {
      type: "bridge",
      venue: "compass_v2",
      asset: "USDC",
      amount: amount1,
      toChain: 8453,
    } as unknown as Action;

    await adapter.buildAction?.(action, ctx);

    const burnCalls = calls.filter((c) => c.method === "cctpBurn");
    expect(burnCalls).toHaveLength(1);
    const args = burnCalls[0]?.args as Record<string, unknown>;
    expect(args.chain).toBe("ethereum");
    expect(args.destinationChain).toBe("base");
  });

  test("bridge with non-USDC throws", async () => {
    const { sdk } = createMockSdk();
    const adapter = makeAdapter(sdk);

    const action = {
      type: "bridge",
      venue: "compass_v2",
      asset: "WETH",
      amount: amount1,
      toChain: 8453,
    } as unknown as Action;

    await expect(adapter.buildAction?.(action, ctx)).rejects.toThrow("USDC");
  });

  // --- Error cases ---

  test("unsupported chain throws descriptive error", async () => {
    const { sdk } = createMockSdk();
    const adapter = makeAdapter(sdk);

    const action: Action = {
      type: "lend",
      venue: "compass_v2",
      asset: "USDC",
      amount: amount1,
    } as Action;

    const badCtx = { ...ctx, chainId: 999 };

    await expect(adapter.buildAction?.(action, badCtx)).rejects.toThrow("unsupported chain 999");
  });

  test("unsupported action type throws descriptive error", async () => {
    const { sdk } = createMockSdk();
    const adapter = makeAdapter(sdk);

    const action = {
      type: "unknown_action",
      venue: "compass_v2",
      asset: "USDC",
      amount: amount1,
    } as unknown as Action;

    await expect(adapter.buildAction?.(action, ctx)).rejects.toThrow("unsupported action type");
  });

  test("missing API key without SDK throws clear error", () => {
    const origKey = process.env.COMPASS_API_KEY;
    delete process.env.COMPASS_API_KEY;
    try {
      expect(() => createCompassV2Adapter()).toThrow("COMPASS_API_KEY");
    } finally {
      if (origKey) process.env.COMPASS_API_KEY = origKey;
    }
  });

  // --- Traditional Investing ---

  describe("Traditional Investing", () => {
    const privateKey =
      "0x0000000000000000000000000000000000000000000000000000000000000001" as `0x${string}`;

    test("custom action in buildAction returns dummy preview tx", async () => {
      const { sdk } = createMockSdk();
      const adapter = makeAdapter(sdk, privateKey);

      const action = {
        type: "custom",
        venue: "compass_v2",
        op: "ti_market_order",
        args: { asset: "AAPL", size: "1" },
      } as unknown as Action;

      const result = await adapter.buildAction?.(action, ctx);
      const built = Array.isArray(result) ? result : [result];
      expect(built).toHaveLength(1);
      expect(built[0]?.description).toContain("ti_market_order");
      expect(built[0]?.tx.to).toBe("0x0000000000000000000000000000000000000000");
    });

    test("ti_market_order via executeAction calls SDK and returns result", async () => {
      const { sdk, calls } = createMockSdk();
      const adapter = makeAdapter(sdk, privateKey);

      const action = {
        type: "custom",
        venue: "compass_v2",
        op: "ti_market_order",
        args: { asset: "AAPL", size: "1" },
      } as unknown as Action;

      const result = await adapter.executeAction?.(action, ctx);
      expect(result?.id).toBe("ti-123");
      expect(result?.status).toBe("submitted");

      const orderCalls = calls.filter((c) => c.method === "traditionalInvestingMarketOrder");
      expect(orderCalls).toHaveLength(1);
    });

    test("ti_limit_order via executeAction calls SDK and returns result", async () => {
      const { sdk, calls } = createMockSdk();
      const adapter = makeAdapter(sdk, privateKey);

      const action = {
        type: "custom",
        venue: "compass_v2",
        op: "ti_limit_order",
        args: { asset: "TSLA", size: "2", price: "150" },
      } as unknown as Action;

      const result = await adapter.executeAction?.(action, ctx);
      expect(result?.id).toBe("ti-123");

      const orderCalls = calls.filter((c) => c.method === "traditionalInvestingLimitOrder");
      expect(orderCalls).toHaveLength(1);
    });

    test("first TI trade triggers auto-setup", async () => {
      const { sdk, calls } = createMockSdk();
      const adapter = makeAdapter(sdk, privateKey);

      const action = {
        type: "custom",
        venue: "compass_v2",
        op: "ti_market_order",
        args: { asset: "AAPL", size: "1" },
      } as unknown as Action;

      await adapter.executeAction?.(action, ctx);

      const setupCalls = calls.filter(
        (c) =>
          c.method === "traditionalInvestingEnableUnifiedAccount" ||
          c.method === "traditionalInvestingApproveBuilderFee"
      );
      expect(setupCalls).toHaveLength(2);
    });

    test("second TI trade skips setup (cached)", async () => {
      const { sdk, calls } = createMockSdk();
      const adapter = makeAdapter(sdk, privateKey);

      const action = {
        type: "custom",
        venue: "compass_v2",
        op: "ti_market_order",
        args: { asset: "AAPL", size: "1" },
      } as unknown as Action;

      await adapter.executeAction?.(action, ctx);
      await adapter.executeAction?.(action, ctx);

      const setupCalls = calls.filter(
        (c) =>
          c.method === "traditionalInvestingEnableUnifiedAccount" ||
          c.method === "traditionalInvestingApproveBuilderFee"
      );
      // Only 2 setup calls total (from first trade), not 4
      expect(setupCalls).toHaveLength(2);
    });

    test("ti_setup explicitly triggers setup", async () => {
      const { sdk, calls } = createMockSdk();
      const adapter = makeAdapter(sdk, privateKey);

      const action = {
        type: "custom",
        venue: "compass_v2",
        op: "ti_setup",
        args: {},
      } as unknown as Action;

      const result = await adapter.executeAction?.(action, ctx);
      expect(result?.status).toBe("completed");

      const setupCalls = calls.filter(
        (c) =>
          c.method === "traditionalInvestingEnableUnifiedAccount" ||
          c.method === "traditionalInvestingApproveBuilderFee"
      );
      expect(setupCalls).toHaveLength(2);
    });

    test("ti_set_leverage calls ensureLeverage and skips auto-setup", async () => {
      const { sdk, calls } = createMockSdk();
      const adapter = makeAdapter(sdk, privateKey);

      const action = {
        type: "custom",
        venue: "compass_v2",
        op: "ti_set_leverage",
        args: { asset: "AAPL", leverage: 5 },
      } as unknown as Action;

      const result = await adapter.executeAction?.(action, ctx);
      expect(result?.id).toBe("ti-123");

      const leverageCalls = calls.filter((c) => c.method === "traditionalInvestingEnsureLeverage");
      expect(leverageCalls).toHaveLength(1);

      // No setup calls — ti_set_leverage skips auto-setup
      const setupCalls = calls.filter(
        (c) =>
          c.method === "traditionalInvestingEnableUnifiedAccount" ||
          c.method === "traditionalInvestingApproveBuilderFee"
      );
      expect(setupCalls).toHaveLength(0);
    });

    test("missing privateKey throws clear error", async () => {
      const { sdk } = createMockSdk();
      const adapter = makeAdapter(sdk); // no privateKey

      const action = {
        type: "custom",
        venue: "compass_v2",
        op: "ti_market_order",
        args: { asset: "AAPL", size: "1" },
      } as unknown as Action;

      await expect(adapter.executeAction?.(action, ctx)).rejects.toThrow("privateKey");
    });

    test("unknown TI op throws", async () => {
      const { sdk } = createMockSdk();
      const adapter = makeAdapter(sdk, privateKey);

      const action = {
        type: "custom",
        venue: "compass_v2",
        op: "ti_unknown_op",
        args: {},
      } as unknown as Action;

      await expect(adapter.executeAction?.(action, ctx)).rejects.toThrow("unknown TI op");
    });

    test("ti_cancel_order routes to correct SDK method", async () => {
      const { sdk, calls } = createMockSdk();
      const adapter = makeAdapter(sdk, privateKey);

      const action = {
        type: "custom",
        venue: "compass_v2",
        op: "ti_cancel_order",
        args: { orderId: "order-456" },
      } as unknown as Action;

      await adapter.executeAction?.(action, ctx);

      const cancelCalls = calls.filter((c) => c.method === "traditionalInvestingCancelOrder");
      expect(cancelCalls).toHaveLength(1);
    });

    test("ti_deposit routes to correct SDK method", async () => {
      const { sdk, calls } = createMockSdk();
      const adapter = makeAdapter(sdk, privateKey);

      const action = {
        type: "custom",
        venue: "compass_v2",
        op: "ti_deposit",
        args: { amount: "100" },
      } as unknown as Action;

      await adapter.executeAction?.(action, ctx);

      const depositCalls = calls.filter((c) => c.method === "traditionalInvestingDeposit");
      expect(depositCalls).toHaveLength(1);
    });

    test("ti_withdraw routes to correct SDK method", async () => {
      const { sdk, calls } = createMockSdk();
      const adapter = makeAdapter(sdk, privateKey);

      const action = {
        type: "custom",
        venue: "compass_v2",
        op: "ti_withdraw",
        args: { amount: "50" },
      } as unknown as Action;

      await adapter.executeAction?.(action, ctx);

      const withdrawCalls = calls.filter((c) => c.method === "traditionalInvestingWithdraw");
      expect(withdrawCalls).toHaveLength(1);
    });
  });

  // --- Singleton ---

  test("default compassV2Adapter singleton has stub methods that throw", async () => {
    const { compassV2Adapter } = await import("./compass-v2.js");
    expect(compassV2Adapter.meta.name).toBe("compass_v2");
    await expect(compassV2Adapter.buildAction?.({} as Action, ctx)).rejects.toThrow(
      "createCompassV2Adapter"
    );
    await expect(compassV2Adapter.executeAction?.({} as Action, ctx)).rejects.toThrow(
      "createCompassV2Adapter"
    );
  });
});
