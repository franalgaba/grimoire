import { describe, expect, test } from "bun:test";
import type { Action, Address, Provider, VenueAdapterContext } from "@grimoirelabs/core";
import { ClobClient } from "@polymarket/clob-client";
import type { PolymarketExecutionClient } from "./polymarket/index.js";
import { createPolymarketAdapter, polymarketAdapter } from "./polymarket/index.js";

const adapterContext: VenueAdapterContext = {
  provider: {} as unknown as Provider,
  walletAddress: "0x0000000000000000000000000000000000000001" as Address,
  chainId: 137,
};

const orderAction: Action = {
  type: "custom",
  venue: "polymarket",
  op: "order",
  args: {
    token_id: "12345",
    price: "0.55",
    size: "10",
    side: "BUY",
    order_type: "GTC",
  },
};

describe("Polymarket adapter", () => {
  test("reads mid_price metric for token id", async () => {
    const original = ClobClient.prototype.getMidpoint;
    ClobClient.prototype.getMidpoint = async () => ({ midpoint: "0.62" });
    try {
      const adapter = createPolymarketAdapter();
      if (!adapter.readMetric) throw new Error("Missing readMetric");

      const value = await adapter.readMetric(
        {
          surface: "mid_price",
          venue: "polymarket",
          asset: "12345",
        },
        adapterContext
      );

      expect(value).toBe(0.62);
    } finally {
      ClobClient.prototype.getMidpoint = original;
    }
  });

  test("builds offchain custom order description", async () => {
    const adapter = createPolymarketAdapter();

    if (!adapter.buildAction) {
      throw new Error("Missing buildAction");
    }

    const result = await adapter.buildAction(orderAction, adapterContext);
    const built = Array.isArray(result) ? result[0] : result;
    const route = built.metadata?.route as { op?: string } | undefined;

    expect(built.description).toContain("Polymarket order BUY");
    expect(route?.op).toBe("order");
  });

  test("executes GTC order via configured CLOB client", async () => {
    let request: unknown;
    let options: unknown;
    let orderType: unknown;

    const client: PolymarketExecutionClient = {
      createAndPostOrder: async (nextRequest, nextOptions, nextOrderType) => {
        request = nextRequest;
        options = nextOptions;
        orderType = nextOrderType;
        return { orderID: "ord-1", status: "live" };
      },
      createAndPostMarketOrder: async () => ({ orderID: "market-ord", status: "live" }),
      cancelOrder: async () => undefined,
      cancelOrders: async () => undefined,
      cancelAll: async () => ({ canceled: true }),
      postHeartbeat: async () => ({ heartbeat_id: "hb-1" }),
    };

    const adapter = createPolymarketAdapter({ client });
    if (!adapter.executeAction) throw new Error("Missing executeAction");

    const result = await adapter.executeAction(orderAction, adapterContext);

    expect(result.id).toBe("ord-1");
    expect(result.status).toBe("live");
    expect(String(orderType)).toContain("GTC");
    expect(request).toEqual({
      tokenID: "12345",
      price: 0.55,
      size: 10,
      side: "BUY",
    });
    expect(options).toEqual({
      tickSize: "0.01",
      negRisk: false,
    });
  });

  test("routes FOK/FAK orders to createAndPostMarketOrder", async () => {
    let calledMarket = false;
    let marketOrderType: unknown;
    let marketRequest: unknown;

    const client: PolymarketExecutionClient = {
      createAndPostOrder: async () => ({ orderID: "ord-2", status: "live" }),
      createAndPostMarketOrder: async (request, _options, orderType) => {
        calledMarket = true;
        marketRequest = request;
        marketOrderType = orderType;
        return { orderID: "ord-fok", status: "submitted" };
      },
      cancelOrder: async () => undefined,
      cancelOrders: async () => undefined,
      cancelAll: async () => ({ canceled: true }),
      postHeartbeat: async () => ({ heartbeat_id: "hb-2" }),
    };

    const adapter = createPolymarketAdapter({ client });
    if (!adapter.executeAction) throw new Error("Missing executeAction");

    const action: Action = {
      type: "custom",
      venue: "polymarket",
      op: "order",
      args: {
        token_id: "token-fok",
        price: 0.61,
        amount: 100,
        side: "buy",
        order_type: "fok",
      },
    };

    const result = await adapter.executeAction(action, adapterContext);
    expect(result.reference).toBe("ord-fok");
    expect(calledMarket).toBe(true);
    expect(String(marketOrderType)).toContain("FOK");
    expect(marketRequest).toEqual({
      tokenID: "token-fok",
      price: 0.61,
      amount: 100,
      side: "BUY",
    });
  });

  test("accepts transformer-style order args", async () => {
    let capturedOptions: unknown;

    const client: PolymarketExecutionClient = {
      createAndPostOrder: async (_request, options) => {
        capturedOptions = options;
        return { orderID: "ord-3", status: "submitted" };
      },
      createAndPostMarketOrder: async () => ({ orderID: "ord-4", status: "submitted" }),
      cancelOrder: async () => undefined,
      cancelOrders: async () => undefined,
      cancelAll: async () => ({ canceled: true }),
      postHeartbeat: async () => ({ heartbeat_id: "hb-3" }),
    };

    const adapter = createPolymarketAdapter({ client });
    if (!adapter.executeAction) throw new Error("Missing executeAction");

    const action: Action = {
      type: "custom",
      venue: "polymarket",
      op: "order",
      args: {
        coin: "token-1",
        price: 0.61,
        size: 5,
        side: "sell",
        reduce_only: true,
        order_type: "gtc",
      },
    };

    const result = await adapter.executeAction(action, adapterContext);
    expect(result.reference).toBe("ord-3");
    expect(capturedOptions).toEqual({
      tickSize: "0.01",
      negRisk: true,
    });
  });

  test("executes cancel operations and heartbeat", async () => {
    let canceledOrder: { orderID: string } | undefined;
    let canceledOrders: string[] | undefined;
    let heartbeatId: string | null | undefined;

    const client: PolymarketExecutionClient = {
      createAndPostOrder: async () => ({ orderID: "ord-5", status: "submitted" }),
      createAndPostMarketOrder: async () => ({ orderID: "ord-6", status: "submitted" }),
      cancelOrder: async (payload) => {
        canceledOrder = payload;
        return { status: "ok" };
      },
      cancelOrders: async (orderIds) => {
        canceledOrders = orderIds;
        return { status: "ok" };
      },
      cancelAll: async () => ({ id: "req-1", status: "ok" }),
      postHeartbeat: async (id) => {
        heartbeatId = id;
        return { heartbeat_id: "hb-next", status: "ok" };
      },
    };

    const adapter = createPolymarketAdapter({ client });
    if (!adapter.executeAction) throw new Error("Missing executeAction");

    const cancelOne = await adapter.executeAction(
      {
        type: "custom",
        venue: "polymarket",
        op: "cancel_order",
        args: { arg0: "ord-cancel-1" },
      } as Action,
      adapterContext
    );

    const cancelMany = await adapter.executeAction(
      {
        type: "custom",
        venue: "polymarket",
        op: "cancel_orders",
        args: { arg0: ["ord-cancel-2", "ord-cancel-3"] },
      } as Action,
      adapterContext
    );

    const cancelAll = await adapter.executeAction(
      {
        type: "custom",
        venue: "polymarket",
        op: "cancel_all",
        args: {},
      } as Action,
      adapterContext
    );

    const heartbeat = await adapter.executeAction(
      {
        type: "custom",
        venue: "polymarket",
        op: "heartbeat",
        args: { heartbeat_id: "hb-previous" },
      } as Action,
      adapterContext
    );

    expect(cancelOne.reference).toBe("ord-cancel-1");
    expect(cancelMany.reference).toBe("ord-cancel-2,ord-cancel-3");
    expect(cancelAll.reference).toBe("req-1");
    expect(heartbeat.reference).toBe("hb-next");
    expect(canceledOrder).toEqual({ orderID: "ord-cancel-1" });
    expect(canceledOrders).toEqual(["ord-cancel-2", "ord-cancel-3"]);
    expect(heartbeatId).toBe("hb-previous");
  });

  test("fails for unsupported op, side, and chain", async () => {
    const adapter = createPolymarketAdapter();
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    await expect(
      adapter.buildAction(
        {
          type: "custom",
          venue: "polymarket",
          op: "unknown_op",
          args: {},
        } as Action,
        adapterContext
      )
    ).rejects.toThrow("does not support custom op");

    await expect(
      adapter.buildAction(
        {
          type: "custom",
          venue: "polymarket",
          op: "order",
          args: {
            token_id: "12345",
            price: "0.55",
            size: "10",
            side: "hold",
          },
        } as Action,
        adapterContext
      )
    ).rejects.toThrow("must be BUY or SELL");

    await expect(
      adapter.buildAction(orderAction, {
        ...adapterContext,
        chainId: 1,
      })
    ).rejects.toThrow("not configured for chain 1");
  });

  test("fails on unsupported constraints", async () => {
    const adapter = createPolymarketAdapter();
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    await expect(
      adapter.buildAction(
        {
          ...orderAction,
          constraints: {
            maxSlippageBps: 100,
          },
        },
        adapterContext
      )
    ).rejects.toThrow(
      "Adapter 'polymarket' does not support constraint 'max_slippage' for action 'custom'"
    );
  });

  test("bundled adapter can build but execute requires auth material", async () => {
    if (!polymarketAdapter.buildAction) throw new Error("Missing buildAction");
    if (!polymarketAdapter.executeAction) throw new Error("Missing executeAction");

    await expect(polymarketAdapter.buildAction(orderAction, adapterContext)).resolves.toBeTruthy();

    await expect(polymarketAdapter.executeAction(orderAction, adapterContext)).rejects.toThrow(
      "requires a private key"
    );
  });
});
