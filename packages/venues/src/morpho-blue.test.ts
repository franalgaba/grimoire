import { describe, expect, test } from "bun:test";
import type { Action, Address, Expression, Provider, VenueAdapterContext } from "@grimoire/core";
import { createMorphoBlueAdapter } from "./morpho-blue.js";

const market = {
  id: "test",
  loanToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
  collateralToken: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address,
  oracle: "0x0000000000000000000000000000000000000007" as Address,
  irm: "0x0000000000000000000000000000000000000008" as Address,
  lltv: 0n,
};

const providerStub = {
  chainId: 1,
  getClient: () => ({
    readContract: async () => 0n,
  }),
} as unknown as Provider;

const ctx: VenueAdapterContext = {
  provider: providerStub,
  walletAddress: "0x0000000000000000000000000000000000000001" as Address,
  chainId: 1,
};

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

    const result = await adapter.buildAction(lendAction, ctx);

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

    const result = await adapter.buildAction(repayAction, ctx);

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

    const result = await adapter.buildAction(withdrawAction, ctx);

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

    const result = await adapter.buildAction(borrowAction, ctx);

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

    await expect(adapter.buildAction(unknownAssetAction, ctx)).rejects.toThrow("Unknown asset");

    const maxAmountAction = {
      type: "lend",
      venue: "morpho_blue",
      asset: "USDC",
      amount: "max",
    } as unknown as Action;

    await expect(adapter.buildAction(maxAmountAction, ctx)).rejects.toThrow("explicit amount");
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

    const result = await adapter.buildAction(numericAmountAction, ctx);

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

    const stringResult = await adapter.buildAction(stringAmountAction, ctx);
    const literalResult = await adapter.buildAction(literalAmountAction, ctx);

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

    await expect(adapter.buildAction(action, ctx)).rejects.toThrow(
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

    const result = await adapter.buildAction(action, ctx);
    const built = Array.isArray(result) ? result : [result];
    expect(built[0]?.description).toContain("Morpho Blue borrow");
  });

  test("picks first market when multiple match and no collateral specified", async () => {
    const market2 = {
      ...market,
      id: "test2",
      collateralToken: "0x6B175474E89094C44Da98b954EedeAC495271d0F" as Address,
    };
    const adapter = createMorphoBlueAdapter({ markets: [market, market2] });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    // Multiple USDC markets, no collateral specified — picks first
    const action = {
      type: "borrow",
      venue: "morpho_blue",
      asset: "USDC",
      amount: amount1,
    } as unknown as Action;

    const result = await adapter.buildAction(action, ctx);
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

    await expect(adapter.buildAction(action, ctx)).rejects.toThrow("market not configured");
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

    await expect(adapter.buildAction(action, ctx)).rejects.toThrow("Asset is required");
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

    await expect(adapter.buildAction(action, ctx)).rejects.toThrow("Unsupported amount type");
  });
});
