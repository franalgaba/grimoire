import { describe, expect, mock, test } from "bun:test";
import type {
  Action,
  Address,
  Expression,
  Provider,
  VenueAdapterContext,
} from "@grimoirelabs/core";
import { blueAbi } from "@morpho-org/blue-sdk-viem";
import { decodeFunctionData } from "viem";
import { createMorphoBlueAdapter } from "./morpho-blue/index.js";

const market = {
  id: "test",
  loanToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
  collateralToken: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address,
  oracle: "0x0000000000000000000000000000000000000007" as Address,
  irm: "0x0000000000000000000000000000000000000008" as Address,
  lltv: 860000000000000000n,
};

function createProviderStub(overrides?: {
  allowance?: bigint;
  position?: readonly [bigint, bigint, bigint];
  marketState?: readonly [bigint, bigint, bigint, bigint, bigint, bigint];
  oraclePrice?: bigint;
}): Provider {
  const allowance = overrides?.allowance ?? 0n;
  const position = overrides?.position ?? ([0n, 0n, 1000n] as const);
  const marketState = overrides?.marketState ?? ([1000000n, 0n, 100n, 100n, 0n, 0n] as const);
  const oraclePrice = overrides?.oraclePrice;

  return {
    chainId: 1,
    getClient: () => ({
      readContract: async ({ functionName }: { functionName: string }): Promise<unknown> => {
        if (functionName === "allowance") return allowance;
        if (functionName === "position") return position;
        if (functionName === "market") return marketState;
        if (functionName === "price") {
          if (oraclePrice === undefined) {
            throw new Error("oracle unavailable");
          }
          return oraclePrice;
        }
        return 0n;
      },
    }),
  } as unknown as Provider;
}

function createCtx(overrides?: {
  mode?: VenueAdapterContext["mode"];
  provider?: Provider;
  crossChain?: VenueAdapterContext["crossChain"];
}): VenueAdapterContext {
  return {
    provider: overrides?.provider ?? createProviderStub(),
    walletAddress: "0x0000000000000000000000000000000000000001" as Address,
    chainId: 1,
    mode: overrides?.mode,
    crossChain: overrides?.crossChain,
  };
}

const amount1: Expression = { kind: "literal", value: 1n, type: "int" };
const amount4: Expression = { kind: "literal", value: 4n, type: "int" };
const amount5: Expression = { kind: "literal", value: 5n, type: "int" };

describe("Morpho Blue adapter", () => {
  test("adds approval for lend actions", async () => {
    const adapter = createMorphoBlueAdapter({ markets: [market] });

    if (!adapter.buildAction) {
      throw new Error("Missing buildAction");
    }

    const lendAction: Action = {
      type: "lend",
      venue: "morpho_blue",
      asset: "USDC",
      amount: amount5,
      marketId: "test",
    };

    const result = await adapter.buildAction(lendAction, createCtx());

    const built = Array.isArray(result) ? result : [result];

    expect(built).toHaveLength(2);
    expect(built[0]?.description).toContain("Approve USDC");
    expect(built[1]?.description).toContain("Morpho Blue lend");
  });

  test("adds approval for repay actions", async () => {
    const adapter = createMorphoBlueAdapter({ markets: [market] });

    if (!adapter.buildAction) {
      throw new Error("Missing buildAction");
    }

    const repayAction: Action = {
      type: "repay",
      venue: "morpho_blue",
      asset: "USDC",
      amount: amount5,
      marketId: "test",
    };

    const result = await adapter.buildAction(repayAction, createCtx());

    const built = Array.isArray(result) ? result : [result];

    expect(built).toHaveLength(2);
    expect(built[0]?.description).toContain("Approve USDC");
    expect(built[1]?.description).toContain("Morpho Blue repay");
  });

  test("builds withdraw action without approval", async () => {
    const adapter = createMorphoBlueAdapter({ markets: [market] });

    if (!adapter.buildAction) {
      throw new Error("Missing buildAction");
    }

    const withdrawAction: Action = {
      type: "withdraw",
      venue: "morpho_blue",
      asset: "USDC",
      amount: amount5,
      marketId: "test",
    };

    const result = await adapter.buildAction(withdrawAction, createCtx());

    const built = Array.isArray(result) ? result : [result];

    expect(built).toHaveLength(1);
    expect(built[0]?.description).toContain("Morpho Blue withdraw");
  });

  test("does not add approval for borrow actions", async () => {
    const adapter = createMorphoBlueAdapter({ markets: [market] });

    if (!adapter.buildAction) {
      throw new Error("Missing buildAction");
    }

    const borrowAction: Action = {
      type: "borrow",
      venue: "morpho_blue",
      asset: "USDC",
      amount: amount5,
      marketId: "test",
    };

    const result = await adapter.buildAction(borrowAction, createCtx());

    const built = Array.isArray(result) ? result : [result];

    expect(built).toHaveLength(1);
    expect(built[0]?.description).toContain("Morpho Blue borrow");
  });

  test("adds approval for supply_collateral and uses collateral token spender path", async () => {
    const adapter = createMorphoBlueAdapter({ markets: [market] });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action: Action = {
      type: "supply_collateral",
      venue: "morpho_blue",
      asset: "WETH",
      amount: amount5,
      marketId: "test",
    };

    const result = await adapter.buildAction(action, createCtx());
    const built = Array.isArray(result) ? result : [result];

    expect(built).toHaveLength(2);
    expect(built[0]?.description).toContain("Approve WETH");
    expect(built[1]?.description).toContain("Morpho Blue supply_collateral");
    const calldata = built[1]?.tx.data;
    expect(calldata).toBeDefined();
    const decoded = decodeFunctionData({
      abi: blueAbi,
      data: calldata as `0x${string}`,
    });
    expect(decoded.functionName).toBe("supplyCollateral");
  });

  test("builds withdraw_collateral without approval", async () => {
    const adapter = createMorphoBlueAdapter({ markets: [market] });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action: Action = {
      type: "withdraw_collateral",
      venue: "morpho_blue",
      asset: "WETH",
      amount: amount5,
      marketId: "test",
    };

    const result = await adapter.buildAction(action, createCtx());
    const built = Array.isArray(result) ? result : [result];

    expect(built).toHaveLength(1);
    expect(built[0]?.description).toContain("Morpho Blue withdraw_collateral");
    const calldata = built[0]?.tx.data;
    expect(calldata).toBeDefined();
    const decoded = decodeFunctionData({
      abi: blueAbi,
      data: calldata as `0x${string}`,
    });
    expect(decoded.functionName).toBe("withdrawCollateral");
  });

  test("borrow preflight fails when collateral is zero", async () => {
    const adapter = createMorphoBlueAdapter({ markets: [market] });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action: Action = {
      type: "borrow",
      venue: "morpho_blue",
      asset: "USDC",
      amount: amount5,
      marketId: "test",
    };

    await expect(
      adapter.buildAction(
        action,
        createCtx({
          provider: createProviderStub({
            position: [0n, 0n, 0n],
          }),
        })
      )
    ).rejects.toThrow("supply_collateral");
  });

  test("borrow preflight fails when requested amount exceeds market liquidity", async () => {
    const adapter = createMorphoBlueAdapter({ markets: [market] });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action: Action = {
      type: "borrow",
      venue: "morpho_blue",
      asset: "USDC",
      amount: amount5,
      marketId: "test",
    };

    await expect(
      adapter.buildAction(
        action,
        createCtx({
          provider: createProviderStub({
            position: [0n, 0n, 100n],
            marketState: [5n, 0n, 4n, 4n, 0n, 0n],
          }),
        })
      )
    ).rejects.toThrow("available liquidity");
  });

  test("borrow preflight passes with collateral and available liquidity", async () => {
    const adapter = createMorphoBlueAdapter({ markets: [market] });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action: Action = {
      type: "borrow",
      venue: "morpho_blue",
      asset: "USDC",
      amount: amount5,
      marketId: "test",
    };

    const result = await adapter.buildAction(
      action,
      createCtx({
        provider: createProviderStub({
          position: [0n, 0n, 500n],
          marketState: [1000n, 0n, 10n, 10n, 0n, 0n],
        }),
      })
    );
    const built = Array.isArray(result) ? result : [result];
    expect(built).toHaveLength(1);
    expect(built[0]?.description).toContain("Morpho Blue borrow");
  });

  test("resolves Ethereum default markets for explicit market_id lending", async () => {
    // Use default markets which now include Ethereum (chain 1) entries
    const { MORPHO_BLUE_DEFAULT_MARKETS } = await import("./morpho-blue/markets.js");
    const adapter = createMorphoBlueAdapter({ markets: MORPHO_BLUE_DEFAULT_MARKETS });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action: Action = {
      type: "lend",
      venue: "morpho_blue",
      asset: "USDC",
      amount: amount5,
      marketId: "cbbtc-usdc-1",
    };

    // Should succeed on chain 1 with explicit market_id
    const result = await adapter.buildAction(action, createCtx());
    const built = Array.isArray(result) ? result : [result];
    expect(built[built.length - 1]?.description).toContain("Morpho Blue lend");
  });

  test("rejects unknown market and max amount", async () => {
    const adapter = createMorphoBlueAdapter({ markets: [market] });

    if (!adapter.buildAction) {
      throw new Error("Missing buildAction");
    }

    const unknownAssetAction = {
      type: "lend",
      venue: "morpho_blue",
      asset: "UNKNOWN",
      amount: amount1,
      marketId: "test",
    } as unknown as Action;

    await expect(adapter.buildAction(unknownAssetAction, createCtx())).rejects.toThrow(
      "Unknown asset"
    );

    const maxAmountAction = {
      type: "lend",
      venue: "morpho_blue",
      asset: "USDC",
      amount: "max",
      marketId: "test",
    } as unknown as Action;

    await expect(adapter.buildAction(maxAmountAction, createCtx())).rejects.toThrow(
      "explicit amount"
    );
  });

  test("handles collateral matching and numeric amounts", async () => {
    const adapter = createMorphoBlueAdapter({ markets: [market] });

    if (!adapter.buildAction) {
      throw new Error("Missing buildAction");
    }

    const numericAmountAction = {
      type: "borrow",
      venue: "morpho_blue",
      asset: "USDC",
      collateral: "WETH",
      amount: 2,
      marketId: "test",
    } as unknown as Action;

    const result = await adapter.buildAction(numericAmountAction, createCtx());

    const built = Array.isArray(result) ? result : [result];
    expect(built[0]?.description).toContain("Morpho Blue borrow");
  });

  test("handles string and literal amounts", async () => {
    const adapter = createMorphoBlueAdapter({ markets: [market] });

    if (!adapter.buildAction) {
      throw new Error("Missing buildAction");
    }

    const stringAmountAction = {
      type: "lend",
      venue: "morpho_blue",
      asset: "USDC",
      amount: "3",
      marketId: "test",
    } as unknown as Action;

    const literalAmountAction: Action = {
      type: "lend",
      venue: "morpho_blue",
      asset: "USDC",
      amount: amount4,
      marketId: "test",
    };

    const stringResult = await adapter.buildAction(stringAmountAction, createCtx());
    const literalResult = await adapter.buildAction(literalAmountAction, createCtx());

    const builtString = Array.isArray(stringResult) ? stringResult : [stringResult];
    const builtLiteral = Array.isArray(literalResult) ? literalResult : [literalResult];

    expect(builtString[0]?.description).toContain("Approve USDC");
    expect(builtLiteral[0]?.description).toContain("Approve USDC");
  });

  test("rejects unsupported action type", async () => {
    const adapter = createMorphoBlueAdapter({ markets: [market] });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action = {
      type: "swap",
      venue: "morpho_blue",
      asset: "USDC",
      amount: amount1,
    } as unknown as Action;

    await expect(adapter.buildAction(action, createCtx())).rejects.toThrow(
      "Unsupported Morpho Blue action"
    );
  });

  test("selects explicit market_id", async () => {
    const market2 = {
      ...market,
      id: "test2",
      collateralToken: "0x6B175474E89094C44Da98b954EedeAC495271d0F" as Address,
    };
    const adapter = createMorphoBlueAdapter({ markets: [market, market2] });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action = {
      type: "borrow",
      venue: "morpho_blue",
      asset: "USDC",
      collateral: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
      amount: amount1,
      marketId: "test2",
    } as unknown as Action;

    const result = await adapter.buildAction(action, createCtx());
    const built = Array.isArray(result) ? result : [result];
    expect(built[0]?.description).toContain("Morpho Blue borrow");
  });

  test("rejects missing market_id when multiple markets match", async () => {
    const market2 = {
      ...market,
      id: "test2",
      collateralToken: "0x6B175474E89094C44Da98b954EedeAC495271d0F" as Address,
    };
    const adapter = createMorphoBlueAdapter({ markets: [market, market2] });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action = {
      type: "lend",
      venue: "morpho_blue",
      asset: "USDC",
      amount: amount1,
    } as unknown as Action;

    await expect(adapter.buildAction(action, createCtx())).rejects.toThrow(
      "requires explicit market_id"
    );
  });

  test("rejects missing market_id even when only one market is configured", async () => {
    const adapter = createMorphoBlueAdapter({ markets: [market] });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action = {
      type: "borrow",
      venue: "morpho_blue",
      asset: "USDC",
      amount: amount1,
    } as unknown as Action;

    await expect(adapter.buildAction(action, createCtx())).rejects.toThrow(
      "requires explicit market_id"
    );
  });

  test("rejects no matching loan token market", async () => {
    // Market is for USDC but we ask for WETH lending
    const adapter = createMorphoBlueAdapter({ markets: [market] });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action = {
      type: "lend",
      venue: "morpho_blue",
      asset: "WETH",
      amount: amount1,
      marketId: "test",
    } as unknown as Action;

    await expect(adapter.buildAction(action, createCtx())).rejects.toThrow(
      "does not match loan token"
    );
  });

  test("rejects missing asset", async () => {
    const adapter = createMorphoBlueAdapter({ markets: [market] });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action = {
      type: "lend",
      venue: "morpho_blue",
      asset: undefined,
      amount: amount1,
      marketId: "test",
    } as unknown as Action;

    await expect(adapter.buildAction(action, createCtx())).rejects.toThrow("Asset is required");
  });

  test("rejects unsupported amount type", async () => {
    const adapter = createMorphoBlueAdapter({ markets: [market] });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action = {
      type: "lend",
      venue: "morpho_blue",
      asset: "USDC",
      amount: { foo: true },
      marketId: "test",
    } as unknown as Action;

    await expect(adapter.buildAction(action, createCtx())).rejects.toThrow(
      "Unsupported amount type"
    );
  });

  test("fails closed in cross-chain mode without explicit market_id", async () => {
    const market2 = {
      ...market,
      id: "test2",
      collateralToken: "0x6B175474E89094C44Da98b954EedeAC495271d0F" as Address,
    };
    const adapter = createMorphoBlueAdapter({ markets: [market, market2] });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action = {
      type: "borrow",
      venue: "morpho_blue",
      asset: "USDC",
      amount: amount1,
    } as unknown as Action;

    const crossChainCtx = createCtx({
      crossChain: {
        enabled: true,
        actionRef: "source:step_1",
      },
    });

    await expect(adapter.buildAction(action, crossChainCtx)).rejects.toThrow(
      "requires explicit market_id"
    );
  });

  test("fails closed for supply_collateral in cross-chain mode without explicit market_id", async () => {
    const adapter = createMorphoBlueAdapter({ markets: [market] });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action = {
      type: "supply_collateral",
      venue: "morpho_blue",
      asset: "WETH",
      amount: amount1,
    } as unknown as Action;

    const crossChainCtx = createCtx({
      crossChain: {
        enabled: true,
        actionRef: "source:step_2",
      },
    });

    await expect(adapter.buildAction(action, crossChainCtx)).rejects.toThrow(
      "requires explicit market_id"
    );
  });

  test("accepts explicit market_id in cross-chain mode via action payload", async () => {
    const market2 = {
      ...market,
      id: "test2",
      collateralToken: "0x6B175474E89094C44Da98b954EedeAC495271d0F" as Address,
    };
    const adapter = createMorphoBlueAdapter({ markets: [market, market2] });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action = {
      type: "borrow",
      venue: "morpho_blue",
      asset: "USDC",
      amount: amount1,
      marketId: "test2",
    } as unknown as Action;

    const crossChainCtx = createCtx({
      crossChain: {
        enabled: true,
        actionRef: "source:step_1",
      },
    });

    const result = await adapter.buildAction(action, crossChainCtx);
    const built = Array.isArray(result) ? result : [result];
    expect(built[0]?.description).toContain("Morpho Blue borrow");
  });

  test("builds vault_deposit with approval and encoded calldata", async () => {
    const adapter = createMorphoBlueAdapter({ markets: [market] });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const vaultAddr = "0x0000000000000000000000000000000000000099" as Address;
    const action = {
      type: "vault_deposit",
      venue: "morpho_blue",
      asset: "USDC",
      amount: amount5,
      vault: vaultAddr,
    } as unknown as Action;

    const result = await adapter.buildAction(action, createCtx());
    const built = Array.isArray(result) ? result : [result];

    // Approval + deposit
    expect(built).toHaveLength(2);
    expect(built[0]?.description).toContain("Approve USDC");
    expect(built[1]?.description).toContain("MetaMorpho vault_deposit");
    expect(built[1]?.tx.to).toBe(vaultAddr);
    expect(built[1]?.tx.value).toBe(0n);
  });

  test("builds vault_withdraw without approval", async () => {
    const adapter = createMorphoBlueAdapter({ markets: [market] });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const vaultAddr = "0x0000000000000000000000000000000000000099" as Address;
    const action = {
      type: "vault_withdraw",
      venue: "morpho_blue",
      asset: "USDC",
      amount: amount5,
      vault: vaultAddr,
    } as unknown as Action;

    const result = await adapter.buildAction(action, createCtx());
    const built = Array.isArray(result) ? result : [result];

    expect(built).toHaveLength(1);
    expect(built[0]?.description).toContain("MetaMorpho vault_withdraw");
    expect(built[0]?.tx.to).toBe(vaultAddr);
  });

  test("vault_deposit rejects missing vault address", async () => {
    const adapter = createMorphoBlueAdapter({ markets: [market] });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action = {
      type: "vault_deposit",
      venue: "morpho_blue",
      asset: "USDC",
      amount: amount5,
    } as unknown as Action;

    await expect(adapter.buildAction(action, createCtx())).rejects.toThrow(
      "requires an explicit vault address"
    );
  });

  test("accepts explicit market_id in cross-chain mode via actionRef mapping", async () => {
    const market2 = {
      ...market,
      id: "test2",
      collateralToken: "0x6B175474E89094C44Da98b954EedeAC495271d0F" as Address,
    };
    const adapter = createMorphoBlueAdapter({ markets: [market, market2] });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action = {
      type: "borrow",
      venue: "morpho_blue",
      asset: "USDC",
      amount: amount1,
    } as unknown as Action;

    const crossChainCtx = createCtx({
      crossChain: {
        enabled: true,
        actionRef: "destination:step_9",
        morphoMarketIds: {
          "destination:step_9": "test2",
        },
      },
    });

    const result = await adapter.buildAction(action, crossChainCtx);
    const built = Array.isArray(result) ? result : [result];
    expect(built[0]?.description).toContain("Morpho Blue borrow");
  });

  test("readMetric selects highest-liquidity market for asset when selector is omitted", async () => {
    const adapter = createMorphoBlueAdapter({ markets: [market] });
    if (!adapter.readMetric) throw new Error("Missing readMetric");

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          data: {
            markets: {
              items: [
                {
                  marketId: "0x01",
                  chain: { id: 1 },
                  loanAsset: { symbol: "USDC" },
                  state: { supplyApy: 3.5, supplyAssetsUsd: 1000 },
                },
                {
                  marketId: "0x02",
                  chain: { id: 1 },
                  loanAsset: { symbol: "USDC" },
                  state: { supplyApy: 4.1, supplyAssetsUsd: 5000 },
                },
              ],
            },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    }) as unknown as typeof fetch;

    try {
      const value = await adapter.readMetric(
        {
          surface: "apy",
          venue: "morpho_blue",
          asset: "USDC",
        },
        createCtx()
      );
      expect(value).toBeCloseTo(410, 6);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("readMetric uses explicit market selector", async () => {
    const adapter = createMorphoBlueAdapter({ markets: [market] });
    if (!adapter.readMetric) throw new Error("Missing readMetric");

    const originalFetch = globalThis.fetch;
    let capturedWhere: unknown;
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as {
        variables?: { where?: unknown };
      };
      capturedWhere = payload.variables?.where;
      return new Response(
        JSON.stringify({
          data: {
            markets: {
              items: [
                {
                  marketId: "0xabc",
                  chain: { id: 1 },
                  loanAsset: { symbol: "USDC" },
                  state: { supplyApy: 420 },
                },
              ],
            },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    }) as unknown as typeof fetch;

    try {
      const value = await adapter.readMetric(
        {
          surface: "apy",
          venue: "morpho_blue",
          asset: "USDC",
          selector: "0xabc",
        },
        createCtx()
      );
      expect(value).toBe(420);
      expect(capturedWhere).toEqual({ uniqueKey_in: ["0xabc"] });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("readMetric supports vault_apy with explicit vault selector", async () => {
    const adapter = createMorphoBlueAdapter({ markets: [market] });
    if (!adapter.readMetric) throw new Error("Missing readMetric");

    const originalFetch = globalThis.fetch;
    let capturedWhere: unknown;
    const vaultAddress = "0x00000000000000000000000000000000000000ab";
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as {
        variables?: { where?: unknown };
      };
      capturedWhere = payload.variables?.where;
      return new Response(
        JSON.stringify({
          data: {
            vaults: {
              items: [
                {
                  address: vaultAddress,
                  name: "USDC Prime Vault",
                  symbol: "mUSDC",
                  chain: { id: 1 },
                  asset: { symbol: "USDC" },
                  state: { apy: 0.041, netApy: 0.036, totalAssetsUsd: 1000000 },
                },
              ],
            },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    }) as unknown as typeof fetch;

    try {
      const value = await adapter.readMetric(
        {
          surface: "vault_apy",
          venue: "morpho_blue",
          asset: "USDC",
          selector: `vault=${vaultAddress}`,
        },
        createCtx()
      );
      expect(value).toBeCloseTo(410, 6);
      expect(capturedWhere).toEqual({ chainId_in: [1], assetSymbol_in: ["USDC"] });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("readMetric vault APY metrics require selector even when asset is provided", async () => {
    const adapter = createMorphoBlueAdapter({ markets: [market] });
    if (!adapter.readMetric) throw new Error("Missing readMetric");

    await expect(
      adapter.readMetric(
        {
          surface: "vault_net_apy",
          venue: "morpho_blue",
          asset: "USDC",
        },
        createCtx()
      )
    ).rejects.toThrow("require explicit vault selector");
  });

  test("readMetric vault APY metrics require selector when omitted", async () => {
    const adapter = createMorphoBlueAdapter({ markets: [market] });
    if (!adapter.readMetric) throw new Error("Missing readMetric");

    await expect(
      adapter.readMetric(
        {
          surface: "vault_apy",
          venue: "morpho_blue",
        },
        createCtx()
      )
    ).rejects.toThrow("require explicit vault selector");
  });
});
