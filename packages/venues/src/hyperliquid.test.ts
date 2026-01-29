import { describe, expect, test } from "bun:test";
import type { Action, Address, Provider, VenueAdapterContext } from "@grimoire/core";
import type { ExchangeClient, HttpTransport } from "@nktkas/hyperliquid";
import { createHyperliquidAdapter } from "./hyperliquid.js";

type HyperliquidOrderAction = {
  type: "swap";
  venue: "hyperliquid";
  coin: string;
  price: string;
  size: string;
  isBuy: boolean;
};

const orderAction: HyperliquidOrderAction = {
  type: "swap",
  venue: "hyperliquid",
  coin: "BTC",
  price: "30000",
  size: "0.1",
  isBuy: true,
};

const adapterContext: VenueAdapterContext = {
  provider: {} as unknown as Provider,
  walletAddress: "0x0000000000000000000000000000000000000001" as Address,
  chainId: 0,
};

describe("Hyperliquid adapter", () => {
  test("builds offchain order description", async () => {
    const adapter = createHyperliquidAdapter({
      privateKey: "0x0000000000000000000000000000000000000000000000000000000000000001",
      assetMap: { BTC: 1 },
    });

    if (!adapter.buildAction) {
      throw new Error("Missing buildAction");
    }

    const result = await adapter.buildAction(orderAction as unknown as Action, adapterContext);
    const built = Array.isArray(result) ? result[0] : result;

    expect(built.description).toContain("Hyperliquid");
  });

  test("executes order via exchange client", async () => {
    let called = false;
    const adapter = createHyperliquidAdapter({
      privateKey: "0x0000000000000000000000000000000000000000000000000000000000000001",
      assetMap: { BTC: 1 },
      exchange: {
        order: async () => {
          called = true;
          return { status: "ok" };
        },
      } as unknown as ExchangeClient,
      transport: {} as HttpTransport,
    });

    if (!adapter.executeAction) {
      throw new Error("Missing executeAction");
    }

    const result = await adapter.executeAction(orderAction as unknown as Action, adapterContext);

    expect(called).toBe(true);
    expect(result.status).toBe("submitted");
  });
});
