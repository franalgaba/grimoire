import { describe, expect, test } from "bun:test";
import type { Action, Address, Provider, VenueAdapterContext } from "@grimoirelabs/core";
import { createYellowAdapter } from "./yellow.js";

const ctx: VenueAdapterContext = {
  provider: { chainId: 1 } as unknown as Provider,
  walletAddress: "0x0000000000000000000000000000000000000001" as Address,
  chainId: 1,
};

function createRpcFetch(handler: (method: string, params: unknown[]) => unknown): {
  fetch: typeof fetch;
  requests: Array<{ method: string; params: unknown[] }>;
} {
  const requests: Array<{ method: string; params: unknown[] }> = [];
  const fetchImpl = async (
    _input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1]
  ) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      method?: string;
      params?: unknown[];
      id?: number;
    };
    const method = body.method ?? "";
    const params = body.params ?? [];
    requests.push({ method, params });
    const result = handler(method, params);
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: body.id ?? 1,
        result,
      }),
      { status: 200 }
    );
  };
  return { fetch: fetchImpl as typeof fetch, requests };
}

describe("Yellow adapter", () => {
  test("builds session action descriptions", async () => {
    const adapter = createYellowAdapter();
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const built = await adapter.buildAction(
      {
        type: "custom",
        venue: "yellow",
        op: "session_open",
        args: {
          arg0: {
            session_id: "session-1",
            signers: ["sig-1"],
            quorum: 1,
          },
        },
      } as Action,
      ctx
    );

    expect(Array.isArray(built)).toBe(false);
    const tx = Array.isArray(built) ? built[0] : built;
    expect(tx?.description).toContain("session-1");
  });

  test("executes open/update/close session lifecycle", async () => {
    const rpc = createRpcFetch((method) => ({ id: `${method}-ok` }));
    const adapter = createYellowAdapter({
      rpcUrl: "https://yellow.example/rpc",
      appId: "app-1",
      fetch: rpc.fetch,
    });
    if (!adapter.executeAction) throw new Error("Missing executeAction");

    await adapter.executeAction(
      {
        type: "custom",
        venue: "yellow",
        op: "session_open",
        args: {
          arg0: {
            session_id: "session-1",
            version: 1,
            signers: ["sig-1"],
            quorum: 1,
          },
        },
      } as Action,
      ctx
    );

    await adapter.executeAction(
      {
        type: "custom",
        venue: "yellow",
        op: "session_update",
        args: {
          arg0: {
            session_id: "session-1",
            version: 2,
            intent: "operate",
            allocations: [{ account: "0xabc", amount: "10" }],
            signatures: ["sig-1"],
          },
        },
      } as Action,
      ctx
    );

    await adapter.executeAction(
      {
        type: "custom",
        venue: "yellow",
        op: "session_close_settle",
        args: { arg0: { session_id: "session-1" } },
      } as Action,
      ctx
    );

    expect(rpc.requests.map((entry) => entry.method)).toEqual([
      "create_app_session",
      "submit_app_state",
      "close_app_session",
    ]);
  });

  test("rejects invalid intent", async () => {
    const rpc = createRpcFetch((method) => ({ id: `${method}-ok` }));
    const adapter = createYellowAdapter({
      rpcUrl: "https://yellow.example/rpc",
      fetch: rpc.fetch,
    });
    if (!adapter.executeAction) throw new Error("Missing executeAction");

    await adapter.executeAction(
      {
        type: "custom",
        venue: "yellow",
        op: "session_open",
        args: { arg0: { session_id: "session-2", signers: [], quorum: 0 } },
      } as Action,
      ctx
    );

    await expect(
      adapter.executeAction(
        {
          type: "custom",
          venue: "yellow",
          op: "session_update",
          args: {
            arg0: {
              session_id: "session-2",
              version: 2,
              intent: "rebalance",
              allocations: [{ account: "0xabc", amount: "10" }],
            },
          },
        } as Action,
        ctx
      )
    ).rejects.toThrow("Yellow intent must be one of");
  });

  test("rejects version skips and quorum mismatch", async () => {
    const rpc = createRpcFetch((method) => ({ id: `${method}-ok` }));
    const adapter = createYellowAdapter({
      rpcUrl: "https://yellow.example/rpc",
      fetch: rpc.fetch,
    });
    if (!adapter.executeAction) throw new Error("Missing executeAction");

    await adapter.executeAction(
      {
        type: "custom",
        venue: "yellow",
        op: "session_open",
        args: {
          arg0: {
            session_id: "session-3",
            version: 1,
            signers: ["sig-1", "sig-2"],
            quorum: 2,
          },
        },
      } as Action,
      ctx
    );

    await expect(
      adapter.executeAction(
        {
          type: "custom",
          venue: "yellow",
          op: "session_update",
          args: {
            arg0: {
              session_id: "session-3",
              version: 3,
              intent: "operate",
              allocations: [{ account: "0xabc", amount: "10" }],
              signatures: ["sig-1", "sig-2"],
            },
          },
        } as Action,
        ctx
      )
    ).rejects.toThrow("version must increment by 1");

    await expect(
      adapter.executeAction(
        {
          type: "custom",
          venue: "yellow",
          op: "session_update",
          args: {
            arg0: {
              session_id: "session-3",
              version: 2,
              intent: "operate",
              allocations: [{ account: "0xabc", amount: "10" }],
              signatures: ["sig-1"],
            },
          },
        } as Action,
        ctx
      )
    ).rejects.toThrow("signatures do not satisfy quorum");
  });

  test("supports session_transfer helper op", async () => {
    const rpc = createRpcFetch((method, params) => ({
      id: `${method}-ok`,
      params,
    }));
    const adapter = createYellowAdapter({
      rpcUrl: "https://yellow.example/rpc",
      fetch: rpc.fetch,
    });
    if (!adapter.executeAction) throw new Error("Missing executeAction");

    await adapter.executeAction(
      {
        type: "custom",
        venue: "yellow",
        op: "session_open",
        args: { arg0: { session_id: "session-4", version: 1, signers: [], quorum: 0 } },
      } as Action,
      ctx
    );

    await adapter.executeAction(
      {
        type: "custom",
        venue: "yellow",
        op: "session_transfer",
        args: {
          arg0: {
            session_id: "session-4",
            version: 2,
            to: "0xdef",
            amount: "50",
          },
        },
      } as Action,
      ctx
    );

    const submit = rpc.requests.find((entry) => entry.method === "submit_app_state");
    expect(submit).toBeDefined();
    const payload = (submit?.params?.[0] ?? {}) as {
      allocations?: Array<{ account: string; amount: string }>;
    };
    expect(payload.allocations?.[0]).toEqual({ account: "0xdef", amount: "50" });
  });
});
