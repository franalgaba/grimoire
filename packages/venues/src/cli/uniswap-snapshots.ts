import type { PoolRow, TokenListEntry } from "./uniswap-pools.js";

// --- Types ---

type TokenSnapshotOptions = {
  chain?: number;
  symbol?: string;
  address?: string;
  source: string;
};

type PoolSnapshotOptions = {
  chain: number;
  token0: string;
  token1: string;
  feeTier?: number;
  limit: number;
  source: string;
  graphKey?: string;
  endpoint?: string;
  subgraphId?: string;
  rpcUrl?: string;
  factory?: string;
};

// --- Snapshot builders ---

export function buildTokensSnapshot(
  tokens: TokenListEntry[],
  options: TokenSnapshotOptions
): string {
  const snapshotAt = new Date().toISOString();
  const args: string[] = ["grimoire venue uniswap tokens"];
  if (options.chain) args.push(`--chain ${options.chain}`);
  if (options.symbol) args.push(`--symbol ${options.symbol}`);
  if (options.address) args.push(`--address ${options.address}`);
  if (options.source) args.push(`--source ${options.source}`);

  const lines: string[] = [];
  lines.push("params:");
  lines.push(`  snapshot_at: "${snapshotAt}"`);
  lines.push(`  snapshot_source: "${args.join(" ")}"`);

  pushArrayLines(
    lines,
    "token_symbols",
    tokens.map((t) => t.symbol),
    (v) => `"${v}"`
  );
  pushArrayLines(
    lines,
    "token_addresses",
    tokens.map((t) => t.address),
    (v) => `"${v}"`
  );
  pushArrayLines(
    lines,
    "token_decimals",
    tokens.map((t) => (typeof t.decimals === "number" ? t.decimals : 0)),
    String
  );
  pushArrayLines(
    lines,
    "token_chain_ids",
    tokens.map((t) => t.chainId),
    String
  );

  return lines.join("\n");
}

export function buildPoolsSnapshot(pools: PoolRow[], options: PoolSnapshotOptions): string {
  const snapshotAt = new Date().toISOString();
  const args: string[] = [
    "grimoire venue uniswap pools",
    `--chain ${options.chain}`,
    `--token0 ${options.token0}`,
    `--token1 ${options.token1}`,
  ];
  if (options.feeTier !== undefined) args.push(`--fee ${options.feeTier}`);
  if (options.limit) args.push(`--limit ${options.limit}`);
  if (options.source) args.push(`--source ${options.source}`);
  if (options.endpoint) args.push(`--endpoint ${options.endpoint}`);
  if (options.graphKey) args.push("--graph-key $GRAPH_API_KEY");
  if (options.subgraphId) args.push(`--subgraph-id ${options.subgraphId}`);
  if (options.rpcUrl) args.push("--rpc-url $RPC_URL");
  if (options.factory) args.push(`--factory ${options.factory}`);

  const lines: string[] = [];
  lines.push("params:");
  lines.push(`  snapshot_at: "${snapshotAt}"`);
  lines.push(`  snapshot_source: "${args.join(" ")}"`);

  pushArrayLines(
    lines,
    "pool_addresses",
    pools.map((p) => p.pool),
    (v) => `"${v}"`
  );
  pushArrayLines(
    lines,
    "pool_fee_tiers",
    pools.map((p) => p.feeTier),
    String
  );
  pushArrayLines(
    lines,
    "pool_token0",
    pools.map((p) => p.token0),
    (v) => `"${v}"`
  );
  pushArrayLines(
    lines,
    "pool_token1",
    pools.map((p) => p.token1),
    (v) => `"${v}"`
  );
  pushArrayLines(
    lines,
    "pool_token0_symbols",
    pools.map((p) => p.token0Symbol),
    (v) => `"${v}"`
  );
  pushArrayLines(
    lines,
    "pool_token1_symbols",
    pools.map((p) => p.token1Symbol),
    (v) => `"${v}"`
  );
  pushArrayLines(
    lines,
    "pool_liquidity",
    pools.map((p) => p.liquidity),
    (v) => `"${v}"`
  );
  pushArrayLines(
    lines,
    "pool_volume_usd",
    pools.map((p) => p.volumeUSD),
    (v) => `"${v}"`
  );

  return lines.join("\n");
}

function pushArrayLines<T>(lines: string[], key: string, values: T[], fmt: (v: T) => string): void {
  lines.push(`  ${key}: [`);
  for (const value of values) {
    lines.push(`    ${fmt(value)},`);
  }
  lines.push("  ]");
}
