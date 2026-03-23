import { createProvider } from "@grimoirelabs/core";
import { parseAbi } from "viem";
import { defaultUniswapV3Factories } from "../adapters/uniswap-v3.js";
import { fetchTokenList } from "./uniswap.js";

const FACTORY_ABI = parseAbi(["function getPool(address,address,uint24) view returns (address)"]);
const POOL_ABI = parseAbi(["function liquidity() view returns (uint128)"]);
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEFAULT_FEES = [500, 3000, 10000];

// --- Types ---

export type TokenListEntry = {
  chainId: number;
  address: string;
  symbol: string;
  name?: string;
  decimals?: number;
};

export type PoolRow = {
  pool: string;
  feeTier: number;
  token0: string;
  token1: string;
  token0Symbol: string;
  token1Symbol: string;
  liquidity: string;
  volumeUSD: string;
};

type TokenInfo = {
  address: string;
  symbol: string;
};

export type PoolOptions = {
  chain: number;
  token0: string;
  token1: string;
  fee?: number;
  limit: number;
  source: string;
  endpoint?: string;
  subgraphId?: string;
  factory?: string;
};

type FetchPoolsOnchainOptions = {
  chainId: number;
  rpcUrl: string;
  factory: string;
  token0: TokenInfo;
  token1: TokenInfo;
  feeTier?: number;
};

type PoolsEndpointOptions = {
  graphKey?: string;
  endpoint?: string;
  subgraphId?: string;
};

// --- Token resolution ---

async function resolveTokenInfo(
  input: string,
  chainId: number,
  source: string
): Promise<TokenInfo> {
  if (input.startsWith("0x")) {
    const tokens = await fetchTokenList(source);
    const match = tokens.find(
      (t) => t.chainId === chainId && t.address.toLowerCase() === input.toLowerCase()
    );
    return { address: input.toLowerCase(), symbol: match?.symbol ?? input };
  }

  const tokens = await fetchTokenList(source);
  const match = tokens.find(
    (t) => t.chainId === chainId && t.symbol.toLowerCase() === input.toLowerCase()
  );
  if (!match) throw new Error(`Token symbol not found in list: ${input}`);
  return { address: match.address.toLowerCase(), symbol: match.symbol };
}

// --- Pool fetching ---

export async function fetchPoolsWithFallback(
  options: PoolOptions,
  graphKey?: string,
  rpcUrl?: string
): Promise<PoolRow[]> {
  const { pools } = await fetchPoolsWithFallbackMeta(options, graphKey, rpcUrl);
  return pools;
}

export async function fetchPoolsWithFallbackMeta(
  options: PoolOptions,
  graphKey?: string,
  rpcUrl?: string
): Promise<{ pools: PoolRow[]; usedRpc: boolean; resolvedFactory?: string }> {
  const token0Info = await resolveTokenInfo(options.token0, options.chain, options.source);
  const token1Info = await resolveTokenInfo(options.token1, options.chain, options.source);
  const envGraphKey = graphKey ?? process.env.GRAPH_API_KEY;
  const hasGraphConfig = Boolean(
    options.endpoint || envGraphKey || options.subgraphId || V3_SUBGRAPH_IDS[options.chain]
  );

  if (rpcUrl && !hasGraphConfig) {
    const resolvedFactory = options.factory ?? defaultUniswapV3Factories[options.chain];
    if (!resolvedFactory) {
      throw new Error(
        `No factory configured for chain ${options.chain}. Provide --factory to use RPC mode.`
      );
    }
    const pools = await fetchPoolsOnchain({
      chainId: options.chain,
      rpcUrl,
      factory: resolvedFactory,
      token0: token0Info,
      token1: token1Info,
      feeTier: options.fee,
    });
    return { pools, usedRpc: true, resolvedFactory };
  }

  try {
    const graphEndpoint = resolvePoolsEndpoint(options.chain, {
      endpoint: options.endpoint,
      graphKey,
      subgraphId: options.subgraphId,
    });
    const pools = await fetchPoolsFromGraph(
      graphEndpoint,
      token0Info.address,
      token1Info.address,
      options.fee,
      options.limit
    );
    return { pools, usedRpc: false };
  } catch (error) {
    if (!rpcUrl) throw error;
    const resolvedFactory = options.factory ?? defaultUniswapV3Factories[options.chain];
    if (!resolvedFactory) {
      throw new Error(
        `No factory configured for chain ${options.chain}. Provide --factory to use RPC mode.`
      );
    }
    const pools = await fetchPoolsOnchain({
      chainId: options.chain,
      rpcUrl,
      factory: resolvedFactory,
      token0: token0Info,
      token1: token1Info,
      feeTier: options.fee,
    });
    return { pools, usedRpc: true, resolvedFactory };
  }
}

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
      /* liquidity read failed — default to "0" */
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

/** V3 subgraph IDs on The Graph decentralized network (per chain). */
const V3_SUBGRAPH_IDS: Record<number, string> = {
  1: "5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV",
  10: "Cghf4LfVqPiFw6fp6Y5X5Ubc8UpmUhSfJL82zwiBFLaj",
  137: "3hCPRGf4z88VC5rsBKU5AA9FBBq5nF3jbKJG7VZCbhjm",
  8453: "43Hwfi3dJSoGpyas9VwNoDAv55yjgGrPpNSmbQZArzMG",
  42161: "FbCGRftH4a3yZugY7TnbYgPJVEv2LvMT6oF1fxPe9aJM",
};

function resolvePoolsEndpoint(chainId: number, options: PoolsEndpointOptions): string {
  if (options.endpoint) return options.endpoint;

  const subgraphId = options.subgraphId ?? V3_SUBGRAPH_IDS[chainId];
  const graphKey = options.graphKey ?? process.env.GRAPH_API_KEY;

  if (subgraphId && graphKey) {
    return `https://gateway.thegraph.com/api/${graphKey}/subgraphs/id/${subgraphId}`;
  }

  if (subgraphId && !graphKey) {
    throw new Error(
      `Subgraph available for chain ${chainId} but no API key. Set GRAPH_API_KEY or provide --graph-key (get one at https://thegraph.com/studio/apikeys/).`
    );
  }

  throw new Error(
    `No subgraph ID known for chain ${chainId}. Provide --endpoint, --subgraph-id + --graph-key, or use --rpc-url for on-chain pool lookup.`
  );
}

function buildPoolsQuery(includeFee: boolean): string {
  if (includeFee) {
    return `
      query ($first: Int!, $token0: String!, $token1: String!, $feeTier: Int!) {
        pools(first: $first, where: { token0: $token0, token1: $token1, feeTier: $feeTier }) {
          id feeTier liquidity volumeUSD
          token0 { id symbol }
          token1 { id symbol }
        }
      }
    `;
  }
  return `
    query ($first: Int!, $token0: String!, $token1: String!) {
      pools(first: $first, where: { token0: $token0, token1: $token1 }) {
        id feeTier liquidity volumeUSD
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
    throw new Error(payload.errors.map((e) => e.message ?? "Unknown error").join("; "));
  }

  return (payload.data?.pools ?? []).map((pool) => ({
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

async function fetchPoolsFromGraph(
  endpoint: string,
  token0: string,
  token1: string,
  feeTier: number | undefined,
  limit: number
): Promise<PoolRow[]> {
  const includeFee = typeof feeTier === "number";
  const query = buildPoolsQuery(includeFee);

  const first = await requestPools(endpoint, query, { first: limit, token0, token1, feeTier });
  if (first.length > 0) return first;

  return requestPools(endpoint, query, { first: limit, token0: token1, token1: token0, feeTier });
}
