import { describe, expect, test } from "bun:test";
import type { Action, Address, Provider, VenueAdapterContext } from "@grimoirelabs/core";
import { createLifiAdapter } from "./lifi.js";

const ctx: VenueAdapterContext = {
  provider: { chainId: 1 } as unknown as Provider,
  walletAddress: "0x0000000000000000000000000000000000000001" as Address,
  chainId: 1,
};

function createLifiFetch(
  resolver: (path: string, body: Record<string, unknown>) => unknown
): typeof fetch {
  const fetchImpl = async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1]
  ) => {
    const url = typeof input === "string" ? input : input.toString();
    const path = new URL(url).pathname + new URL(url).search;
    const body =
      init?.body && typeof init.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : {};
    const result = resolver(path, body);
    return new Response(JSON.stringify(result), { status: 200 });
  };
  return fetchImpl as typeof fetch;
}

describe("LI.FI adapter", () => {
  test("builds swap route metadata", async () => {
    const adapter = createLifiAdapter({
      apiUrl: "https://li.quest/v1",
      fetch: createLifiFetch((path) => {
        if (path === "/v1/quote") {
          return {
            toAmount: "900",
            estimate: { slippage: 0.001 },
          };
        }
        return {};
      }),
    });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const built = await adapter.buildAction(
      {
        type: "swap",
        venue: "lifi",
        assetIn: "USDC",
        assetOut: "DAI",
        amount: 1000n,
        mode: "exact_in",
      } as Action,
      ctx
    );

    const tx = Array.isArray(built) ? built[0] : built;
    expect(tx?.description).toContain("LI.FI swap");
  });

  test("enforces min_output constraints", async () => {
    const adapter = createLifiAdapter({
      apiUrl: "https://li.quest/v1",
      fetch: createLifiFetch((path) => {
        if (path === "/v1/quote") {
          return {
            toAmount: "500",
            estimate: { slippage: 0.003 },
          };
        }
        return {};
      }),
    });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action = {
      type: "swap",
      venue: "lifi",
      assetIn: "USDC",
      assetOut: "DAI",
      amount: 1000n,
      mode: "exact_in",
      constraints: {
        minOutput: 700n,
      },
    } as Action;

    await expect(adapter.buildAction(action, ctx)).rejects.toThrow("below min_output");
  });

  test("executes bridge flow and polls status", async () => {
    const adapter = createLifiAdapter({
      apiUrl: "https://li.quest/v1",
      fetch: createLifiFetch((path) => {
        if (path === "/v1/routes") {
          return {
            route: { id: "route-1" },
            estimate: { toAmount: "1000" },
          };
        }
        if (path === "/v1/execute") {
          return {
            id: "tx-123",
            status: "pending",
          };
        }
        if (path.startsWith("/v1/status")) {
          return {
            status: "done",
          };
        }
        return {};
      }),
    });
    if (!adapter.executeAction) throw new Error("Missing executeAction");

    const result = await adapter.executeAction(
      {
        type: "bridge",
        venue: "lifi",
        asset: "USDC",
        amount: 1000n,
        toChain: 8453,
      } as Action,
      ctx
    );

    expect(result.id).toBe("tx-123");
    expect(result.status).toBe("pending");
  });

  test("supports custom compose_execute op", async () => {
    const adapter = createLifiAdapter({
      apiUrl: "https://li.quest/v1",
      fetch: createLifiFetch((path) => {
        if (path === "/v1/routes") {
          return { id: "route-2", estimate: { toAmount: "100" } };
        }
        if (path === "/v1/execute") {
          return { id: "tx-456", status: "submitted" };
        }
        if (path.startsWith("/v1/status")) {
          return { status: "submitted" };
        }
        return {};
      }),
    });
    if (!adapter.executeAction) throw new Error("Missing executeAction");

    const result = await adapter.executeAction(
      {
        type: "custom",
        venue: "lifi",
        op: "compose_execute",
        args: {
          routeRequest: {
            fromChainId: 1,
            toChainId: 8453,
            fromToken: "USDC",
            toToken: "USDC",
            fromAmount: "100",
          },
        },
      } as Action,
      ctx
    );

    expect(result.id).toBe("tx-456");
  });

  test("compose_execute defaults routeRequest.toAddress to walletAddress", async () => {
    let capturedRoutesBody: Record<string, unknown> | undefined;
    const adapter = createLifiAdapter({
      apiUrl: "https://li.quest/v1",
      fetch: createLifiFetch((path, body) => {
        if (path === "/v1/routes") {
          capturedRoutesBody = body;
          return { id: "route-3", estimate: { toAmount: "100" } };
        }
        return {};
      }),
    });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    await adapter.buildAction(
      {
        type: "custom",
        venue: "lifi",
        op: "compose_execute",
        args: {
          routeRequest: {
            fromChainId: 1,
            toChainId: 8453,
            fromToken: "USDC",
            toToken: "USDC",
            fromAmount: "100",
          },
        },
      } as Action,
      ctx
    );

    expect(capturedRoutesBody?.toAddress).toBe(ctx.walletAddress);
  });

  test("compose_execute rejects mismatched routeRequest.toAddress by default", async () => {
    const adapter = createLifiAdapter({
      apiUrl: "https://li.quest/v1",
      fetch: createLifiFetch((path) => {
        if (path === "/v1/routes") {
          return { id: "route-4", estimate: { toAmount: "100" } };
        }
        return {};
      }),
    });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    await expect(
      adapter.buildAction(
        {
          type: "custom",
          venue: "lifi",
          op: "compose_execute",
          args: {
            routeRequest: {
              fromChainId: 1,
              toChainId: 8453,
              fromToken: "USDC",
              toToken: "USDC",
              fromAmount: "100",
              toAddress: "0x0000000000000000000000000000000000000002",
            },
          },
        } as Action,
        ctx
      )
    ).rejects.toThrow("must match walletAddress");
  });

  test("compose_execute allows external toAddress when override flag is set", async () => {
    const externalAddress = "0x0000000000000000000000000000000000000002";
    let capturedRoutesBody: Record<string, unknown> | undefined;
    const adapter = createLifiAdapter({
      apiUrl: "https://li.quest/v1",
      fetch: createLifiFetch((path, body) => {
        if (path === "/v1/routes") {
          capturedRoutesBody = body;
          return { id: "route-5", estimate: { toAmount: "100" } };
        }
        return {};
      }),
    });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    await adapter.buildAction(
      {
        type: "custom",
        venue: "lifi",
        op: "compose_execute",
        args: {
          routeRequest: {
            fromChainId: 1,
            toChainId: 8453,
            fromToken: "USDC",
            toToken: "USDC",
            fromAmount: "100",
            toAddress: externalAddress,
            allowExternalToAddress: true,
          },
        },
      } as Action,
      ctx
    );

    expect(capturedRoutesBody?.toAddress).toBe(externalAddress);
    expect(capturedRoutesBody).not.toHaveProperty("allowExternalToAddress");
  });
});
