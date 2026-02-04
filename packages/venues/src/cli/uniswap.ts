#!/usr/bin/env node

import { createProvider } from "@grimoirelabs/core";
import { parseAbi } from "viem";
import {
  createUniswapV3Adapter,
  defaultUniswapV3Factories,
  defaultUniswapV3Routers,
} from "../uniswap-v3.js";
import { type OutputFormat, getOption, parseArgs, printResult } from "./utils.js";

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (!command || command === "help" || options.help) {
    printUsage();
    return;
  }

  switch (command) {
    case "info": {
      const format = (getOption(options, "format") ?? "auto") as OutputFormat;
      const adapter = createUniswapV3Adapter();
      printResult(adapter.meta, format);
      return;
    }
    case "routers": {
      const format = (getOption(options, "format") ?? "auto") as OutputFormat;
      const chain = getOption(options, "chain");
      if (chain) {
        const chainId = Number.parseInt(chain, 10);
        printResult({ chainId, router: defaultUniswapV3Routers[chainId] ?? null }, format);
        return;
      }
      printResult(defaultUniswapV3Routers, format);
      return;
    }
    case "tokens": {
      const format = getOption(options, "format") ?? "auto";
      const chain = getOption(options, "chain");
      const symbol = getOption(options, "symbol");
      const address = getOption(options, "address");
      const source = getOption(options, "source") ?? "https://tokens.uniswap.org";

      let tokens = await fetchTokenList(source);

      if (chain) {
        const chainId = Number.parseInt(chain, 10);
        tokens = tokens.filter((token) => token.chainId === chainId);
      }

      if (symbol) {
        const match = symbol.toLowerCase();
        tokens = tokens.filter(
          (token) => typeof token.symbol === "string" && token.symbol.toLowerCase() === match
        );
      }

      if (address) {
        const match = address.toLowerCase();
        tokens = tokens.filter((token) => token.address?.toLowerCase() === match);
      }

      if (format === "spell") {
        printTokensSpellSnapshot(tokens, {
          chain: chain ? Number.parseInt(chain, 10) : undefined,
          symbol,
          address,
          source,
        });
        return;
      }

      printResult(tokens, format as OutputFormat);
      return;
    }
    case "pools": {
      const format = getOption(options, "format") ?? "auto";
      const chain = Number.parseInt(getOption(options, "chain") ?? "1", 10);
      const token0Arg = getOption(options, "token0");
      const token1Arg = getOption(options, "token1");
      const fee = getOption(options, "fee");
      const graphKey = getOption(options, "graph-key") ?? process.env.GRAPH_API_KEY;
      const subgraphId = getOption(options, "subgraph-id");
      const endpoint = getOption(options, "endpoint");
      const rpcUrl = getOption(options, "rpc-url") ?? process.env.RPC_URL;
      const factory = getOption(options, "factory");
      const limit = Number.parseInt(getOption(options, "limit") ?? "10", 10);
      const source = getOption(options, "source") ?? "https://tokens.uniswap.org";

      if (!token0Arg || !token1Arg) {
        throw new Error("Missing required options --token0 and --token1");
      }
      const token0Info = await resolveTokenInfo(token0Arg, chain, source);
      const token1Info = await resolveTokenInfo(token1Arg, chain, source);
      const token0 = token0Info.address;
      const token1 = token1Info.address;
      const feeTier = fee ? Number.parseInt(fee, 10) : undefined;

      let pools: PoolRow[] = [];
      let usedRpc = false;
      let resolvedFactory: string | undefined;
      const hasGraphConfig = Boolean(endpoint || graphKey || subgraphId);

      if (rpcUrl && !hasGraphConfig) {
        resolvedFactory = factory ?? defaultUniswapV3Factories[chain];
        if (!resolvedFactory) {
          throw new Error(
            `No factory configured for chain ${chain}. Provide --factory to use RPC mode.`
          );
        }
        pools = await fetchPoolsOnchain({
          chainId: chain,
          rpcUrl,
          factory: resolvedFactory,
          token0: token0Info,
          token1: token1Info,
          feeTier,
        });
        usedRpc = true;
      } else {
        try {
          const graphEndpoint = resolvePoolsEndpoint(chain, {
            endpoint,
            graphKey,
            subgraphId,
          });
          pools = await fetchPools(graphEndpoint, token0, token1, feeTier, limit);
        } catch (error) {
          if (!rpcUrl) {
            throw error;
          }
          resolvedFactory = factory ?? defaultUniswapV3Factories[chain];
          if (!resolvedFactory) {
            throw new Error(
              `No factory configured for chain ${chain}. Provide --factory to use RPC mode.`
            );
          }
          pools = await fetchPoolsOnchain({
            chainId: chain,
            rpcUrl,
            factory: resolvedFactory,
            token0: token0Info,
            token1: token1Info,
            feeTier,
          });
          usedRpc = true;
        }
      }

      if (format === "spell") {
        printPoolsSpellSnapshot(pools, {
          chain,
          token0: token0Arg,
          token1: token1Arg,
          feeTier,
          limit,
          source,
          endpoint: usedRpc ? undefined : endpoint,
          graphKey: usedRpc ? undefined : graphKey ? "(env)" : undefined,
          subgraphId: usedRpc ? undefined : subgraphId,
          rpcUrl: usedRpc ? "(env)" : undefined,
          factory: usedRpc ? (resolvedFactory ?? factory) : undefined,
        });
        return;
      }

      printResult(pools, format as OutputFormat);
      return;
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function printUsage() {
  console.log(
    "\nUniswap CLI (grimoire-uniswap)\n\nCommands:\n  info [--format <json|table>]\n  routers [--chain <id>] [--format <json|table>]\n  tokens [--chain <id>] [--symbol <sym>] [--address <addr>] [--source <url>] [--format <json|table|spell>]\n  pools --chain <id> --token0 <address|symbol> --token1 <address|symbol> [--fee <bps>] [--limit <n>] [--source <url>] [--format <json|table|spell>] [--endpoint <url>] [--graph-key <key>] [--subgraph-id <id>] [--rpc-url <url>] [--factory <address>]\n"
  );
}

type TokenListEntry = {
  chainId: number;
  address: string;
  symbol: string;
  name?: string;
  decimals?: number;
};

type PoolRow = {
  pool: string;
  feeTier: number;
  token0: string;
  token1: string;
  token0Symbol: string;
  token1Symbol: string;
  liquidity: string;
  volumeUSD: string;
};

async function fetchTokenList(source: string): Promise<TokenListEntry[]> {
  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`Token list fetch failed: ${response.status} ${response.statusText}`);
  }

  const list = (await response.json()) as { tokens?: TokenListEntry[] };
  return list.tokens ?? [];
}

async function fetchPools(
  endpoint: string,
  token0: string,
  token1: string,
  feeTier: number | undefined,
  limit: number
): Promise<PoolRow[]> {
  const includeFee = typeof feeTier === "number";
  const query = buildPoolsQuery(includeFee);

  const first = await requestPools(endpoint, query, {
    first: limit,
    token0,
    token1,
    feeTier,
  });

  if (first.length > 0) return first;

  const second = await requestPools(endpoint, query, {
    first: limit,
    token0: token1,
    token1: token0,
    feeTier,
  });

  return second;
}

type TokenInfo = {
  address: string;
  symbol: string;
};

async function resolveTokenInfo(
  input: string,
  chainId: number,
  source: string
): Promise<TokenInfo> {
  if (input.startsWith("0x")) {
    const tokens = await fetchTokenList(source);
    const match = tokens.find(
      (token) => token.chainId === chainId && token.address.toLowerCase() === input.toLowerCase()
    );
    return { address: input.toLowerCase(), symbol: match?.symbol ?? input };
  }

  const tokens = await fetchTokenList(source);
  const match = tokens.find(
    (token) => token.chainId === chainId && token.symbol.toLowerCase() === input.toLowerCase()
  );
  if (!match) {
    throw new Error(`Token symbol not found in list: ${input}`);
  }
  return { address: match.address.toLowerCase(), symbol: match.symbol };
}

const FACTORY_ABI = parseAbi(["function getPool(address,address,uint24) view returns (address)"]);
const POOL_ABI = parseAbi(["function liquidity() view returns (uint128)"]);
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEFAULT_FEES = [500, 3000, 10000];

type FetchPoolsOnchainOptions = {
  chainId: number;
  rpcUrl: string;
  factory: string;
  token0: TokenInfo;
  token1: TokenInfo;
  feeTier?: number;
};

async function fetchPoolsOnchain(options: FetchPoolsOnchainOptions): Promise<PoolRow[]> {
  const provider = createProvider(options.chainId, options.rpcUrl);
  const fees = options.feeTier ? [options.feeTier] : DEFAULT_FEES;
  const [token0Addr, token1Addr] = sortAddresses(options.token0.address, options.token1.address);

  const pools: PoolRow[] = [];
  for (const fee of fees) {
    const poolAddress = await provider.readContract<string>({
      address: options.factory as `0x${string}`,
      abi: FACTORY_ABI,
      functionName: "getPool",
      args: [token0Addr, token1Addr, fee],
    });

    if (!poolAddress || poolAddress === ZERO_ADDRESS) continue;

    let liquidity = "0";
    try {
      const poolLiquidity = await provider.readContract<bigint>({
        address: poolAddress as `0x${string}`,
        abi: POOL_ABI,
        functionName: "liquidity",
      });
      liquidity = poolLiquidity.toString();
    } catch {
      liquidity = "0";
    }

    pools.push({
      pool: poolAddress,
      feeTier: fee,
      token0: token0Addr,
      token1: token1Addr,
      token0Symbol: options.token0.symbol,
      token1Symbol: options.token1.symbol,
      liquidity,
      volumeUSD: "0",
    });
  }

  return pools;
}

function sortAddresses(a: string, b: string): [string, string] {
  return a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
}

type PoolsEndpointOptions = {
  graphKey?: string;
  endpoint?: string;
  subgraphId?: string;
};

function resolvePoolsEndpoint(chainId: number, options: PoolsEndpointOptions): string {
  if (options.endpoint) return options.endpoint;

  if (options.graphKey || options.subgraphId) {
    if (!options.graphKey || !options.subgraphId) {
      throw new Error("Both --graph-key and --subgraph-id are required to use The Graph gateway.");
    }
    return `https://gateway.thegraph.com/api/${options.graphKey}/subgraphs/id/${options.subgraphId}`;
  }

  if (chainId === 1) {
    return "https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3";
  }

  throw new Error(
    "Missing endpoint for this chain. Provide --endpoint or use --graph-key + --subgraph-id."
  );
}

function buildPoolsQuery(includeFee: boolean): string {
  if (includeFee) {
    return `
      query ($first: Int!, $token0: String!, $token1: String!, $feeTier: Int!) {
        pools(first: $first, where: { token0: $token0, token1: $token1, feeTier: $feeTier }) {
          id
          feeTier
          liquidity
          volumeUSD
          token0 { id symbol }
          token1 { id symbol }
        }
      }
    `;
  }

  return `
    query ($first: Int!, $token0: String!, $token1: String!) {
      pools(first: $first, where: { token0: $token0, token1: $token1 }) {
        id
        feeTier
        liquidity
        volumeUSD
        token0 { id symbol }
        token1 { id symbol }
      }
    }
  `;
}

async function requestPools(
  endpoint: string,
  query: string,
  variables: Record<string, unknown>
): Promise<PoolRow[]> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Uniswap subgraph error: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as {
    data?: {
      pools?: Array<{
        id: string;
        feeTier: string;
        liquidity: string;
        volumeUSD: string;
        token0: { id: string; symbol: string };
        token1: { id: string; symbol: string };
      }>;
    };
    errors?: Array<{ message?: string }>;
  };

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message ?? "Unknown error").join("; "));
  }

  const pools = payload.data?.pools ?? [];
  return pools.map((pool) => ({
    pool: pool.id,
    feeTier: Number.parseInt(pool.feeTier, 10),
    token0: pool.token0.id,
    token1: pool.token1.id,
    token0Symbol: pool.token0.symbol,
    token1Symbol: pool.token1.symbol,
    liquidity: pool.liquidity,
    volumeUSD: pool.volumeUSD,
  }));
}

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

function printPoolsSpellSnapshot(pools: PoolRow[], options: PoolSnapshotOptions): void {
  const snapshotAt = new Date().toISOString();
  const args: string[] = [
    "grimoire venue uniswap pools",
    `--chain ${options.chain}`,
    `--token0 ${options.token0}`,
    `--token1 ${options.token1}`,
  ];
  if (options.feeTier !== undefined) {
    args.push(`--fee ${options.feeTier}`);
  }
  if (options.limit) {
    args.push(`--limit ${options.limit}`);
  }
  if (options.source) {
    args.push(`--source ${options.source}`);
  }
  if (options.endpoint) {
    args.push(`--endpoint ${options.endpoint}`);
  }
  if (options.graphKey) {
    args.push("--graph-key $GRAPH_API_KEY");
  }
  if (options.subgraphId) {
    args.push(`--subgraph-id ${options.subgraphId}`);
  }
  if (options.rpcUrl) {
    args.push("--rpc-url $RPC_URL");
  }
  if (options.factory) {
    args.push(`--factory ${options.factory}`);
  }
  const snapshotSource = args.join(" ");

  const lines: string[] = [];
  lines.push("params:");
  lines.push(`  snapshot_at: "${snapshotAt}"`);
  lines.push(`  snapshot_source: "${snapshotSource}"`);

  lines.push("  pool_addresses: [");
  for (const pool of pools) {
    lines.push(`    "${pool.pool}",`);
  }
  lines.push("  ]");

  lines.push("  pool_fee_tiers: [");
  for (const pool of pools) {
    lines.push(`    ${pool.feeTier},`);
  }
  lines.push("  ]");

  lines.push("  pool_token0: [");
  for (const pool of pools) {
    lines.push(`    "${pool.token0}",`);
  }
  lines.push("  ]");

  lines.push("  pool_token1: [");
  for (const pool of pools) {
    lines.push(`    "${pool.token1}",`);
  }
  lines.push("  ]");

  lines.push("  pool_token0_symbols: [");
  for (const pool of pools) {
    lines.push(`    "${pool.token0Symbol}",`);
  }
  lines.push("  ]");

  lines.push("  pool_token1_symbols: [");
  for (const pool of pools) {
    lines.push(`    "${pool.token1Symbol}",`);
  }
  lines.push("  ]");

  lines.push("  pool_liquidity: [");
  for (const pool of pools) {
    lines.push(`    "${pool.liquidity}",`);
  }
  lines.push("  ]");

  lines.push("  pool_volume_usd: [");
  for (const pool of pools) {
    lines.push(`    "${pool.volumeUSD}",`);
  }
  lines.push("  ]");

  console.log(lines.join("\n"));
}

type TokenSnapshotOptions = {
  chain?: number;
  symbol?: string;
  address?: string;
  source: string;
};

function printTokensSpellSnapshot(tokens: TokenListEntry[], options: TokenSnapshotOptions): void {
  const snapshotAt = new Date().toISOString();
  const args: string[] = ["grimoire venue uniswap tokens"];
  if (options.chain) args.push(`--chain ${options.chain}`);
  if (options.symbol) args.push(`--symbol ${options.symbol}`);
  if (options.address) args.push(`--address ${options.address}`);
  if (options.source) args.push(`--source ${options.source}`);
  const snapshotSource = args.join(" ");

  const lines: string[] = [];
  lines.push("params:");
  lines.push(`  snapshot_at: "${snapshotAt}"`);
  lines.push(`  snapshot_source: "${snapshotSource}"`);

  lines.push("  token_symbols: [");
  for (const token of tokens) {
    lines.push(`    "${token.symbol}",`);
  }
  lines.push("  ]");

  lines.push("  token_addresses: [");
  for (const token of tokens) {
    lines.push(`    "${token.address}",`);
  }
  lines.push("  ]");

  lines.push("  token_decimals: [");
  for (const token of tokens) {
    const decimals = typeof token.decimals === "number" ? token.decimals : 0;
    lines.push(`    ${decimals},`);
  }
  lines.push("  ]");

  lines.push("  token_chain_ids: [");
  for (const token of tokens) {
    lines.push(`    ${token.chainId},`);
  }
  lines.push("  ]");

  console.log(lines.join("\n"));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
