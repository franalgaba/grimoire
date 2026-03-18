#!/usr/bin/env node

import { Cli, z } from "incur";
import { createPendleAdapter } from "../adapters/pendle/index.js";

const DEFAULT_BASE_URL = "https://api-v2.pendle.finance/core" as const;

const cli = Cli.create("grimoire-pendle", {
  description: "Pendle venue metadata — markets, assets, chains, and aggregators",
  sync: { suggestions: ["list pendle markets on Ethereum", "check supported pendle chains"] },
})
  .use(async (c, next) => {
    const start = performance.now();
    await next();
    if (!c.agent) console.error(`Done in ${(performance.now() - start).toFixed(0)}ms`);
  })
  .command("info", {
    description: "Show adapter metadata",
    options: z.object({
      baseUrl: z.string().default(DEFAULT_BASE_URL).describe("Pendle API base URL"),
    }),
    env: z.object({
      PENDLE_API_BASE_URL: z.string().optional().describe("Override Pendle API base URL"),
    }),
    run(c) {
      const baseUrl = resolveBaseUrl(c.options.baseUrl, c.env.PENDLE_API_BASE_URL);
      const adapter = createPendleAdapter({ baseUrl });
      return c.ok({ ...adapter.meta, baseUrl }, { cta: { commands: ["chains", "markets"] } });
    },
  })
  .command("chains", {
    description: "List supported chains",
    options: z.object({
      baseUrl: z.string().default(DEFAULT_BASE_URL).describe("Pendle API base URL"),
    }),
    env: z.object({
      PENDLE_API_BASE_URL: z.string().optional().describe("Override Pendle API base URL"),
    }),
    async run(c) {
      const baseUrl = resolveBaseUrl(c.options.baseUrl, c.env.PENDLE_API_BASE_URL);
      const data = await fetchPendleJson(baseUrl, "/v1/chains");
      return c.ok(data, { cta: { commands: ["markets --chain <id>"] } });
    },
  })
  .command("supported-aggregators", {
    description: "List supported aggregators for a chain",
    alias: { chain: "c" },
    options: z.object({
      chain: z.coerce.number().describe("Chain ID"),
      baseUrl: z.string().default(DEFAULT_BASE_URL).describe("Pendle API base URL"),
    }),
    env: z.object({
      PENDLE_API_BASE_URL: z.string().optional().describe("Override Pendle API base URL"),
    }),
    async run(c) {
      const baseUrl = resolveBaseUrl(c.options.baseUrl, c.env.PENDLE_API_BASE_URL);
      return fetchPendleJson(baseUrl, `/v1/sdk/${c.options.chain}/supported-aggregators`);
    },
  })
  .command("markets", {
    description: "List markets, optionally filtered by chain and active status",
    alias: { chain: "c" },
    examples: [{ options: { chain: 1, active: true }, description: "Active markets on Ethereum" }],
    options: z.object({
      chain: z.coerce.number().optional().describe("Chain ID"),
      active: z.boolean().optional().describe("Filter by active status"),
      baseUrl: z.string().default(DEFAULT_BASE_URL).describe("Pendle API base URL"),
    }),
    env: z.object({
      PENDLE_API_BASE_URL: z.string().optional().describe("Override Pendle API base URL"),
    }),
    async run(c) {
      const baseUrl = resolveBaseUrl(c.options.baseUrl, c.env.PENDLE_API_BASE_URL);
      const params = new URLSearchParams();
      if (c.options.chain !== undefined) params.set("chainId", String(c.options.chain));
      if (c.options.active !== undefined) params.set("isActive", String(c.options.active));
      const query = params.size > 0 ? `?${params.toString()}` : "";
      const data = await fetchPendleJson(baseUrl, `/v1/markets/all${query}`);
      return c.ok(data, { cta: { commands: ["assets", "market-tokens"] } });
    },
  })
  .command("assets", {
    description: "List assets, optionally filtered by chain and type (PT, YT, LP, SY)",
    alias: { chain: "c" },
    examples: [{ options: { chain: 1, type: "PT" }, description: "PT assets on Ethereum" }],
    options: z.object({
      chain: z.coerce.number().optional().describe("Chain ID"),
      type: z.enum(["PT", "YT", "LP", "SY"]).optional().describe("Asset type"),
      baseUrl: z.string().default(DEFAULT_BASE_URL).describe("Pendle API base URL"),
    }),
    env: z.object({
      PENDLE_API_BASE_URL: z.string().optional().describe("Override Pendle API base URL"),
    }),
    async run(c) {
      const baseUrl = resolveBaseUrl(c.options.baseUrl, c.env.PENDLE_API_BASE_URL);
      const params = new URLSearchParams();
      if (c.options.chain !== undefined) params.set("chainId", String(c.options.chain));
      if (c.options.type)
        params.set("type", c.options.type === "LP" ? "PENDLE_LP" : c.options.type);
      const query = params.size > 0 ? `?${params.toString()}` : "";
      const data = await fetchPendleJson(baseUrl, `/v1/assets/all${query}`);
      return c.ok(data, { cta: { commands: ["market-tokens"] } });
    },
  })
  .command("market-tokens", {
    description: "List tokens for a specific market",
    alias: { chain: "c" },
    examples: [
      { options: { chain: 1, market: "0x..." }, description: "Tokens for a specific market" },
    ],
    options: z.object({
      chain: z.coerce.number().describe("Chain ID"),
      market: z.string().describe("Market address"),
      baseUrl: z.string().default(DEFAULT_BASE_URL).describe("Pendle API base URL"),
    }),
    env: z.object({
      PENDLE_API_BASE_URL: z.string().optional().describe("Override Pendle API base URL"),
    }),
    async run(c) {
      const baseUrl = resolveBaseUrl(c.options.baseUrl, c.env.PENDLE_API_BASE_URL);
      return fetchPendleJson(
        baseUrl,
        `/v1/sdk/${c.options.chain}/markets/${c.options.market}/tokens`
      );
    },
  });

cli.serve();

// --- Helpers ---

function resolveBaseUrl(optionValue: string, envValue?: string): string {
  const raw = envValue ?? optionValue;
  return raw.replace(/\/$/, "");
}

async function fetchPendleJson<T = Record<string, unknown>>(
  baseUrl: string,
  path: string
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Pendle API request failed (${response.status}): ${text || response.statusText}`
    );
  }
  return (await response.json()) as T;
}
