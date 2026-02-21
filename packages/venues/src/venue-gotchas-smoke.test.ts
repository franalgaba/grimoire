import { describe, expect, test } from "bun:test";
import type { Action, Address, Provider, SpellIR, VenueAdapterContext } from "@grimoirelabs/core";
import { validateIR } from "@grimoirelabs/core";
import { createMorphoBlueAdapter } from "./morpho-blue.js";
import { createPendleAdapter } from "./pendle.js";

function createProvider(
  readContract: (params: { functionName: string }) => Promise<unknown>
): Provider {
  return {
    chainId: 1,
    getClient: () => ({
      readContract,
    }),
  } as unknown as Provider;
}

const MORPHO_MARKET = {
  id: "smoke-market",
  loanToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
  collateralToken: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address,
  oracle: "0x0000000000000000000000000000000000000007" as Address,
  irm: "0x0000000000000000000000000000000000000008" as Address,
  lltv: 860000000000000000n,
};

const PENDLE_TOKEN_MAP: Record<number, Record<string, Address>> = {
  1: {
    USDC: "0x0000000000000000000000000000000000000001" as Address,
    PT: "0x0000000000000000000000000000000000000002" as Address,
  },
};

describe("Venue gotchas smoke suite", () => {
  test("Morpho borrow without collateral fails preflight with actionable guidance", async () => {
    const adapter = createMorphoBlueAdapter({ markets: [MORPHO_MARKET] });
    if (!adapter.buildAction) throw new Error("Missing buildAction");

    const action: Action = {
      type: "borrow",
      venue: "morpho_blue",
      asset: "USDC",
      amount: 1n,
    };

    const ctx: VenueAdapterContext = {
      provider: createProvider(async ({ functionName }) => {
        if (functionName === "position") return [0n, 0n, 0n];
        if (functionName === "market") return [1000n, 0n, 10n, 10n, 0n, 0n];
        return 0n;
      }),
      walletAddress: "0x00000000000000000000000000000000000000f1" as Address,
      chainId: 1,
      mode: "simulate",
    };

    await expect(adapter.buildAction(action, ctx)).rejects.toThrow("supply_collateral");
  });

  test("Quoted address literals surface QUOTED_ADDRESS_LITERAL diagnostics", () => {
    const ir: SpellIR = {
      id: "quoted-address-smoke",
      version: "1.0.0",
      meta: {
        name: "quoted-address-smoke",
        created: Date.now(),
        hash: "hash",
      },
      aliases: [
        {
          alias: "uniswap_v3",
          chain: 1,
          address: "0x0000000000000000000000000000000000000001",
        },
      ],
      assets: [],
      skills: [],
      advisors: [],
      params: [],
      state: { persistent: {}, ephemeral: {} },
      steps: [
        {
          kind: "action",
          id: "quoted_step",
          action: {
            type: "swap",
            venue: "uniswap_v3",
            assetIn: '"0x00000000000000000000000000000000000000aa"',
            assetOut: "0x00000000000000000000000000000000000000bb",
            amount: { kind: "literal", type: "int", value: 1 },
            mode: "exact_in",
          },
          constraints: {},
          onFailure: "revert",
          dependsOn: [],
        },
      ],
      guards: [],
      triggers: [{ type: "manual" }],
    };

    const result = validateIR(ir);
    expect(result.errors.some((error) => error.code === "QUOTED_ADDRESS_LITERAL")).toBe(true);
  });

  test("Pendle max_slippage conversion sends canonical decimal", async () => {
    let requestBody: unknown;
    const adapter = createPendleAdapter({
      fetchFn: async (_input, init) => {
        requestBody = init?.body ? JSON.parse(String(init.body)) : undefined;
        return new Response(
          JSON.stringify({
            action: "swap",
            inputs: [{ token: PENDLE_TOKEN_MAP[1].USDC, amount: "100" }],
            requiredApprovals: [{ token: PENDLE_TOKEN_MAP[1].USDC, amount: "100" }],
            routes: [
              {
                tx: {
                  to: "0x00000000000000000000000000000000000000aa",
                  data: "0x1234",
                  value: "0",
                },
                outputs: [{ token: PENDLE_TOKEN_MAP[1].PT, amount: "90" }],
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      },
      tokenMap: PENDLE_TOKEN_MAP,
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
        constraints: {
          maxSlippageBps: 50,
        },
      } as Action,
      {
        provider: createProvider(async ({ functionName }) => {
          if (functionName === "allowance") return 0n;
          return 0n;
        }),
        walletAddress: "0x00000000000000000000000000000000000000f2" as Address,
        chainId: 1,
      }
    );

    const request = requestBody as { slippage: number };
    expect(request.slippage).toBe(0.005);
  });
});
