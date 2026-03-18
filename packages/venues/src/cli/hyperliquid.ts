#!/usr/bin/env node

import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { Cli, z } from "incur";

const cli = Cli.create("grimoire-hyperliquid", {
  description: "Hyperliquid futures and spot data — mids, order books, meta, and withdrawals",
  sync: { suggestions: ["get current mid prices", "check ETH order book depth"] },
})
  .use(async (c, next) => {
    const start = performance.now();
    await next();
    if (!c.agent) console.error(`Done in ${(performance.now() - start).toFixed(0)}ms`);
  })
  .command("mids", {
    description: "Get mid prices for all assets",
    async run(c) {
      const info = createInfoClient();
      const data = await info.allMids();
      return c.ok(data, { cta: { commands: ["l2-book --coin ETH", "mids-snapshot"] } });
    },
  })
  .command("mids-snapshot", {
    description: "Generate spell params snapshot for mid prices",
    output: z.string(),
    outputPolicy: "agent-only" as const,
    async run() {
      const info = createInfoClient();
      const mids = await info.allMids();
      return buildMidsSnapshot(mids);
    },
  })
  .command("l2-book", {
    description: "Get L2 order book for a coin",
    examples: [{ options: { coin: "ETH" }, description: "ETH order book" }],
    options: z.object({
      coin: z.string().describe("Coin symbol (e.g. ETH, BTC)"),
    }),
    async run(c) {
      const info = createInfoClient();
      const data = await info.l2Book({ coin: c.options.coin });
      return c.ok(data, { cta: { commands: ["open-orders --user <addr>"] } });
    },
  })
  .command("l2-book-snapshot", {
    description: "Generate spell params snapshot for L2 order book",
    outputPolicy: "agent-only" as const,
    options: z.object({
      coin: z.string().describe("Coin symbol (e.g. ETH, BTC)"),
    }),
    output: z.string(),
    async run(c) {
      const info = createInfoClient();
      const book = await info.l2Book({ coin: c.options.coin });
      return buildL2BookSnapshot(book, { coin: c.options.coin });
    },
  })
  .command("open-orders", {
    description: "Get open orders for a user",
    examples: [{ options: { user: "0x..." }, description: "Open orders for address" }],
    options: z.object({
      user: z.string().describe("User address"),
    }),
    async run(c) {
      const info = createInfoClient();
      return info.openOrders({ user: c.options.user });
    },
  })
  .command("open-orders-snapshot", {
    description: "Generate spell params snapshot for open orders",
    outputPolicy: "agent-only" as const,
    options: z.object({
      user: z.string().describe("User address"),
    }),
    output: z.string(),
    async run(c) {
      const info = createInfoClient();
      const orders = await info.openOrders({ user: c.options.user });
      return buildOpenOrdersSnapshot(orders, { user: c.options.user });
    },
  })
  .command("meta", {
    description: "Get perpetual market metadata (universe)",
    async run(c) {
      const info = createInfoClient();
      const data = await info.meta();
      return c.ok(data, { cta: { commands: ["spot-meta", "mids"] } });
    },
  })
  .command("meta-snapshot", {
    description: "Generate spell params snapshot for perp metadata",
    outputPolicy: "agent-only" as const,
    output: z.string(),
    async run() {
      const info = createInfoClient();
      const meta = await info.meta();
      return buildMetaSnapshot(meta);
    },
  })
  .command("spot-meta", {
    description: "Get spot market metadata (tokens and universe)",
    async run(c) {
      const info = createInfoClient();
      const data = await info.spotMeta();
      return c.ok(data, { cta: { commands: ["mids"] } });
    },
  })
  .command("spot-meta-snapshot", {
    description: "Generate spell params snapshot for spot metadata",
    outputPolicy: "agent-only" as const,
    output: z.string(),
    async run() {
      const info = createInfoClient();
      const meta = await info.spotMeta();
      return buildSpotMetaSnapshot(meta);
    },
  })
  .command("withdraw", {
    description: "Withdraw USDC from HyperCore",
    examples: [
      { options: { amount: "100", keystore: "./keystore.json" }, description: "Withdraw 100 USDC" },
    ],
    options: z.object({
      amount: z.string().describe("Amount of USDC to withdraw"),
      keystore: z.string().describe("Path to keystore JSON file"),
      passwordEnv: z
        .string()
        .default("KEYSTORE_PASSWORD")
        .describe("Env var name for keystore password"),
      destination: z
        .string()
        .optional()
        .describe("Destination address (defaults to keystore address)"),
    }),
    async run(c) {
      const password = process.env[c.options.passwordEnv];
      if (!password) throw new Error(`${c.options.passwordEnv} not set`);

      const { loadPrivateKey } = await import("@grimoirelabs/core");
      const { readFileSync } = await import("node:fs");
      const { privateKeyToAccount } = await import("viem/accounts");

      const keystoreJson = readFileSync(c.options.keystore, "utf-8");
      const rawKey = loadPrivateKey({ type: "keystore", source: keystoreJson, password });
      const account = privateKeyToAccount(rawKey);
      const destination = (c.options.destination ?? account.address) as `0x${string}`;

      const transport = new HttpTransport();
      const exchange = new ExchangeClient({ transport, wallet: account });
      const result = await exchange.withdraw3({ destination, amount: c.options.amount });

      return {
        ...result,
        withdrew: c.options.amount,
        destination,
      };
    },
  });

cli.serve();

// --- Client factory ---

function createInfoClient(): InfoClient {
  return new InfoClient({ transport: new HttpTransport() });
}

// --- Types ---

type MidsResponse = Record<string, string>;

type L2BookLevel = {
  px: string;
  sz: string;
  n: number;
};

type L2BookResponse = {
  coin: string;
  time: number;
  levels: [L2BookLevel[], L2BookLevel[]];
} | null;

type OpenOrder = {
  coin: string;
  side: "B" | "A";
  limitPx: string;
  sz: string;
  oid: number;
  timestamp: number;
  origSz: string;
  cloid?: string;
  reduceOnly?: true;
};

type MetaUniverse = {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  marginTableId: number;
  onlyIsolated?: true;
  isDelisted?: true;
  marginMode?: string;
  growthMode?: string;
};

type MetaResponse = {
  universe: MetaUniverse[];
};

type SpotUniverse = {
  name: string;
  index: number;
  isCanonical: boolean;
};

type SpotToken = {
  name: string;
  szDecimals: number;
  weiDecimals: number;
  index: number;
  tokenId: string;
  isCanonical: boolean;
  evmContract: { address: string } | null;
};

type SpotMetaResponse = {
  universe: SpotUniverse[];
  tokens: SpotToken[];
};

// --- Snapshot builders (exported for tests) ---

export function printMidsSpellSnapshot(mids: MidsResponse): void {
  console.log(buildMidsSnapshot(mids));
}

function buildMidsSnapshot(mids: MidsResponse): string {
  const entries = Object.entries(mids).sort(([a], [b]) => a.localeCompare(b));
  const assets = entries.map(([asset]) => asset);
  const prices = entries.map(([, price]) => toNumber(price));

  const lines = createSnapshotLines(["grimoire venue hyperliquid mids"]);
  pushArray(lines, "mid_assets", assets, formatString);
  pushArray(lines, "mid_prices", prices, formatNumber);
  return lines.join("\n");
}

export function printL2BookSpellSnapshot(book: L2BookResponse, options: { coin: string }): void {
  console.log(buildL2BookSnapshot(book, options));
}

function buildL2BookSnapshot(book: L2BookResponse, options: { coin: string }): string {
  const bids = book?.levels?.[0] ?? [];
  const asks = book?.levels?.[1] ?? [];
  const lines = createSnapshotLines([
    "grimoire venue hyperliquid l2-book",
    `--coin ${options.coin}`,
  ]);

  lines.push(`  l2_coin: "${book?.coin ?? options.coin}"`);
  lines.push(`  l2_time: ${book?.time ?? 0}`);

  pushArray(
    lines,
    "l2_bids_px",
    bids.map((l) => toNumber(l.px)),
    formatNumber
  );
  pushArray(
    lines,
    "l2_bids_sz",
    bids.map((l) => toNumber(l.sz)),
    formatNumber
  );
  pushArray(
    lines,
    "l2_bids_n",
    bids.map((l) => l.n),
    formatNumber
  );
  pushArray(
    lines,
    "l2_asks_px",
    asks.map((l) => toNumber(l.px)),
    formatNumber
  );
  pushArray(
    lines,
    "l2_asks_sz",
    asks.map((l) => toNumber(l.sz)),
    formatNumber
  );
  pushArray(
    lines,
    "l2_asks_n",
    asks.map((l) => l.n),
    formatNumber
  );

  return lines.join("\n");
}

export function printOpenOrdersSpellSnapshot(orders: OpenOrder[], options: { user: string }): void {
  console.log(buildOpenOrdersSnapshot(orders, options));
}

function buildOpenOrdersSnapshot(orders: OpenOrder[], options: { user: string }): string {
  const lines = createSnapshotLines([
    "grimoire venue hyperliquid open-orders",
    `--user ${options.user}`,
  ]);

  pushArray(
    lines,
    "open_order_coins",
    orders.map((o) => o.coin),
    formatString
  );
  pushArray(
    lines,
    "open_order_sides",
    orders.map((o) => o.side),
    formatString
  );
  pushArray(
    lines,
    "open_order_limit_px",
    orders.map((o) => toNumber(o.limitPx)),
    formatNumber
  );
  pushArray(
    lines,
    "open_order_sizes",
    orders.map((o) => toNumber(o.sz)),
    formatNumber
  );
  pushArray(
    lines,
    "open_order_ids",
    orders.map((o) => o.oid),
    formatNumber
  );
  pushArray(
    lines,
    "open_order_timestamps",
    orders.map((o) => o.timestamp),
    formatNumber
  );
  pushArray(
    lines,
    "open_order_orig_sizes",
    orders.map((o) => toNumber(o.origSz)),
    formatNumber
  );
  pushArray(
    lines,
    "open_order_reduce_only",
    orders.map((o) => Boolean(o.reduceOnly)),
    formatBoolean
  );
  pushArray(
    lines,
    "open_order_cloids",
    orders.map((o) => o.cloid ?? ""),
    formatString
  );

  return lines.join("\n");
}

export function printMetaSpellSnapshot(meta: MetaResponse): void {
  console.log(buildMetaSnapshot(meta));
}

function buildMetaSnapshot(meta: MetaResponse): string {
  const universe = meta.universe ?? [];
  const lines = createSnapshotLines(["grimoire venue hyperliquid meta"]);

  pushArray(
    lines,
    "perp_universe_names",
    universe.map((i) => i.name),
    formatString
  );
  pushArray(
    lines,
    "perp_universe_sz_decimals",
    universe.map((i) => i.szDecimals),
    formatNumber
  );
  pushArray(
    lines,
    "perp_universe_max_leverage",
    universe.map((i) => i.maxLeverage),
    formatNumber
  );
  pushArray(
    lines,
    "perp_universe_margin_table_id",
    universe.map((i) => i.marginTableId),
    formatNumber
  );
  pushArray(
    lines,
    "perp_universe_only_isolated",
    universe.map((i) => Boolean(i.onlyIsolated)),
    formatBoolean
  );
  pushArray(
    lines,
    "perp_universe_is_delisted",
    universe.map((i) => Boolean(i.isDelisted)),
    formatBoolean
  );
  pushArray(
    lines,
    "perp_universe_margin_mode",
    universe.map((i) => i.marginMode ?? ""),
    formatString
  );
  pushArray(
    lines,
    "perp_universe_growth_mode",
    universe.map((i) => i.growthMode ?? ""),
    formatString
  );

  return lines.join("\n");
}

export function printSpotMetaSpellSnapshot(meta: SpotMetaResponse): void {
  console.log(buildSpotMetaSnapshot(meta));
}

function buildSpotMetaSnapshot(meta: SpotMetaResponse): string {
  const tokens = meta.tokens ?? [];
  const universe = meta.universe ?? [];
  const lines = createSnapshotLines(["grimoire venue hyperliquid spot-meta"]);

  pushArray(
    lines,
    "spot_token_names",
    tokens.map((t) => t.name),
    formatString
  );
  pushArray(
    lines,
    "spot_token_indices",
    tokens.map((t) => t.index),
    formatNumber
  );
  pushArray(
    lines,
    "spot_token_ids",
    tokens.map((t) => t.tokenId),
    formatString
  );
  pushArray(
    lines,
    "spot_token_addresses",
    tokens.map((t) => t.evmContract?.address ?? ""),
    formatString
  );
  pushArray(
    lines,
    "spot_token_sz_decimals",
    tokens.map((t) => t.szDecimals),
    formatNumber
  );
  pushArray(
    lines,
    "spot_token_wei_decimals",
    tokens.map((t) => t.weiDecimals),
    formatNumber
  );
  pushArray(
    lines,
    "spot_token_is_canonical",
    tokens.map((t) => Boolean(t.isCanonical)),
    formatBoolean
  );
  pushArray(
    lines,
    "spot_universe_names",
    universe.map((i) => i.name),
    formatString
  );
  pushArray(
    lines,
    "spot_universe_indices",
    universe.map((i) => i.index),
    formatNumber
  );
  pushArray(
    lines,
    "spot_universe_is_canonical",
    universe.map((i) => i.isCanonical),
    formatBoolean
  );

  return lines.join("\n");
}

// --- Snapshot utilities ---

function createSnapshotLines(args: string[]): string[] {
  const snapshotAt = new Date().toISOString();
  return ["params:", `  snapshot_at: "${snapshotAt}"`, `  snapshot_source: "${args.join(" ")}"`];
}

function pushArray<T>(
  lines: string[],
  key: string,
  values: T[],
  formatter: (value: T) => string
): void {
  lines.push(`  ${key}: [`);
  for (const value of values) {
    lines.push(`    ${formatter(value)},`);
  }
  lines.push("  ]");
}

function formatString(value: string): string {
  return `"${value}"`;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return `${value}`;
}

function formatBoolean(value: boolean): string {
  return value ? "true" : "false";
}

function toNumber(value: string | number): number {
  if (typeof value === "number") return value;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
