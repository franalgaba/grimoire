import { describe, expect, test } from "bun:test";
import type { Action, Address, Provider, VenueAdapterContext } from "@grimoirelabs/core";
import type { ExchangeClient, HttpTransport } from "@nktkas/hyperliquid";
import { createHyperliquidAdapter, hyperliquidAdapter } from "./hyperliquid.js";

const orderAction: Action = {
  type: "custom",
  venue: "hyperliquid",
  op: "order",
  args: {
    coin: "BTC",
    price: "30000",
    size: "0.1",
    side: "buy",
  },
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

    const result = await adapter.buildAction(orderAction, adapterContext);
    const built = Array.isArray(result) ? result[0] : result;

    expect(built.description).toContain("Hyperliquid order");
  });

  test("executes order via exchange client", async () => {
    let called = false;
    const adapter = createHyperliquidAdapter({
      privateKey: "0x0000000000000000000000000000000000000000000000000000000000000001",
      assetMap: { BTC: 1 },
      exchange: {
        order: async () => {
          called = true;
          return { data: { orderId: "ord-1" } };
        },
      } as unknown as ExchangeClient,
      transport: {} as HttpTransport,
    });

    if (!adapter.executeAction) {
      throw new Error("Missing executeAction");
    }

    const result = await adapter.executeAction(orderAction, adapterContext);

    expect(called).toBe(true);
    expect(result.status).toBe("submitted");
    expect(result.reference).toBe("ord-1");
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

    await expect(adapter.executeAction(orderAction, adapterContext)).rejects.toThrow(
      "Unknown Hyperliquid asset mapping"
    );
  });

  test("default adapter throws on buildAction and executeAction", async () => {
    if (!hyperliquidAdapter.buildAction) throw new Error("Missing buildAction");
    if (!hyperliquidAdapter.executeAction) throw new Error("Missing executeAction");

    await expect(hyperliquidAdapter.buildAction(orderAction, adapterContext)).rejects.toThrow(
      "requires a private key"
    );

    await expect(hyperliquidAdapter.executeAction(orderAction, adapterContext)).rejects.toThrow(
      "requires a private key"
    );
  });

  test("rejects missing coin, price, size, or side", async () => {
    const adapter = createHyperliquidAdapter({
      privateKey: "0x0000000000000000000000000000000000000000000000000000000000000001",
      assetMap: { BTC: 1 },
    });

    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const noCoin: Action = {
      type: "custom",
      venue: "hyperliquid",
      op: "order",
      args: { price: "100", size: "1", side: "buy" },
    };
    await expect(adapter.buildAction(noCoin, adapterContext)).rejects.toThrow("requires args.coin");

    const noPrice: Action = {
      type: "custom",
      venue: "hyperliquid",
      op: "order",
      args: { coin: "BTC", size: "1", side: "buy" },
    };
    await expect(adapter.buildAction(noPrice, adapterContext)).rejects.toThrow(
      "requires args.price"
    );

    const noSize: Action = {
      type: "custom",
      venue: "hyperliquid",
      op: "order",
      args: { coin: "BTC", price: "100", side: "buy" },
    };
    await expect(adapter.buildAction(noSize, adapterContext)).rejects.toThrow("requires args.size");

    const noSide: Action = {
      type: "custom",
      venue: "hyperliquid",
      op: "order",
      args: { coin: "BTC", price: "100", size: "1" },
    };
    await expect(adapter.buildAction(noSide, adapterContext)).rejects.toThrow(
      "requires args.side or args.isBuy"
    );
  });

  test("rejects legacy swap action shape", async () => {
    const adapter = createHyperliquidAdapter({
      privateKey: "0x0000000000000000000000000000000000000000000000000000000000000001",
      assetMap: { BTC: 1 },
    });

    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const legacySwap = {
      type: "swap",
      venue: "hyperliquid",
      coin: "BTC",
      price: "100",
      size: "1",
      isBuy: true,
    } as unknown as Action;

    await expect(adapter.buildAction(legacySwap, adapterContext)).rejects.toThrow(
      "must use custom op 'order'"
    );
  });
});
