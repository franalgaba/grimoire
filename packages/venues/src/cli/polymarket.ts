#!/usr/bin/env node

import { Cli, z } from "incur";
import {
  OFFICIAL_CLI_BINARY,
  probeOfficialCli,
  runOfficialCli,
  runOfficialJsonCommand,
} from "./polymarket-official-cli.js";
import {
  DEFAULT_SEARCH_MAX_PAGES,
  DEFAULT_STOP_AFTER_EMPTY_PAGES,
  streamSearchMarkets,
} from "./polymarket-search.js";

const OFFICIAL_PASSTHROUGH_GROUPS = new Set(["markets", "data"]);
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

const SIGNATURE_TYPES = ["eoa", "proxy", "gnosis-safe"] as const;

const officialAuthOptions = {
  privateKey: z.string().optional().describe("Private key for official CLI auth"),
  signatureType: z
    .enum(SIGNATURE_TYPES)
    .optional()
    .describe("Signature type override: eoa, proxy, or gnosis-safe"),
};

type OfficialAuthOptions = {
  privateKey?: string;
  signatureType?: (typeof SIGNATURE_TYPES)[number];
};

type PaginationOptions = {
  limit?: number;
  offset?: number;
};

const paginationOptions = {
  limit: z.coerce.number().optional().describe("Maximum results"),
  offset: z.coerce.number().optional().describe("Pagination offset"),
};

const walletAddressArg = z.object({
  address: z.string().describe("Wallet address"),
});

const marketsCli = Cli.create("markets", {
  description: "Official Polymarket markets namespace",
})
  .command("list", {
    description: "List markets with optional filters",
    options: z.object({
      ...officialAuthOptions,
      active: z.boolean().optional().describe("Filter by active status"),
      closed: z.boolean().optional().describe("Filter by closed status"),
      ...paginationOptions,
      order: z.string().optional().describe("Sort field"),
      ascending: z.boolean().optional().describe("Sort ascending"),
    }),
    run(c) {
      const args = ["markets", "list"];
      appendBooleanOption(args, "--active", c.options.active);
      appendBooleanOption(args, "--closed", c.options.closed);
      appendPagination(args, c.options);
      appendOptional(args, "--order", c.options.order);
      if (c.options.ascending) args.push("--ascending");
      return c.ok(runOfficialJsonWithAuth(args, c.options));
    },
  })
  .command("get", {
    description: "Get a single market by ID or slug",
    args: z.object({
      id: z.string().describe("Market ID or slug"),
    }),
    options: z.object({
      ...officialAuthOptions,
    }),
    run(c) {
      const args = ["markets", "get", c.args.id];
      return c.ok(runOfficialJsonWithAuth(args, c.options));
    },
  })
  .command("search", {
    description: "Search markets",
    args: z.object({
      query: z.string().describe("Search query"),
    }),
    options: z.object({
      ...officialAuthOptions,
      limit: z.coerce.number().optional().describe("Maximum results per type"),
    }),
    run(c) {
      const args = ["markets", "search", c.args.query];
      appendOptional(args, "--limit", c.options.limit);
      return c.ok(runOfficialJsonWithAuth(args, c.options));
    },
  })
  .command("tags", {
    description: "Get tags for a market",
    args: z.object({
      id: z.string().describe("Market ID"),
    }),
    options: z.object({
      ...officialAuthOptions,
    }),
    run(c) {
      const args = ["markets", "tags", c.args.id];
      return c.ok(runOfficialJsonWithAuth(args, c.options));
    },
  });

const dataCli = Cli.create("data", {
  description: "Official Polymarket data namespace",
})
  .command("positions", {
    description: "Get open positions for a wallet address",
    args: walletAddressArg,
    options: z.object({
      ...officialAuthOptions,
      ...paginationOptions,
    }),
    run(c) {
      const args = ["data", "positions", c.args.address];
      appendPagination(args, c.options);
      return c.ok(runOfficialJsonWithAuth(args, c.options));
    },
  })
  .command("closed-positions", {
    description: "Get closed positions for a wallet address",
    args: walletAddressArg,
    options: z.object({
      ...officialAuthOptions,
      ...paginationOptions,
    }),
    run(c) {
      const args = ["data", "closed-positions", c.args.address];
      appendPagination(args, c.options);
      return c.ok(runOfficialJsonWithAuth(args, c.options));
    },
  })
  .command("value", {
    description: "Get total position value for a wallet address",
    args: walletAddressArg,
    options: z.object({
      ...officialAuthOptions,
    }),
    run(c) {
      return c.ok(runOfficialJsonWithAuth(["data", "value", c.args.address], c.options));
    },
  })
  .command("traded", {
    description: "Get count of unique markets traded by a wallet",
    args: walletAddressArg,
    options: z.object({
      ...officialAuthOptions,
    }),
    run(c) {
      return c.ok(runOfficialJsonWithAuth(["data", "traded", c.args.address], c.options));
    },
  })
  .command("trades", {
    description: "Get trade history for a wallet",
    args: walletAddressArg,
    options: z.object({
      ...officialAuthOptions,
      ...paginationOptions,
    }),
    run(c) {
      const args = ["data", "trades", c.args.address];
      appendPagination(args, c.options);
      return c.ok(runOfficialJsonWithAuth(args, c.options));
    },
  })
  .command("activity", {
    description: "Get on-chain activity for a wallet address",
    args: walletAddressArg,
    options: z.object({
      ...officialAuthOptions,
      ...paginationOptions,
    }),
    run(c) {
      const args = ["data", "activity", c.args.address];
      appendPagination(args, c.options);
      return c.ok(runOfficialJsonWithAuth(args, c.options));
    },
  })
  .command("holders", {
    description: "Get top token holders for a market",
    args: z.object({
      market: z.string().describe("Market condition ID"),
    }),
    options: z.object({
      ...officialAuthOptions,
      limit: z.coerce.number().optional().describe("Maximum results per token"),
    }),
    run(c) {
      const args = ["data", "holders", c.args.market];
      appendOptional(args, "--limit", c.options.limit);
      return c.ok(runOfficialJsonWithAuth(args, c.options));
    },
  })
  .command("open-interest", {
    description: "Get open interest for a market",
    args: z.object({
      market: z.string().describe("Market condition ID"),
    }),
    options: z.object({
      ...officialAuthOptions,
    }),
    run(c) {
      return c.ok(runOfficialJsonWithAuth(["data", "open-interest", c.args.market], c.options));
    },
  })
  .command("volume", {
    description: "Get live volume for an event",
    args: z.object({
      id: z.string().describe("Event ID"),
    }),
    options: z.object({
      ...officialAuthOptions,
    }),
    run(c) {
      return c.ok(runOfficialJsonWithAuth(["data", "volume", c.args.id], c.options));
    },
  })
  .command("leaderboard", {
    description: "Trader leaderboard",
    options: z.object({
      ...officialAuthOptions,
      period: z.enum(["day", "week", "month", "all"]).optional().describe("Time period"),
      orderBy: z.enum(["pnl", "vol"]).optional().describe("Order field"),
      ...paginationOptions,
    }),
    run(c) {
      const args = ["data", "leaderboard"];
      appendOptional(args, "--period", c.options.period);
      appendOptional(args, "--order-by", c.options.orderBy);
      appendPagination(args, c.options);
      return c.ok(runOfficialJsonWithAuth(args, c.options));
    },
  })
  .command("builder-leaderboard", {
    description: "Builder leaderboard",
    options: z.object({
      ...officialAuthOptions,
      period: z.enum(["day", "week", "month", "all"]).optional().describe("Time period"),
      ...paginationOptions,
    }),
    run(c) {
      const args = ["data", "builder-leaderboard"];
      appendOptional(args, "--period", c.options.period);
      appendPagination(args, c.options);
      return c.ok(runOfficialJsonWithAuth(args, c.options));
    },
  })
  .command("builder-volume", {
    description: "Builder volume time-series",
    options: z.object({
      ...officialAuthOptions,
      period: z.enum(["day", "week", "month", "all"]).optional().describe("Time period"),
    }),
    run(c) {
      const args = ["data", "builder-volume"];
      appendOptional(args, "--period", c.options.period);
      return c.ok(runOfficialJsonWithAuth(args, c.options));
    },
  });

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
          passthroughGroups: Array.from(OFFICIAL_PASSTHROUGH_GROUPS),
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
    async run(c) {
      const gen = streamSearchMarkets(c.options);
      let step = gen.next();
      while (!step.done) {
        const progress = step.value;
        if (!c.agent) {
          process.stderr.write(
            `\r  Scanned ${progress.scannedPages} pages, ${progress.matchesSoFar} matches…`
          );
        }
        step = gen.next();
      }
      if (!c.agent) process.stderr.write("\n");
      const result = step.value;
      const data = c.agent
        ? { totalMatches: result.totalMatches, markets: result.markets }
        : result;
      return c.ok(data, { cta: { commands: ["market --conditionId <id>"] } });
    },
  })
  .command(marketsCli)
  .command(dataCli)
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

function appendOptional(args: string[], flag: string, value: string | number | undefined): void {
  if (value === undefined) return;
  args.push(flag, String(value));
}

function appendBooleanOption(args: string[], flag: string, value: boolean | undefined): void {
  if (value === undefined) return;
  args.push(flag, value ? "true" : "false");
}

function appendPagination(args: string[], options: PaginationOptions): void {
  appendOptional(args, "--limit", options.limit);
  appendOptional(args, "--offset", options.offset);
}

function appendAuthArgs(args: string[], options: OfficialAuthOptions): void {
  appendOptional(args, "--private-key", options.privateKey);
  appendOptional(args, "--signature-type", options.signatureType);
}

function runOfficialJsonWithAuth(args: string[], options: OfficialAuthOptions): unknown {
  const next = [...args];
  appendAuthArgs(next, options);
  return runOfficialJsonCommand(next);
}
