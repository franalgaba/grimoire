import { describe, expect, test } from "bun:test";
import type { Action, Address, Provider, SpellIR, VenueAdapterContext } from "@grimoirelabs/core";
import { compile, preview } from "@grimoirelabs/core";
import { decodeFunctionData, parseAbi } from "viem";
import { createPendleAdapter } from "./pendle/index.js";

const ADDRS = {
  router: "0x00000000000000000000000000000000000000aa" as Address,
  usdc: "0x0000000000000000000000000000000000000001" as Address,
  dai: "0x0000000000000000000000000000000000000002" as Address,
  pt: "0x0000000000000000000000000000000000000003" as Address,
  yt: "0x0000000000000000000000000000000000000004" as Address,
  lp: "0x0000000000000000000000000000000000000005" as Address,
  sy: "0x0000000000000000000000000000000000000006" as Address,
};

const tokenMap: Record<number, Record<string, Address>> = {
  1: {
    USDC: ADDRS.usdc,
    DAI: ADDRS.dai,
    PT: ADDRS.pt,
    YT: ADDRS.yt,
    LP: ADDRS.lp,
    SY: ADDRS.sy,
    PT2: "0x0000000000000000000000000000000000000007" as Address,
  },
};

const ERC20_APPROVE_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
]);

function createCtx(
  provider?: Partial<Provider>,
  chainId = 1,
  onWarning?: (message: string) => void,
  overrides?: Partial<VenueAdapterContext>
): VenueAdapterContext {
  const walletAddress = (overrides?.walletAddress ??
    "0x00000000000000000000000000000000000000ff") as Address;
  return {
    ...overrides,
    provider: {
      chainId,
      getClient: () => ({
        readContract: async () => 0n,
      }),
      ...provider,
    } as unknown as Provider,
    walletAddress,
    chainId,
    onWarning,
  };
}

function createConvertResponse(outputAmount = "90", options?: { includeTxValue?: boolean }) {
  const tx: { to: Address; data: string; value?: string } = {
    to: ADDRS.router,
    data: "0x1234",
  };
  if (options?.includeTxValue !== false) {
    tx.value = "0";
  }

  return {
    action: "swap",
    inputs: [{ token: ADDRS.usdc, amount: "100" }],
    requiredApprovals: [{ token: ADDRS.usdc, amount: "100" }],
    routes: [
      {
        contractParamInfo: { method: "convert" },
        tx,
        outputs: [{ token: ADDRS.pt, amount: outputAmount }],
        data: {
          aggregatorType: "none",
          priceImpact: 0.01,
          fee: { usd: 0.1 },
        },
      },
    ],
  };
}

function assertCompileSuccess(
  result: ReturnType<typeof compile>
): asserts result is { success: true; ir: SpellIR; errors: never[]; warnings: never[] } {
  if (!result.success || !result.ir) {
    throw new Error(
      `Expected compile success, got: ${result.errors.map((e) => e.message).join("; ")}`
    );
  }
}

describe("Pendle adapter", () => {
  test("reads quote_out metric for asset pair selector", async () => {
    const adapter = createPendleAdapter({
      fetchFn: async () =>
        new Response(JSON.stringify(createConvertResponse("90")), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      tokenMap,
      supportedChains: [1],
      enableV2Fallback: false,
    });
    if (!adapter.readMetric) throw new Error("Missing readMetric");

    const quoteOut = await adapter.readMetric(
      {
        surface: "quote_out",
        venue: "pendle",
        asset: "USDC",
        selector: "asset_out=PT,amount=100",
      },
      createCtx()
    );

    expect(Number.isFinite(quoteOut)).toBe(true);
    expect(quoteOut).toBeGreaterThan(0);
  });

  test("builds approval + convert tx from API response", async () => {
    let requestBody: unknown;
    const fetchMock = async (_input: string | URL | Request, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      return new Response(JSON.stringify(createConvertResponse()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const adapter = createPendleAdapter({
      fetchFn: fetchMock,
      tokenMap,
      supportedChains: [1],
      enableV2Fallback: false,
    });

    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action: Action = {
      type: "swap",
      venue: "pendle",
      assetIn: "USDC",
      assetOut: "PT",
      amount: 100n,
      mode: "exact_in",
    };
    const builtResult = await adapter.buildAction(action, createCtx());
    const built = Array.isArray(builtResult) ? builtResult : [builtResult];

    expect(built).toHaveLength(2);
    expect(built[0]?.description).toContain("Approve");
    expect(built[1]?.description).toContain("Pendle swap convert");
    expect(built[1]?.metadata?.quote?.expectedOut).toBe(90n);
    expect(built[1]?.metadata?.route?.aggregatorType).toBe("none");

    const request = requestBody as {
      inputs: Array<{ token: string; amount: string }>;
      outputs: string[];
      enableAggregator: boolean;
    };
    expect(request.enableAggregator).toBe(true);
    expect(request.inputs[0]?.token).toBe(ADDRS.usdc);
    expect(request.outputs[0]).toBe(ADDRS.pt);
  });

  test("uses action max_slippage over adapter config for convert request", async () => {
    let requestBody: unknown;
    const adapter = createPendleAdapter({
      fetchFn: async (_input, init) => {
        requestBody = init?.body ? JSON.parse(String(init.body)) : undefined;
        return new Response(JSON.stringify(createConvertResponse()), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      tokenMap,
      supportedChains: [1],
      slippageBps: 25,
      enableV2Fallback: false,
    });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    await adapter.buildAction(
      {
        type: "swap",
        venue: "pendle",
        assetIn: "USDC",
        assetOut: "PT",
        amount: 100n,
        mode: "exact_in",
        constraints: {
          maxSlippageBps: 123,
        },
      } as Action,
      createCtx()
    );

    const request = requestBody as { slippage: number };
    expect(request.slippage).toBe(0.0123);
  });

  test("propagates DSL max_slippage through runtime constraint resolution to Pendle request", async () => {
    let requestBody: unknown;
    const adapter = createPendleAdapter({
      fetchFn: async (_input, init) => {
        requestBody = init?.body ? JSON.parse(String(init.body)) : undefined;
        return new Response(JSON.stringify(createConvertResponse()), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      tokenMap,
      supportedChains: [1],
      enableV2Fallback: false,
    });

    const source = `spell PendleSlippage {
  version: "1.0.0"
  assets: [USDC, PT]
  venues: {
    pendle: @pendle
  }
  params: {
    amount: 100
  }
  on manual: {
    pendle.swap(USDC, PT, params.amount) with max_slippage=123
  }
}`;

    const compiled = compile(source);
    assertCompileSuccess(compiled);

    const previewResult = await preview({
      spell: compiled.ir,
      vault: "0x00000000000000000000000000000000000000ff" as Address,
      chain: 1,
      adapters: [adapter],
      provider: createCtx().provider,
    });

    expect(previewResult.success).toBe(true);
    const request = requestBody as { slippage: number };
    expect(request.slippage).toBe(0.0123);
  });

  test("uses adapter slippage config when action max_slippage is absent", async () => {
    let requestBody: unknown;
    const adapter = createPendleAdapter({
      fetchFn: async (_input, init) => {
        requestBody = init?.body ? JSON.parse(String(init.body)) : undefined;
        return new Response(JSON.stringify(createConvertResponse()), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      tokenMap,
      supportedChains: [1],
      slippageBps: 77,
      enableV2Fallback: false,
    });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    await adapter.buildAction(
      {
        type: "swap",
        venue: "pendle",
        assetIn: "USDC",
        assetOut: "PT",
        amount: 100n,
        mode: "exact_in",
      } as Action,
      createCtx()
    );

    const request = requestBody as { slippage: number };
    expect(request.slippage).toBe(0.0077);
  });

  test("uses default slippage when action and adapter slippage are absent", async () => {
    let requestBody: unknown;
    const adapter = createPendleAdapter({
      fetchFn: async (_input, init) => {
        requestBody = init?.body ? JSON.parse(String(init.body)) : undefined;
        return new Response(JSON.stringify(createConvertResponse()), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      tokenMap,
      supportedChains: [1],
      enableV2Fallback: false,
    });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    await adapter.buildAction(
      {
        type: "swap",
        venue: "pendle",
        assetIn: "USDC",
        assetOut: "PT",
        amount: 100n,
        mode: "exact_in",
      } as Action,
      createCtx()
    );

    const request = requestBody as { slippage: number };
    expect(request.slippage).toBe(0.005);
  });

  test("rejects negative max_slippage bps", async () => {
    let called = false;
    const adapter = createPendleAdapter({
      fetchFn: async () => {
        called = true;
        return new Response(JSON.stringify(createConvertResponse()), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      tokenMap,
      supportedChains: [1],
      enableV2Fallback: false,
    });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    await expect(
      adapter.buildAction(
        {
          type: "swap",
          venue: "pendle",
          assetIn: "USDC",
          assetOut: "PT",
          amount: 100n,
          mode: "exact_in",
          constraints: {
            maxSlippageBps: -1,
          },
        } as Action,
        createCtx()
      )
    ).rejects.toThrow("within [0, 10000]");
    expect(called).toBe(false);
  });

  test("rejects fractional max_slippage bps", async () => {
    const adapter = createPendleAdapter({
      fetchFn: async () =>
        new Response(JSON.stringify(createConvertResponse()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      tokenMap,
      supportedChains: [1],
      enableV2Fallback: false,
    });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    await expect(
      adapter.buildAction(
        {
          type: "swap",
          venue: "pendle",
          assetIn: "USDC",
          assetOut: "PT",
          amount: 100n,
          mode: "exact_in",
          constraints: {
            maxSlippageBps: 12.5,
          },
        } as Action,
        createCtx()
      )
    ).rejects.toThrow("integer");
  });

  test("rejects NaN max_slippage bps", async () => {
    const adapter = createPendleAdapter({
      fetchFn: async () =>
        new Response(JSON.stringify(createConvertResponse()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      tokenMap,
      supportedChains: [1],
      enableV2Fallback: false,
    });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    await expect(
      adapter.buildAction(
        {
          type: "swap",
          venue: "pendle",
          assetIn: "USDC",
          assetOut: "PT",
          amount: 100n,
          mode: "exact_in",
          constraints: {
            maxSlippageBps: Number.NaN,
          },
        } as Action,
        createCtx()
      )
    ).rejects.toThrow("finite integer");
  });

  test("rejects out-of-range max_slippage bps", async () => {
    const adapter = createPendleAdapter({
      fetchFn: async () =>
        new Response(JSON.stringify(createConvertResponse()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      tokenMap,
      supportedChains: [1],
      enableV2Fallback: false,
    });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    await expect(
      adapter.buildAction(
        {
          type: "swap",
          venue: "pendle",
          assetIn: "USDC",
          assetOut: "PT",
          amount: 100n,
          mode: "exact_in",
          constraints: {
            maxSlippageBps: 10001,
          },
        } as Action,
        createCtx()
      )
    ).rejects.toThrow("within [0, 10000]");
  });

  test("uses vault as default receiver when no explicit receiver is provided", async () => {
    let requestBody: unknown;
    const vault = "0x00000000000000000000000000000000000000f1" as Address;
    const adapter = createPendleAdapter({
      fetchFn: async (_input, init) => {
        requestBody = init?.body ? JSON.parse(String(init.body)) : undefined;
        return new Response(JSON.stringify(createConvertResponse()), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      tokenMap,
      supportedChains: [1],
      enableV2Fallback: false,
    });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    await adapter.buildAction(
      {
        type: "swap",
        venue: "pendle",
        assetIn: "USDC",
        assetOut: "PT",
        amount: 100n,
        mode: "exact_in",
      } as Action,
      createCtx(undefined, 1, undefined, { vault })
    );

    const request = requestBody as { receiver: string };
    expect(request.receiver).toBe(vault);
  });

  test("uses explicit action receiver over vault default", async () => {
    let requestBody: unknown;
    const vault = "0x00000000000000000000000000000000000000f1" as Address;
    const receiver = "0x00000000000000000000000000000000000000f2";
    const adapter = createPendleAdapter({
      fetchFn: async (_input, init) => {
        requestBody = init?.body ? JSON.parse(String(init.body)) : undefined;
        return new Response(JSON.stringify(createConvertResponse()), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      tokenMap,
      supportedChains: [1],
      enableV2Fallback: false,
    });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    await adapter.buildAction(
      {
        type: "swap",
        venue: "pendle",
        assetIn: "USDC",
        assetOut: "PT",
        amount: 100n,
        mode: "exact_in",
        receiver,
      } as Action,
      createCtx(undefined, 1, undefined, { vault })
    );

    const request = requestBody as { receiver: string };
    expect(request.receiver).toBe(receiver);
  });

  test("accepts routes that omit tx.value and defaults value to zero", async () => {
    const adapter = createPendleAdapter({
      fetchFn: async () =>
        new Response(JSON.stringify(createConvertResponse("90", { includeTxValue: false })), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      tokenMap,
      supportedChains: [1],
      enableV2Fallback: false,
    });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action: Action = {
      type: "swap",
      venue: "pendle",
      assetIn: "USDC",
      assetOut: "PT",
      amount: 100n,
      mode: "exact_in",
    };

    const builtResult = await adapter.buildAction(action, createCtx());
    const built = Array.isArray(builtResult) ? builtResult : [builtResult];
    const mainTx = built[built.length - 1];
    if (!mainTx) throw new Error("Missing main Pendle tx");

    expect(mainTx.tx.value).toBe(0n);
  });

  test("deduplicates required approvals per token using max amount", async () => {
    const spenderA = "0x00000000000000000000000000000000000000b1" as Address;
    const spenderB = "0x00000000000000000000000000000000000000b2" as Address;
    const adapter = createPendleAdapter({
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            ...createConvertResponse(),
            requiredApprovals: [
              { token: ADDRS.usdc, amount: "100", spender: spenderA },
              { token: ADDRS.usdc, amount: "250", spender: spenderB },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        ),
      tokenMap,
      supportedChains: [1],
      enableV2Fallback: false,
    });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const builtResult = await adapter.buildAction(
      {
        type: "swap",
        venue: "pendle",
        assetIn: "USDC",
        assetOut: "PT",
        amount: 100n,
        mode: "exact_in",
      } as Action,
      createCtx()
    );
    const built = Array.isArray(builtResult) ? builtResult : [builtResult];
    const approvals = built.filter((tx) => tx.description.includes("Approve"));

    expect(approvals).toHaveLength(1);
    const approvalTx = approvals[0];
    if (!approvalTx) throw new Error("Missing approval tx");
    if (!approvalTx.tx.data) throw new Error("Missing approval tx data");

    const decoded = decodeFunctionData({
      abi: ERC20_APPROVE_ABI,
      data: approvalTx.tx.data as `0x${string}`,
    });
    expect(decoded.functionName).toBe("approve");
    expect(decoded.args?.[0]).toBe(spenderB);
    expect(decoded.args?.[1]).toBe(250n);
  });

  test("skips approval tx when allowance is sufficient", async () => {
    const adapter = createPendleAdapter({
      fetchFn: async () =>
        new Response(JSON.stringify(createConvertResponse()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      tokenMap,
      supportedChains: [1],
      enableV2Fallback: false,
    });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const builtResult = await adapter.buildAction(
      {
        type: "swap",
        venue: "pendle",
        assetIn: "USDC",
        assetOut: "PT",
        amount: 100n,
        mode: "exact_in",
      } as Action,
      createCtx({
        getClient: () => ({
          readContract: async () => 1_000n,
        }),
      } as unknown as Partial<Provider>)
    );
    const built = Array.isArray(builtResult) ? builtResult : [builtResult];

    expect(built).toHaveLength(1);
    expect(built[0]?.description).toContain("Pendle swap convert");
  });

  test("falls back to route spender when approval spender is invalid", async () => {
    const adapter = createPendleAdapter({
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            ...createConvertResponse(),
            requiredApprovals: [{ token: ADDRS.usdc, amount: "100", spender: "not-an-address" }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        ),
      tokenMap,
      supportedChains: [1],
      enableV2Fallback: false,
    });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const builtResult = await adapter.buildAction(
      {
        type: "swap",
        venue: "pendle",
        assetIn: "USDC",
        assetOut: "PT",
        amount: 100n,
        mode: "exact_in",
      } as Action,
      createCtx()
    );
    const built = Array.isArray(builtResult) ? builtResult : [builtResult];
    const approval = built.find((tx) => tx.description.includes("Approve"));
    if (!approval?.tx.data) throw new Error("Missing approval tx data");

    const decoded = decodeFunctionData({
      abi: ERC20_APPROVE_ABI,
      data: approval.tx.data as `0x${string}`,
    });
    expect(decoded.functionName).toBe("approve");
    expect(String(decoded.args?.[0]).toLowerCase()).toBe(ADDRS.router.toLowerCase());
    expect(decoded.args?.[1]).toBe(100n);
  });

  test("rejects unconfigured chain", async () => {
    const adapter = createPendleAdapter({
      fetchFn: async () =>
        new Response(JSON.stringify(createConvertResponse()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      tokenMap,
      supportedChains: [1],
      enableV2Fallback: false,
    });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action: Action = {
      type: "swap",
      venue: "pendle",
      assetIn: "USDC",
      assetOut: "PT",
      amount: 100n,
      mode: "exact_in",
    };

    await expect(adapter.buildAction(action, createCtx(undefined, 10))).rejects.toThrow(
      "Pendle adapter is not configured for chain 10"
    );
  });

  test("rejects non-JSON convert API response", async () => {
    const adapter = createPendleAdapter({
      fetchFn: async () =>
        new Response("not-json", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      tokenMap,
      supportedChains: [1],
      enableV2Fallback: false,
    });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    await expect(
      adapter.buildAction(
        {
          type: "swap",
          venue: "pendle",
          assetIn: "USDC",
          assetOut: "PT",
          amount: 100n,
          mode: "exact_in",
        } as Action,
        createCtx()
      )
    ).rejects.toThrow("returned non-JSON response");
  });

  test("rejects route without usable tx payload", async () => {
    const adapter = createPendleAdapter({
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            ...createConvertResponse(),
            routes: [
              {
                ...createConvertResponse().routes[0],
                tx: {
                  to: ADDRS.router,
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        ),
      tokenMap,
      supportedChains: [1],
      enableV2Fallback: false,
    });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    await expect(
      adapter.buildAction(
        {
          type: "swap",
          venue: "pendle",
          assetIn: "USDC",
          assetOut: "PT",
          amount: 100n,
          mode: "exact_in",
        } as Action,
        createCtx()
      )
    ).rejects.toThrow("did not return a usable tx route");
  });

  test("falls back to v2 when v3 returns no routes", async () => {
    const requests: string[] = [];
    const adapter = createPendleAdapter({
      fetchFn: async (input, init) => {
        const url = String(input);
        requests.push(`${String(init?.method ?? "GET").toUpperCase()} ${url}`);
        if (url.includes("/v3/sdk/1/convert")) {
          return new Response(
            JSON.stringify({
              ...createConvertResponse(),
              routes: [],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          );
        }
        if (url.includes("/v2/sdk/1/convert")) {
          return new Response(JSON.stringify(createConvertResponse()), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
      tokenMap,
      supportedChains: [1],
      enableV2Fallback: true,
    });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const builtResult = await adapter.buildAction(
      {
        type: "swap",
        venue: "pendle",
        assetIn: "USDC",
        assetOut: "PT",
        amount: 100n,
        mode: "exact_in",
      } as Action,
      createCtx()
    );
    const built = Array.isArray(builtResult) ? builtResult : [builtResult];
    const mainTx = built[built.length - 1];
    if (!mainTx) throw new Error("Missing main Pendle tx");

    expect(requests.some((entry) => entry.includes("/v3/sdk/1/convert"))).toBe(true);
    expect(requests.some((entry) => entry.includes("/v2/sdk/1/convert"))).toBe(true);
    expect(mainTx.metadata?.warnings).toContain("Pendle v3 convert returned no routes.");
    expect(mainTx.metadata?.warnings).toContain(
      "Used /v2/sdk/{chainId}/convert fallback after v3 convert response issue."
    );
  });

  test("falls back to v2 when v3 request fails", async () => {
    const adapter = createPendleAdapter({
      fetchFn: async (input) => {
        const url = String(input);
        if (url.includes("/v3/sdk/1/convert")) {
          return new Response(
            JSON.stringify({
              message: "v3 unavailable",
            }),
            {
              status: 502,
              headers: { "content-type": "application/json" },
            }
          );
        }
        if (url.includes("/v2/sdk/1/convert")) {
          return new Response(JSON.stringify(createConvertResponse()), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
      tokenMap,
      supportedChains: [1],
      enableV2Fallback: true,
    });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const builtResult = await adapter.buildAction(
      {
        type: "swap",
        venue: "pendle",
        assetIn: "USDC",
        assetOut: "PT",
        amount: 100n,
        mode: "exact_in",
      } as Action,
      createCtx()
    );
    const built = Array.isArray(builtResult) ? builtResult : [builtResult];
    const mainTx = built[built.length - 1];
    if (!mainTx) throw new Error("Missing main Pendle tx");

    expect(
      mainTx.metadata?.warnings?.some((warning) => warning.includes("Pendle v3 convert failed"))
    ).toBe(true);
    expect(mainTx.metadata?.warnings).toContain(
      "Used /v2/sdk/{chainId}/convert fallback after v3 convert response issue."
    );
  });

  test("surfaces v2 fallback error when both v3 and v2 requests fail", async () => {
    const adapter = createPendleAdapter({
      fetchFn: async (input) => {
        const url = String(input);
        if (url.includes("/v3/sdk/1/convert")) {
          return new Response(
            JSON.stringify({
              message: "v3 unavailable",
            }),
            {
              status: 502,
              headers: { "content-type": "application/json" },
            }
          );
        }
        if (url.includes("/v2/sdk/1/convert")) {
          return new Response(
            JSON.stringify({
              message: "v2 unavailable",
            }),
            {
              status: 500,
              headers: { "content-type": "application/json" },
            }
          );
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
      tokenMap,
      supportedChains: [1],
      enableV2Fallback: true,
    });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    await expect(
      adapter.buildAction(
        {
          type: "swap",
          venue: "pendle",
          assetIn: "USDC",
          assetOut: "PT",
          amount: 100n,
          mode: "exact_in",
        } as Action,
        createCtx()
      )
    ).rejects.toThrow("Pendle API /v2/sdk/1/convert failed (500): v2 unavailable");
  });

  test("surfaces v3 error when fallback is disabled", async () => {
    const adapter = createPendleAdapter({
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            message: "v3 unavailable",
          }),
          {
            status: 502,
            headers: { "content-type": "application/json" },
          }
        ),
      tokenMap,
      supportedChains: [1],
      enableV2Fallback: false,
    });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    await expect(
      adapter.buildAction(
        {
          type: "swap",
          venue: "pendle",
          assetIn: "USDC",
          assetOut: "PT",
          amount: 100n,
          mode: "exact_in",
        } as Action,
        createCtx()
      )
    ).rejects.toThrow("Pendle API /v3/sdk/1/convert failed (502): v3 unavailable");
  });

  test("emits explicit no-route warning/error when aggregator is disabled", async () => {
    const warnings: string[] = [];
    const adapter = createPendleAdapter({
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            ...createConvertResponse(),
            routes: [],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        ),
      tokenMap,
      supportedChains: [1],
      enableV2Fallback: false,
    });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    await expect(
      adapter.buildAction(
        {
          type: "swap",
          venue: "pendle",
          assetIn: "USDC",
          assetOut: "PT",
          amount: 100n,
          mode: "exact_in",
          enable_aggregator: false,
        } as Action,
        createCtx(undefined, 1, (warning) => warnings.push(warning))
      )
    ).rejects.toThrow(
      "No Pendle route without aggregator; set enable_aggregator=true or change inputs."
    );

    expect(warnings).toContain(
      "No Pendle route without aggregator; set enable_aggregator=true or change inputs."
    );
  });

  test("emits generic no-route warning/error when aggregator is enabled", async () => {
    const warnings: string[] = [];
    const adapter = createPendleAdapter({
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            ...createConvertResponse(),
            routes: [],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        ),
      tokenMap,
      supportedChains: [1],
      enableV2Fallback: false,
    });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    await expect(
      adapter.buildAction(
        {
          type: "custom",
          venue: "pendle",
          op: "convert",
          args: {
            tokens_in: "USDC",
            amounts_in: "100",
            tokens_out: "PT",
            enable_aggregator: true,
          },
        } as Action,
        createCtx(undefined, 1, (warning) => warnings.push(warning))
      )
    ).rejects.toThrow("No Pendle route found for requested inputs/outputs.");

    expect(warnings).toContain("No Pendle route found for requested inputs/outputs.");
  });

  test("rejects unsupported constraints", async () => {
    const adapter = createPendleAdapter({
      fetchFn: async () =>
        new Response(JSON.stringify(createConvertResponse()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      tokenMap,
      supportedChains: [1],
      enableV2Fallback: false,
    });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    await expect(
      adapter.buildAction(
        {
          type: "swap",
          venue: "pendle",
          assetIn: "USDC",
          assetOut: "PT",
          amount: 100n,
          mode: "exact_in",
          constraints: {
            maxInput: 120n,
          },
        } as Action,
        createCtx()
      )
    ).rejects.toThrow("Adapter 'pendle' does not support constraint 'max_input' for action 'swap'");
  });

  test("enforces min_output from selected route", async () => {
    const adapter = createPendleAdapter({
      fetchFn: async () =>
        new Response(JSON.stringify(createConvertResponse("90")), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      tokenMap,
      supportedChains: [1],
      enableV2Fallback: false,
    });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    await expect(
      adapter.buildAction(
        {
          type: "swap",
          venue: "pendle",
          assetIn: "USDC",
          assetOut: "PT",
          amount: 100n,
          mode: "exact_in",
          constraints: {
            minOutput: 95n,
          },
        } as Action,
        createCtx()
      )
    ).rejects.toThrow("below min_output");
  });

  test("fails min_output check when route output amount is missing", async () => {
    const adapter = createPendleAdapter({
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            ...createConvertResponse(),
            routes: [
              {
                ...createConvertResponse().routes[0],
                outputs: [{ token: ADDRS.pt }],
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        ),
      tokenMap,
      supportedChains: [1],
      enableV2Fallback: false,
    });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    await expect(
      adapter.buildAction(
        {
          type: "swap",
          venue: "pendle",
          assetIn: "USDC",
          assetOut: "PT",
          amount: 100n,
          mode: "exact_in",
          constraints: {
            minOutput: 1n,
          },
        } as Action,
        createCtx()
      )
    ).rejects.toThrow("did not return output amount required for min_output check");
  });

  test("fails closed for max_gas when estimate is unavailable", async () => {
    const adapter = createPendleAdapter({
      fetchFn: async () =>
        new Response(JSON.stringify(createConvertResponse()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      tokenMap,
      supportedChains: [1],
      enableV2Fallback: false,
    });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    await expect(
      adapter.buildAction(
        {
          type: "swap",
          venue: "pendle",
          assetIn: "USDC",
          assetOut: "PT",
          amount: 100n,
          mode: "exact_in",
          constraints: {
            maxGas: 100_000n,
          },
        } as Action,
        createCtx()
      )
    ).rejects.toThrow("could not estimate gas while max_gas is enabled");
  });

  test("passes when max_gas is enabled and estimate is within limit", async () => {
    const adapter = createPendleAdapter({
      fetchFn: async () =>
        new Response(JSON.stringify(createConvertResponse()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      tokenMap,
      supportedChains: [1],
      enableV2Fallback: false,
    });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const builtResult = await adapter.buildAction(
      {
        type: "swap",
        venue: "pendle",
        assetIn: "USDC",
        assetOut: "PT",
        amount: 100n,
        mode: "exact_in",
        constraints: {
          maxGas: 150_000n,
        },
      } as Action,
      createCtx({
        getGasEstimate: async () => ({
          gasLimit: 120_000n,
          maxFeePerGas: 1n,
          maxPriorityFeePerGas: 1n,
          estimatedCost: 120_000n,
        }),
      })
    );

    const built = Array.isArray(builtResult) ? builtResult : [builtResult];
    const mainTx = built[built.length - 1];
    if (!mainTx) throw new Error("Missing main Pendle tx");
    expect(mainTx.gasEstimate?.gasLimit).toBe(120_000n);
    expect(mainTx.metadata?.route?.gasEstimate).toBe(120_000n);
  });

  test("fails when max_gas is enabled and estimate exceeds limit", async () => {
    const adapter = createPendleAdapter({
      fetchFn: async () =>
        new Response(JSON.stringify(createConvertResponse()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      tokenMap,
      supportedChains: [1],
      enableV2Fallback: false,
    });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    await expect(
      adapter.buildAction(
        {
          type: "swap",
          venue: "pendle",
          assetIn: "USDC",
          assetOut: "PT",
          amount: 100n,
          mode: "exact_in",
          constraints: {
            maxGas: 100_000n,
          },
        } as Action,
        createCtx({
          getGasEstimate: async () => ({
            gasLimit: 120_000n,
            maxFeePerGas: 1n,
            maxPriorityFeePerGas: 1n,
            estimatedCost: 120_000n,
          }),
        })
      )
    ).rejects.toThrow("exceeds max_gas");
  });

  test("rejects swap exact_out", async () => {
    const adapter = createPendleAdapter({
      fetchFn: async () =>
        new Response(JSON.stringify(createConvertResponse()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      tokenMap,
      supportedChains: [1],
      enableV2Fallback: false,
    });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    await expect(
      adapter.buildAction(
        {
          type: "swap",
          venue: "pendle",
          assetIn: "USDC",
          assetOut: "PT",
          amount: 100n,
          mode: "exact_out",
        } as Action,
        createCtx()
      )
    ).rejects.toThrow("exact_out is not supported");
  });

  test("maps typed pendle actions to convert request payloads", async () => {
    const capturedBodies: unknown[] = [];
    const fetchMock = async (_input: string | URL | Request, init?: RequestInit) => {
      capturedBodies.push(init?.body ? JSON.parse(String(init.body)) : undefined);
      return new Response(JSON.stringify(createConvertResponse()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const adapter = createPendleAdapter({
      fetchFn: fetchMock,
      tokenMap,
      supportedChains: [1],
      enableV2Fallback: false,
    });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const cases: Action[] = [
      {
        type: "add_liquidity",
        venue: "pendle",
        asset: "USDC",
        amount: 100n,
        assetOut: "LP",
      },
      {
        type: "add_liquidity_dual",
        venue: "pendle",
        inputs: [
          { asset: "USDC", amount: 100n },
          { asset: "PT", amount: 10n },
        ],
        outputs: ["LP", "YT"],
      },
      {
        type: "remove_liquidity",
        venue: "pendle",
        asset: "LP",
        amount: 100n,
        assetOut: "USDC",
      },
      {
        type: "remove_liquidity_dual",
        venue: "pendle",
        inputs: [{ asset: "LP", amount: 100n }],
        outputs: ["USDC", "PT"],
      },
      {
        type: "mint_py",
        venue: "pendle",
        asset: "USDC",
        amount: 100n,
        assetOut: "PT",
      },
      {
        type: "redeem_py",
        venue: "pendle",
        asset: "PT",
        amount: 100n,
        assetOut: "USDC",
      },
      {
        type: "mint_sy",
        venue: "pendle",
        asset: "USDC",
        amount: 100n,
        assetOut: "SY",
      },
      {
        type: "redeem_sy",
        venue: "pendle",
        asset: "SY",
        amount: 100n,
        assetOut: "USDC",
      },
      {
        type: "transfer_liquidity",
        venue: "pendle",
        inputs: [{ asset: "LP", amount: 100n }],
        outputs: ["LP"],
      },
      {
        type: "roll_over_pt",
        venue: "pendle",
        asset: "PT",
        amount: 100n,
        assetOut: "PT2",
      },
      {
        type: "exit_market",
        venue: "pendle",
        inputs: [{ asset: "LP", amount: 100n }],
        outputs: ["USDC"],
      },
      {
        type: "convert_lp_to_pt",
        venue: "pendle",
        asset: "LP",
        amount: 100n,
        assetOut: "PT",
      },
      {
        type: "pendle_swap",
        venue: "pendle",
        inputs: [
          { asset: "USDC", amount: 100n },
          { asset: "DAI", amount: 25n },
        ],
        outputs: ["PT"],
      },
    ];

    for (const action of cases) {
      await adapter.buildAction(action, createCtx());
    }

    expect(capturedBodies).toHaveLength(cases.length);
    for (const body of capturedBodies) {
      const request = body as {
        inputs: Array<{ token: string; amount: string }>;
        outputs: string[];
      };
      expect(request.inputs.length).toBeGreaterThan(0);
      expect(request.outputs.length).toBeGreaterThan(0);
    }
  });

  test("validates required custom convert args", async () => {
    const adapter = createPendleAdapter({
      fetchFn: async () =>
        new Response(JSON.stringify(createConvertResponse()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      tokenMap,
      supportedChains: [1],
      enableV2Fallback: false,
    });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    await expect(
      adapter.buildAction(
        {
          type: "custom",
          venue: "pendle",
          op: "convert",
          args: {
            tokens_in: "USDC",
            tokens_out: "PT",
          },
        } as Action,
        createCtx()
      )
    ).rejects.toThrow("requires 'amounts_in'");
  });

  test("validates custom convert token/amount length mismatch", async () => {
    const adapter = createPendleAdapter({
      fetchFn: async () =>
        new Response(JSON.stringify(createConvertResponse()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      tokenMap,
      supportedChains: [1],
      enableV2Fallback: false,
    });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    await expect(
      adapter.buildAction(
        {
          type: "custom",
          venue: "pendle",
          op: "convert",
          args: {
            tokens_in: "USDC,DAI",
            amounts_in: "100",
            tokens_out: "PT",
          },
        } as Action,
        createCtx()
      )
    ).rejects.toThrow("matching lengths");
  });

  test("maps custom convert optional args into Pendle request payload", async () => {
    let requestBody: unknown;
    const adapter = createPendleAdapter({
      fetchFn: async (_input, init) => {
        requestBody = init?.body ? JSON.parse(String(init.body)) : undefined;
        return new Response(JSON.stringify(createConvertResponse()), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      tokenMap,
      supportedChains: [1],
      enableV2Fallback: false,
    });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    await adapter.buildAction(
      {
        type: "custom",
        venue: "pendle",
        op: "convert",
        args: {
          tokens_in: ["USDC", "DAI"],
          amounts_in: ["100", "200"],
          tokens_out: ["PT"],
          receiver: "0x00000000000000000000000000000000000000f0",
          enable_aggregator: "true",
          aggregators: "kyberswap, odos",
          need_scale: "false",
          redeem_rewards: true,
          additional_data: "0xabc123",
          use_limit_order: false,
        },
      } as Action,
      createCtx()
    );

    const request = requestBody as {
      receiver: string;
      enableAggregator: boolean;
      aggregators: string[];
      needScale: boolean;
      redeemRewards: boolean;
      additionalData: string;
      useLimitOrder: boolean;
      inputs: Array<{ token: string; amount: string }>;
      outputs: string[];
    };
    expect(request.receiver).toBe("0x00000000000000000000000000000000000000f0");
    expect(request.enableAggregator).toBe(true);
    expect(request.aggregators).toEqual(["kyberswap", "odos"]);
    expect(request.needScale).toBe(false);
    expect(request.redeemRewards).toBe(true);
    expect(request.additionalData).toBe("0xabc123");
    expect(request.useLimitOrder).toBe(false);
    expect(request.inputs).toEqual([
      { token: ADDRS.usdc, amount: "100" },
      { token: ADDRS.dai, amount: "200" },
    ]);
    expect(request.outputs).toEqual([ADDRS.pt]);
  });

  test("supports direct token addresses and configured symbol mappings", async () => {
    const fetchMock = async () =>
      new Response(JSON.stringify(createConvertResponse()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    const adapter = createPendleAdapter({
      fetchFn: fetchMock,
      tokenMap,
      supportedChains: [1],
      enableV2Fallback: false,
    });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const withAddress = await adapter.buildAction(
      {
        type: "swap",
        venue: "pendle",
        assetIn: ADDRS.usdc,
        assetOut: ADDRS.pt,
        amount: 100n,
        mode: "exact_in",
      } as Action,
      createCtx()
    );
    const builtAddress = Array.isArray(withAddress) ? withAddress : [withAddress];
    expect(builtAddress[builtAddress.length - 1]?.description).toContain("Pendle swap");

    const withSymbols = await adapter.buildAction(
      {
        type: "swap",
        venue: "pendle",
        assetIn: "USDC",
        assetOut: "PT",
        amount: 100n,
        mode: "exact_in",
      } as Action,
      createCtx()
    );
    const builtSymbols = Array.isArray(withSymbols) ? withSymbols : [withSymbols];
    expect(builtSymbols[builtSymbols.length - 1]?.description).toContain("Pendle swap");
  });
});
