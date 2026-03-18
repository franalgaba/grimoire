#!/usr/bin/env node

import { Cli, z } from "incur";
import { createUniswapV3Adapter, defaultUniswapV3Routers } from "../adapters/uniswap-v3.js";
import {
  fetchPoolsWithFallback,
  fetchPoolsWithFallbackMeta,
  type TokenListEntry,
} from "./uniswap-pools.js";
import { buildPoolsSnapshot, buildTokensSnapshot } from "./uniswap-snapshots.js";

const DEFAULT_TOKEN_LIST_SOURCE = "https://tokens.uniswap.org" as const;

export async function fetchTokenList(source: string): Promise<TokenListEntry[]> {
  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`Token list fetch failed: ${response.status} ${response.statusText}`);
  }
  const list = (await response.json()) as { tokens?: TokenListEntry[] };
  return list.tokens ?? [];
}

const cli = Cli.create("grimoire-uniswap", {
  description: "Uniswap V3 token and pool data — routers, tokens, pools, and snapshots",
  sync: { suggestions: ["find USDC-WETH pools on Ethereum", "list tokens on Base"] },
})
  .use(async (c, next) => {
    const start = performance.now();
    await next();
    if (!c.agent) console.error(`Done in ${(performance.now() - start).toFixed(0)}ms`);
  })
  .command("info", {
    description: "Show adapter metadata",
    run(c) {
      const adapter = createUniswapV3Adapter();
      return c.ok(adapter.meta, { cta: { commands: ["routers", "tokens --chain 1"] } });
    },
  })
  .command("routers", {
    description: "Show router addresses for a chain (or all chains)",
    alias: { chain: "c" },
    options: z.object({
      chain: z.coerce.number().optional().describe("Chain ID"),
    }),
    run(c) {
      const data =
        c.options.chain !== undefined
          ? { chainId: c.options.chain, router: defaultUniswapV3Routers[c.options.chain] ?? null }
          : defaultUniswapV3Routers;
      return c.ok(data, { cta: { commands: ["tokens --chain <id>"] } });
    },
  })
  .command("tokens", {
    description: "List tokens from Uniswap token list, optionally filtered",
    alias: { chain: "c" },
    examples: [{ options: { chain: 1, symbol: "USDC" }, description: "Find USDC on Ethereum" }],
    options: z.object({
      chain: z.coerce.number().optional().describe("Chain ID"),
      symbol: z.string().optional().describe("Token symbol"),
      address: z.string().optional().describe("Token address"),
      source: z.string().default(DEFAULT_TOKEN_LIST_SOURCE).describe("Token list URL"),
    }),
    async run(c) {
      let tokens = await fetchTokenList(c.options.source);

      if (c.options.chain !== undefined) {
        tokens = tokens.filter((t) => t.chainId === c.options.chain);
      }
      if (c.options.symbol) {
        const match = c.options.symbol.toLowerCase();
        tokens = tokens.filter(
          (t) => typeof t.symbol === "string" && t.symbol.toLowerCase() === match
        );
      }
      if (c.options.address) {
        const match = c.options.address.toLowerCase();
        tokens = tokens.filter((t) => t.address?.toLowerCase() === match);
      }

      return c.ok(tokens, {
        cta: { commands: ["pools --chain <id> --token0 <sym> --token1 <sym>"] },
      });
    },
  })
  .command("tokens-snapshot", {
    description: "Generate spell params snapshot for tokens",
    alias: { chain: "c" },
    outputPolicy: "agent-only" as const,
    options: z.object({
      chain: z.coerce.number().optional().describe("Chain ID"),
      symbol: z.string().optional().describe("Token symbol"),
      address: z.string().optional().describe("Token address"),
      source: z.string().default(DEFAULT_TOKEN_LIST_SOURCE).describe("Token list URL"),
    }),
    output: z.string(),
    async run(c) {
      let tokens = await fetchTokenList(c.options.source);

      if (c.options.chain !== undefined) {
        tokens = tokens.filter((t) => t.chainId === c.options.chain);
      }
      if (c.options.symbol) {
        const match = c.options.symbol.toLowerCase();
        tokens = tokens.filter(
          (t) => typeof t.symbol === "string" && t.symbol.toLowerCase() === match
        );
      }
      if (c.options.address) {
        const match = c.options.address.toLowerCase();
        tokens = tokens.filter((t) => t.address?.toLowerCase() === match);
      }

      return buildTokensSnapshot(tokens, c.options);
    },
  })
  .command("pools", {
    description: "Find pools for a token pair via subgraph or RPC",
    alias: { chain: "c", limit: "l" },
    examples: [
      {
        options: { chain: 1, token0: "USDC", token1: "WETH" },
        description: "USDC-WETH pools on Ethereum",
      },
    ],
    options: z.object({
      chain: z.coerce.number().default(1).describe("Chain ID"),
      token0: z.string().describe("Token0 address or symbol"),
      token1: z.string().describe("Token1 address or symbol"),
      fee: z.coerce.number().optional().describe("Fee tier in bps (e.g. 3000)"),
      limit: z.coerce.number().default(10).describe("Max results"),
      source: z.string().default(DEFAULT_TOKEN_LIST_SOURCE).describe("Token list URL"),
      endpoint: z.string().optional().describe("Subgraph endpoint URL"),
      graphKey: z.string().optional().describe("The Graph API key"),
      subgraphId: z.string().optional().describe("The Graph subgraph ID"),
      rpcUrl: z.string().optional().describe("RPC URL for on-chain queries"),
      factory: z.string().optional().describe("Factory contract address"),
    }),
    env: z.object({
      GRAPH_API_KEY: z.string().optional().describe("The Graph API key"),
      RPC_URL: z.string().optional().describe("RPC URL"),
    }),
    async run(c) {
      const graphKey = c.options.graphKey ?? c.env.GRAPH_API_KEY;
      const rpcUrl = c.options.rpcUrl ?? c.env.RPC_URL;
      const data = await fetchPoolsWithFallback(c.options, graphKey, rpcUrl);
      return c.ok(data, { cta: { commands: ["pools-snapshot"] } });
    },
  })
  .command("pools-snapshot", {
    description: "Generate spell params snapshot for pools",
    alias: { chain: "c", limit: "l" },
    outputPolicy: "agent-only" as const,
    options: z.object({
      chain: z.coerce.number().default(1).describe("Chain ID"),
      token0: z.string().describe("Token0 address or symbol"),
      token1: z.string().describe("Token1 address or symbol"),
      fee: z.coerce.number().optional().describe("Fee tier in bps (e.g. 3000)"),
      limit: z.coerce.number().default(10).describe("Max results"),
      source: z.string().default(DEFAULT_TOKEN_LIST_SOURCE).describe("Token list URL"),
      endpoint: z.string().optional().describe("Subgraph endpoint URL"),
      graphKey: z.string().optional().describe("The Graph API key"),
      subgraphId: z.string().optional().describe("The Graph subgraph ID"),
      rpcUrl: z.string().optional().describe("RPC URL for on-chain queries"),
      factory: z.string().optional().describe("Factory contract address"),
    }),
    env: z.object({
      GRAPH_API_KEY: z.string().optional().describe("The Graph API key"),
      RPC_URL: z.string().optional().describe("RPC URL"),
    }),
    output: z.string(),
    async run(c) {
      const graphKey = c.options.graphKey ?? c.env.GRAPH_API_KEY;
      const rpcUrl = c.options.rpcUrl ?? c.env.RPC_URL;
      const { pools, usedRpc, resolvedFactory } = await fetchPoolsWithFallbackMeta(
        c.options,
        graphKey,
        rpcUrl
      );

      return buildPoolsSnapshot(pools, {
        chain: c.options.chain,
        token0: c.options.token0,
        token1: c.options.token1,
        feeTier: c.options.fee,
        limit: c.options.limit,
        source: c.options.source,
        endpoint: usedRpc ? undefined : c.options.endpoint,
        graphKey: usedRpc ? undefined : graphKey ? "(env)" : undefined,
        subgraphId: usedRpc ? undefined : c.options.subgraphId,
        rpcUrl: usedRpc ? "(env)" : undefined,
        factory: usedRpc ? (resolvedFactory ?? c.options.factory) : undefined,
      });
    },
  });

cli.serve();
