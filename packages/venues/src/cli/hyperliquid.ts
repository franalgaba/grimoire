#!/usr/bin/env node

import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { type OutputFormat, getOption, parseArgs, printResult, requireOption } from "./utils.js";

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (!command || command === "help" || options.help) {
    printUsage();
    return;
  }

  const transport = new HttpTransport();
  const info = new InfoClient({ transport });
  const format = getOption(options, "format") ?? "auto";

  switch (command) {
    case "mids": {
      const result = await info.allMids();
      if (format === "spell") {
        printMidsSpellSnapshot(result);
        return;
      }
      printResult(result, format as OutputFormat);
      return;
    }
    case "l2-book": {
      const coin = requireOption(options, "coin");
      const result = await info.l2Book({ coin });
      if (format === "spell") {
        printL2BookSpellSnapshot(result, { coin });
        return;
      }
      printResult(result, format as OutputFormat);
      return;
    }
    case "open-orders": {
      const user = requireOption(options, "user");
      const result = await info.openOrders({ user });
      if (format === "spell") {
        printOpenOrdersSpellSnapshot(result, { user });
        return;
      }
      printResult(result, format as OutputFormat);
      return;
    }
    case "meta": {
      const result = await info.meta();
      if (format === "spell") {
        printMetaSpellSnapshot(result);
        return;
      }
      printResult(result, format as OutputFormat);
      return;
    }
    case "spot-meta": {
      const result = await info.spotMeta();
      if (format === "spell") {
        printSpotMetaSpellSnapshot(result);
        return;
      }
      printResult(result, format as OutputFormat);
      return;
    }
    case "withdraw": {
      const amount = requireOption(options, "amount");
      const keystorePath = requireOption(options, "keystore");
      const passwordEnv = getOption(options, "password-env") ?? "KEYSTORE_PASSWORD";
      const password = process.env[passwordEnv];
      if (!password) throw new Error(`${passwordEnv} not set`);

      const { loadPrivateKey } = await import("@grimoirelabs/core");
      const { readFileSync } = await import("node:fs");
      const { privateKeyToAccount } = await import("viem/accounts");

      const keystoreJson = readFileSync(keystorePath, "utf-8");
      const rawKey = loadPrivateKey({ type: "keystore", source: keystoreJson, password });
      const account = privateKeyToAccount(rawKey);
      const destination = (getOption(options, "destination") ?? account.address) as `0x${string}`;

      const exchange = new ExchangeClient({ transport, wallet: account });
      const result = await exchange.withdraw3({ destination, amount });

      console.log(`Withdrew ${amount} USDC from HyperCore`);
      console.log(`  Destination: ${destination}`);
      printResult(result, format as OutputFormat);
      return;
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function printUsage() {
  console.log(
    "\nHyperliquid CLI (grimoire-hyperliquid)\n\nCommands:\n  mids [--format <json|table|spell>]\n  l2-book --coin <symbol> [--format <json|table|spell>]\n  open-orders --user <address> [--format <json|table|spell>]\n  meta [--format <json|table|spell>]\n  spot-meta [--format <json|table|spell>]\n  withdraw --amount <usdc> --keystore <path> [--password-env <var>] [--destination <addr>] [--format <json|table>]\n"
  );
}

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

export function printMidsSpellSnapshot(mids: MidsResponse): void {
  const entries = Object.entries(mids).sort(([a], [b]) => a.localeCompare(b));
  const assets = entries.map(([asset]) => asset);
  const prices = entries.map(([, price]) => toNumber(price));

  const lines = createSnapshotLines(["grimoire venue hyperliquid mids"]);
  pushArray(lines, "mid_assets", assets, formatString);
  pushArray(lines, "mid_prices", prices, formatNumber);
  console.log(lines.join("\n"));
}

export function printL2BookSpellSnapshot(book: L2BookResponse, options: { coin: string }): void {
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
    bids.map((level) => toNumber(level.px)),
    formatNumber
  );
  pushArray(
    lines,
    "l2_bids_sz",
    bids.map((level) => toNumber(level.sz)),
    formatNumber
  );
  pushArray(
    lines,
    "l2_bids_n",
    bids.map((level) => level.n),
    formatNumber
  );
  pushArray(
    lines,
    "l2_asks_px",
    asks.map((level) => toNumber(level.px)),
    formatNumber
  );
  pushArray(
    lines,
    "l2_asks_sz",
    asks.map((level) => toNumber(level.sz)),
    formatNumber
  );
  pushArray(
    lines,
    "l2_asks_n",
    asks.map((level) => level.n),
    formatNumber
  );

  console.log(lines.join("\n"));
}

export function printOpenOrdersSpellSnapshot(orders: OpenOrder[], options: { user: string }): void {
  const lines = createSnapshotLines([
    "grimoire venue hyperliquid open-orders",
    `--user ${options.user}`,
  ]);

  pushArray(
    lines,
    "open_order_coins",
    orders.map((order) => order.coin),
    formatString
  );
  pushArray(
    lines,
    "open_order_sides",
    orders.map((order) => order.side),
    formatString
  );
  pushArray(
    lines,
    "open_order_limit_px",
    orders.map((order) => toNumber(order.limitPx)),
    formatNumber
  );
  pushArray(
    lines,
    "open_order_sizes",
    orders.map((order) => toNumber(order.sz)),
    formatNumber
  );
  pushArray(
    lines,
    "open_order_ids",
    orders.map((order) => order.oid),
    formatNumber
  );
  pushArray(
    lines,
    "open_order_timestamps",
    orders.map((order) => order.timestamp),
    formatNumber
  );
  pushArray(
    lines,
    "open_order_orig_sizes",
    orders.map((order) => toNumber(order.origSz)),
    formatNumber
  );
  pushArray(
    lines,
    "open_order_reduce_only",
    orders.map((order) => Boolean(order.reduceOnly)),
    formatBoolean
  );
  pushArray(
    lines,
    "open_order_cloids",
    orders.map((order) => order.cloid ?? ""),
    formatString
  );

  console.log(lines.join("\n"));
}

export function printMetaSpellSnapshot(meta: MetaResponse): void {
  const universe = meta.universe ?? [];
  const lines = createSnapshotLines(["grimoire venue hyperliquid meta"]);

  pushArray(
    lines,
    "perp_universe_names",
    universe.map((item) => item.name),
    formatString
  );
  pushArray(
    lines,
    "perp_universe_sz_decimals",
    universe.map((item) => item.szDecimals),
    formatNumber
  );
  pushArray(
    lines,
    "perp_universe_max_leverage",
    universe.map((item) => item.maxLeverage),
    formatNumber
  );
  pushArray(
    lines,
    "perp_universe_margin_table_id",
    universe.map((item) => item.marginTableId),
    formatNumber
  );
  pushArray(
    lines,
    "perp_universe_only_isolated",
    universe.map((item) => Boolean(item.onlyIsolated)),
    formatBoolean
  );
  pushArray(
    lines,
    "perp_universe_is_delisted",
    universe.map((item) => Boolean(item.isDelisted)),
    formatBoolean
  );
  pushArray(
    lines,
    "perp_universe_margin_mode",
    universe.map((item) => item.marginMode ?? ""),
    formatString
  );
  pushArray(
    lines,
    "perp_universe_growth_mode",
    universe.map((item) => item.growthMode ?? ""),
    formatString
  );

  console.log(lines.join("\n"));
}

export function printSpotMetaSpellSnapshot(meta: SpotMetaResponse): void {
  const tokens = meta.tokens ?? [];
  const universe = meta.universe ?? [];
  const lines = createSnapshotLines(["grimoire venue hyperliquid spot-meta"]);

  pushArray(
    lines,
    "spot_token_names",
    tokens.map((token) => token.name),
    formatString
  );
  pushArray(
    lines,
    "spot_token_indices",
    tokens.map((token) => token.index),
    formatNumber
  );
  pushArray(
    lines,
    "spot_token_ids",
    tokens.map((token) => token.tokenId),
    formatString
  );
  pushArray(
    lines,
    "spot_token_addresses",
    tokens.map((token) => token.evmContract?.address ?? ""),
    formatString
  );
  pushArray(
    lines,
    "spot_token_sz_decimals",
    tokens.map((token) => token.szDecimals),
    formatNumber
  );
  pushArray(
    lines,
    "spot_token_wei_decimals",
    tokens.map((token) => token.weiDecimals),
    formatNumber
  );
  pushArray(
    lines,
    "spot_token_is_canonical",
    tokens.map((token) => Boolean(token.isCanonical)),
    formatBoolean
  );
  pushArray(
    lines,
    "spot_universe_names",
    universe.map((item) => item.name),
    formatString
  );
  pushArray(
    lines,
    "spot_universe_indices",
    universe.map((item) => item.index),
    formatNumber
  );
  pushArray(
    lines,
    "spot_universe_is_canonical",
    universe.map((item) => item.isCanonical),
    formatBoolean
  );

  console.log(lines.join("\n"));
}

function createSnapshotLines(args: string[]): string[] {
  const snapshotAt = new Date().toISOString();
  const snapshotSource = args.join(" ");
  const lines: string[] = [];
  lines.push("params:");
  lines.push(`  snapshot_at: \"${snapshotAt}\"`);
  lines.push(`  snapshot_source: \"${snapshotSource}\"`);
  return lines;
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
