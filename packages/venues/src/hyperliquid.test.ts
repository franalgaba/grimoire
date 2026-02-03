import { describe, expect, test } from "bun:test";
import type { Action, Address, Provider, VenueAdapterContext } from "@grimoirelabs/core";
import type { ExchangeClient, HttpTransport } from "@nktkas/hyperliquid";
import { createHyperliquidAdapter, hyperliquidAdapter } from "./hyperliquid.js";

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

  test("rejects unknown asset mapping in executeAction", async () => {
    const adapter = createHyperliquidAdapter({
      privateKey: "0x0000000000000000000000000000000000000000000000000000000000000001",
      assetMap: {},
      exchange: {
        order: async () => ({ status: "ok" }),
      } as unknown as ExchangeClient,
      transport: {} as HttpTransport,
    });

    if (!adapter.executeAction) throw new Error("Missing executeAction");

    await expect(
      adapter.executeAction(orderAction as unknown as Action, adapterContext)
    ).rejects.toThrow("Unknown Hyperliquid asset mapping");
  });

  test("default adapter throws on buildAction and executeAction", async () => {
    if (!hyperliquidAdapter.buildAction) throw new Error("Missing buildAction");
    if (!hyperliquidAdapter.executeAction) throw new Error("Missing executeAction");

    await expect(
      hyperliquidAdapter.buildAction(orderAction as unknown as Action, adapterContext)
    ).rejects.toThrow("requires a private key");

    await expect(
      hyperliquidAdapter.executeAction(orderAction as unknown as Action, adapterContext)
    ).rejects.toThrow("requires a private key");
  });

  test("rejects non-object action", async () => {
    const adapter = createHyperliquidAdapter({
      privateKey: "0x0000000000000000000000000000000000000000000000000000000000000001",
      assetMap: { BTC: 1 },
    });

    if (!adapter.buildAction) throw new Error("Missing buildAction");

    await expect(adapter.buildAction(null as unknown as Action, adapterContext)).rejects.toThrow(
      "requires action object"
    );

    await expect(
      adapter.buildAction(undefined as unknown as Action, adapterContext)
    ).rejects.toThrow("requires action object");
  });

  test("rejects missing coin, price, or size", async () => {
    const adapter = createHyperliquidAdapter({
      privateKey: "0x0000000000000000000000000000000000000000000000000000000000000001",
      assetMap: { BTC: 1 },
    });

    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const noCoin = { type: "swap", venue: "hyperliquid", price: "100", size: "1" };
    await expect(adapter.buildAction(noCoin as unknown as Action, adapterContext)).rejects.toThrow(
      "requires action.coin"
    );

    const noPrice = { type: "swap", venue: "hyperliquid", coin: "BTC", size: "1" };
    await expect(adapter.buildAction(noPrice as unknown as Action, adapterContext)).rejects.toThrow(
      "requires action.price"
    );

    const noSize = { type: "swap", venue: "hyperliquid", coin: "BTC", price: "100" };
    await expect(adapter.buildAction(noSize as unknown as Action, adapterContext)).rejects.toThrow(
      "requires action.size"
    );
  });
});
