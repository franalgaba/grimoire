#!/usr/bin/env node

import { CompassApiSDK } from "@compass-labs/api-sdk";
import { Cli, z } from "incur";

type CompassChain = "ethereum" | "base" | "arbitrum";

const SUPPORTED_CHAINS: Record<number, string> = {
  1: "Ethereum",
  8453: "Base",
  42161: "Arbitrum",
};

const COMPASS_CHAIN_MAP: Record<number, CompassChain> = {
  1: "ethereum",
  8453: "base",
  42161: "arbitrum",
};

function getSDK(): CompassApiSDK {
  const apiKey = process.env.COMPASS_API_KEY;
  if (!apiKey) throw new Error("COMPASS_API_KEY environment variable is required");
  return new CompassApiSDK({ apiKeyAuth: apiKey });
}

function resolveChain(chainId: number): CompassChain {
  const chain = COMPASS_CHAIN_MAP[chainId];
  if (!chain) throw new Error(`Unsupported chain ${chainId}`);
  return chain;
}

function serializeBigInts(obj: unknown): unknown {
  if (typeof obj === "bigint") return obj.toString();
  if (Array.isArray(obj)) return obj.map(serializeBigInts);
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = serializeBigInts(v);
    }
    return out;
  }
  return obj;
}

const cli = Cli.create("grimoire-compass", {
  description: "Compass Labs V2 — Earn, Credit, Bridge, and Traditional Investing operations",
  sync: {
    suggestions: [
      "list Aave earn markets on Ethereum",
      "show ERC-4626 vaults on Base",
      "check earn positions for an address",
      "check credit positions for an address",
      "list Traditional Investing opportunities",
      "show TI positions for an address",
    ],
  },
})
  .use(async (c, next) => {
    const start = performance.now();
    await next();
    if (!c.agent) console.error(`Done in ${(performance.now() - start).toFixed(0)}ms`);
  })
  .command("info", {
    description: "Show adapter info and supported chains",
    run(c) {
      return c.ok(
        {
          name: "compass_v2",
          actions: [
            "lend",
            "withdraw",
            "swap",
            "transfer",
            "supply_collateral",
            "withdraw_collateral",
            "borrow",
            "repay",
            "bridge",
            "custom",
          ],
          supportedChains: SUPPORTED_CHAINS,
          products: ["earn", "credit", "bridge", "traditional_investing"],
        },
        { cta: { commands: ["aave-markets --chain 1", "vaults --chain 1"] } }
      );
    },
  })
  .command("aave-markets", {
    description: "List Aave V3 earn markets",
    options: z.object({
      chain: z.coerce.number().describe("Chain ID (1, 8453, 42161)"),
    }),
    async run(c) {
      const sdk = getSDK();
      const chain = resolveChain(c.options.chain);
      const result = await sdk.earn.earnAaveMarkets({ chain });
      return c.ok(serializeBigInts(result), {
        cta: { commands: [`vaults --chain ${c.options.chain}`] },
      });
    },
  })
  .command("vaults", {
    description: "List ERC-4626 yield vaults",
    options: z.object({
      chain: z.coerce.number().describe("Chain ID (1, 8453, 42161)"),
    }),
    async run(c) {
      const sdk = getSDK();
      const chain = resolveChain(c.options.chain);
      const result = await sdk.earn.earnVaults({ chain, orderBy: "tvl" });
      return c.ok(serializeBigInts(result));
    },
  })
  .command("positions", {
    description: "Show earn positions for an address",
    options: z.object({
      owner: z.string().describe("Wallet address (0x...)"),
      chain: z.coerce.number().describe("Chain ID"),
    }),
    async run(c) {
      const sdk = getSDK();
      const chain = resolveChain(c.options.chain);
      const result = await sdk.earn.earnPositions({
        owner: c.options.owner,
        chain,
      });
      return c.ok(serializeBigInts(result));
    },
  })
  .command("balances", {
    description: "Show earn account balances",
    options: z.object({
      owner: z.string().describe("Wallet address (0x...)"),
      chain: z.coerce.number().describe("Chain ID"),
    }),
    async run(c) {
      const sdk = getSDK();
      const chain = resolveChain(c.options.chain);
      const result = await sdk.earn.earnBalances({
        owner: c.options.owner,
        chain,
      });
      return c.ok(serializeBigInts(result));
    },
  })
  .command("credit-positions", {
    description: "Show credit positions for an address",
    options: z.object({
      owner: z.string().describe("Wallet address (0x...)"),
      chain: z.coerce.number().describe("Chain ID"),
    }),
    async run(c) {
      const sdk = getSDK();
      const chain = resolveChain(c.options.chain);
      const result = await sdk.credit.creditPositions({
        owner: c.options.owner,
        chain,
      });
      return c.ok(serializeBigInts(result));
    },
  })
  .command("ti-opportunities", {
    description: "List available Traditional Investing assets (perpetual futures)",
    options: z.object({
      chain: z.coerce.number().describe("Chain ID"),
    }),
    async run(c) {
      const sdk = getSDK();
      const chain = resolveChain(c.options.chain);
      const ti = (sdk as unknown as Record<string, unknown>).traditionalInvesting as
        | Record<string, (...args: unknown[]) => Promise<unknown>>
        | undefined;
      if (!ti) throw new Error("Traditional Investing is not available in this SDK version");
      const result = await ti.traditionalInvestingOpportunities({ chain });
      return c.ok(serializeBigInts(result));
    },
  })
  .command("ti-positions", {
    description: "Show Traditional Investing positions",
    options: z.object({
      owner: z.string().describe("Wallet address (0x...)"),
      chain: z.coerce.number().describe("Chain ID"),
    }),
    async run(c) {
      const sdk = getSDK();
      const chain = resolveChain(c.options.chain);
      const ti = (sdk as unknown as Record<string, unknown>).traditionalInvesting as
        | Record<string, (...args: unknown[]) => Promise<unknown>>
        | undefined;
      if (!ti) throw new Error("Traditional Investing is not available in this SDK version");
      const result = await ti.traditionalInvestingPositions({
        owner: c.options.owner,
        chain,
      });
      return c.ok(serializeBigInts(result));
    },
  });

cli.serve();
