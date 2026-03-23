import { describe, expect, test } from "bun:test";
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
    } as unknown as Action;

    await expect(adapter.buildAction(unknownAssetAction, createCtx())).rejects.toThrow(
      "Unknown asset"
    );

    const maxAmountAction = {
      type: "lend",
      venue: "morpho_blue",
      asset: "USDC",
      amount: "max",
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
    } as unknown as Action;

    const literalAmountAction: Action = {
      type: "lend",
      venue: "morpho_blue",
      asset: "USDC",
      amount: amount4,
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

  test("selects market matching collateral", async () => {
    const market2 = {
      ...market,
      id: "test2",
      collateralToken: "0x6B175474E89094C44Da98b954EedeAC495271d0F" as Address,
    };
    const adapter = createMorphoBlueAdapter({ markets: [market, market2] });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    // With collateral matching market2
    const action = {
      type: "borrow",
      venue: "morpho_blue",
      asset: "USDC",
      collateral: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
      amount: amount1,
    } as unknown as Action;

    const result = await adapter.buildAction(action, createCtx());
    const built = Array.isArray(result) ? result : [result];
    expect(built[0]?.description).toContain("Morpho Blue borrow");
  });

  test("rejects ambiguous market when multiple match and no collateral or market_id specified", async () => {
    const market2 = {
      ...market,
      id: "test2",
      collateralToken: "0x6B175474E89094C44Da98b954EedeAC495271d0F" as Address,
    };
    const adapter = createMorphoBlueAdapter({ markets: [market, market2] });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    // Multiple USDC markets, no collateral specified — must error
    const action = {
      type: "borrow",
      venue: "morpho_blue",
      asset: "USDC",
      amount: amount1,
    } as unknown as Action;

    await expect(adapter.buildAction(action, createCtx())).rejects.toThrow(
      "Set explicit market_id to resolve ambiguity"
    );
  });

  test("resolves single market implicitly without error", async () => {
    const adapter = createMorphoBlueAdapter({ markets: [market] });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action = {
      type: "borrow",
      venue: "morpho_blue",
      asset: "USDC",
      amount: amount1,
    } as unknown as Action;

    const result = await adapter.buildAction(action, createCtx());
    const built = Array.isArray(result) ? result : [result];
    expect(built[0]?.description).toContain("Morpho Blue borrow");
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
    } as unknown as Action;

    await expect(adapter.buildAction(action, createCtx())).rejects.toThrow("market not configured");
  });

  test("rejects missing asset", async () => {
    const adapter = createMorphoBlueAdapter({ markets: [market] });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action = {
      type: "lend",
      venue: "morpho_blue",
      asset: undefined,
      amount: amount1,
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
});
