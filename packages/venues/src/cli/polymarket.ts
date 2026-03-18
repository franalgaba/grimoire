#!/usr/bin/env node

import { Cli, z } from "incur";
import {
  OFFICIAL_CLI_BINARY,
  probeOfficialCli,
  runOfficialCli,
} from "./polymarket-official-cli.js";
import {
  DEFAULT_SEARCH_MAX_PAGES,
  DEFAULT_STOP_AFTER_EMPTY_PAGES,
  streamSearchMarkets,
} from "./polymarket-search.js";

const OFFICIAL_ALLOWED_TOP_LEVEL = new Set([
  "markets",
  "events",
  "tags",
  "series",
  "sports",
  "clob",
  "data",
  "status",
]);
const COMPAT_ALLOWED_TOP_LEVEL = new Set([
  "info",
  "search-markets",
  "server-time",
  "market",
  "book",
  "midpoint",
  "spread",
  "price",
  "last-trade-price",
  "tick-size",
  "neg-risk",
  "fee-rate",
  "price-history",
  "order",
  "trades",
  "open-orders",
  "balance-allowance",
  "closed-only-mode",
]);

const cli = Cli.create("grimoire-polymarket", {
  description: "Polymarket prediction market data — search, events, CLOB, and trading",
  sync: {
    suggestions: ["search prediction markets about elections", "find sports betting markets"],
  },
})
  .use(async (c, next) => {
    const start = performance.now();
    await next();
    if (!c.agent) console.error(`Done in ${(performance.now() - start).toFixed(0)}ms`);
  })
  .command("info", {
    description: "Show CLI backend info and available commands",
    run(c) {
      const probe = probeOfficialCli();
      return c.ok(
        {
          name: "polymarket",
          backend: "official-cli",
          binary: OFFICIAL_CLI_BINARY,
          installed: probe.installed,
          version: probe.version,
          compatibilityCommands: Array.from(COMPAT_ALLOWED_TOP_LEVEL),
          passthroughGroups: Array.from(OFFICIAL_ALLOWED_TOP_LEVEL),
        },
        { cta: { commands: ['search-markets --query "..."'] } }
      );
    },
  })
  .command("search-markets", {
    description: "Search and filter prediction markets across all sources",
    alias: { query: "q", limit: "l" },
    examples: [
      {
        options: { query: "elections", activeOnly: true, limit: 10 },
        description: "Active election markets",
      },
      {
        options: { sport: "soccer", league: "premier league" },
        description: "Premier League markets",
      },
    ],
    options: z.object({
      query: z.string().optional().describe("Free-text search query"),
      slug: z.string().optional().describe("Market slug or URL"),
      question: z.string().optional().describe("Match market question"),
      sport: z.string().optional().describe("Filter by sport"),
      category: z.string().optional().describe("Filter by category"),
      league: z.string().optional().describe("Filter by league/competition"),
      event: z.string().optional().describe("Filter by event name"),
      tag: z.string().optional().describe("Filter by tag"),
      openOnly: z.boolean().default(false).describe("Only show open markets"),
      activeOnly: z.boolean().default(false).describe("Only show active markets"),
      ignoreEndDate: z.boolean().default(false).describe("Ignore market end dates"),
      tradableOnly: z.boolean().default(false).describe("Only show tradable markets"),
      allPages: z.boolean().default(true).describe("Scan multiple pages"),
      maxPages: z.coerce
        .number()
        .default(DEFAULT_SEARCH_MAX_PAGES)
        .describe("Maximum pages to scan"),
      stopAfterEmptyPages: z.coerce
        .number()
        .default(DEFAULT_STOP_AFTER_EMPTY_PAGES)
        .describe("Stop after N pages with no matches"),
      limit: z.coerce.number().default(50).describe("Maximum results to return"),
      offset: z.coerce.number().optional().describe("Starting offset for pagination"),
      cursor: z.string().optional().describe("Pagination cursor"),
    }),
    async *run(c) {
      const result = yield* streamSearchMarkets(c.options);
      const data = c.agent
        ? { totalMatches: result.totalMatches, markets: result.markets }
        : result;
      return c.ok(data, { cta: { commands: ["market --conditionId <id>"] } });
    },
  })
  .command("status", {
    description: "Check Polymarket API status",
    run() {
      runOfficialCli(["status"]);
      return undefined;
    },
  })
  .command("server-time", {
    description: "Get CLOB server time",
    run() {
      runOfficialCli(["clob", "time"]);
      return undefined;
    },
  })
  .command("market", {
    description: "Get market details by condition ID",
    options: z.object({
      conditionId: z.string().describe("Market condition ID"),
    }),
    run(c) {
      runOfficialCli(["clob", "market", c.options.conditionId]);
      return undefined;
    },
  })
  .command("book", {
    description: "Get order book for a token",
    options: z.object({
      tokenId: z.string().describe("Token ID"),
    }),
    run(c) {
      runOfficialCli(["clob", "book", c.options.tokenId]);
      return undefined;
    },
  })
  .command("midpoint", {
    description: "Get midpoint price for a token",
    options: z.object({
      tokenId: z.string().describe("Token ID"),
    }),
    run(c) {
      runOfficialCli(["clob", "midpoint", c.options.tokenId]);
      return undefined;
    },
  })
  .command("spread", {
    description: "Get spread for a token",
    options: z.object({
      tokenId: z.string().describe("Token ID"),
      side: z.enum(["buy", "sell"]).optional().describe("Side (buy or sell)"),
    }),
    run(c) {
      const args = ["clob", "spread", c.options.tokenId];
      if (c.options.side) args.push("--side", c.options.side);
      runOfficialCli(args);
      return undefined;
    },
  })
  .command("price", {
    description: "Get price for a token on a given side",
    options: z.object({
      tokenId: z.string().describe("Token ID"),
      side: z.enum(["buy", "sell"]).describe("Side (buy or sell)"),
    }),
    run(c) {
      runOfficialCli(["clob", "price", c.options.tokenId, "--side", c.options.side]);
      return undefined;
    },
  })
  .command("last-trade-price", {
    description: "Get last trade price for a token",
    options: z.object({
      tokenId: z.string().describe("Token ID"),
    }),
    run(c) {
      runOfficialCli(["clob", "last-trade", c.options.tokenId]);
      return undefined;
    },
  })
  .command("tick-size", {
    description: "Get tick size for a token",
    options: z.object({
      tokenId: z.string().describe("Token ID"),
    }),
    run(c) {
      runOfficialCli(["clob", "tick-size", c.options.tokenId]);
      return undefined;
    },
  })
  .command("neg-risk", {
    description: "Get neg-risk flag for a token",
    options: z.object({
      tokenId: z.string().describe("Token ID"),
    }),
    run(c) {
      runOfficialCli(["clob", "neg-risk", c.options.tokenId]);
      return undefined;
    },
  })
  .command("fee-rate", {
    description: "Get fee rate for a token",
    options: z.object({
      tokenId: z.string().describe("Token ID"),
    }),
    run(c) {
      runOfficialCli(["clob", "fee-rate", c.options.tokenId]);
      return undefined;
    },
  })
  .command("price-history", {
    description: "Get price history for a token",
    options: z.object({
      tokenId: z.string().describe("Token ID"),
      interval: z.string().optional().describe("Time interval"),
      fidelity: z.string().optional().describe("Data fidelity"),
    }),
    run(c) {
      const args = ["clob", "price-history", c.options.tokenId];
      if (c.options.interval) args.push("--interval", c.options.interval);
      if (c.options.fidelity) args.push("--fidelity", c.options.fidelity);
      runOfficialCli(args);
      return undefined;
    },
  })
  .command("order", {
    description: "Get order details",
    options: z.object({
      orderId: z.string().describe("Order ID"),
    }),
    run(c) {
      runOfficialCli(["clob", "order", c.options.orderId]);
      return undefined;
    },
  })
  .command("trades", {
    description: "List trades",
    options: z.object({
      market: z.string().optional().describe("Market condition ID"),
      assetId: z.string().optional().describe("Asset ID"),
      cursor: z.string().optional().describe("Pagination cursor"),
    }),
    run(c) {
      const args = ["clob", "trades"];
      if (c.options.market) args.push("--market", c.options.market);
      if (c.options.assetId) args.push("--asset", c.options.assetId);
      if (c.options.cursor) args.push("--cursor", c.options.cursor);
      runOfficialCli(args);
      return undefined;
    },
  })
  .command("open-orders", {
    description: "List open orders",
    options: z.object({
      market: z.string().optional().describe("Market condition ID"),
      assetId: z.string().optional().describe("Asset ID"),
      cursor: z.string().optional().describe("Pagination cursor"),
    }),
    run(c) {
      const args = ["clob", "orders"];
      if (c.options.market) args.push("--market", c.options.market);
      if (c.options.assetId) args.push("--asset", c.options.assetId);
      if (c.options.cursor) args.push("--cursor", c.options.cursor);
      runOfficialCli(args);
      return undefined;
    },
  })
  .command("balance-allowance", {
    description: "Check balance and allowance",
    options: z.object({
      assetType: z.enum(["collateral", "conditional"]).describe("Asset type"),
      tokenId: z.string().optional().describe("Token ID (for conditional)"),
    }),
    run(c) {
      const args = ["clob", "balance", "--asset-type", c.options.assetType];
      if (c.options.tokenId) args.push("--token", c.options.tokenId);
      runOfficialCli(args);
      return undefined;
    },
  })
  .command("closed-only-mode", {
    description: "Check account closed-only mode status",
    run() {
      runOfficialCli(["clob", "account-status"]);
      return undefined;
    },
  });

cli.serve();
