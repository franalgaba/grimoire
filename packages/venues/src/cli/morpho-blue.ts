#!/usr/bin/env node

import { getChainAddresses } from "@morpho-org/blue-sdk";
import { Cli, z } from "incur";
import { createMorphoBlueAdapter } from "../adapters/morpho-blue/index.js";

const DEFAULT_CHAIN_ID = 1;
const MORPHO_GRAPHQL_ENDPOINT = "https://blue-api.morpho.org/graphql" as const;

const cli = Cli.create("grimoire-morpho-blue", {
  description: "Morpho Blue vault data — addresses, vaults, and APY rankings",
  sync: {
    suggestions: ["find high-yield USDC vaults on Base", "list morpho blue contract addresses"],
  },
})
  .use(async (c, next) => {
    const start = performance.now();
    await next();
    if (!c.agent) console.error(`Done in ${(performance.now() - start).toFixed(0)}ms`);
  })
  .command("info", {
    description: "Show adapter metadata",
    run(c) {
      const adapter = createMorphoBlueAdapter({ markets: [] });
      return c.ok(adapter.meta, { cta: { commands: ["addresses", "vaults"] } });
    },
  })
  .command("addresses", {
    description: "Show Morpho Blue contract addresses for a chain",
    alias: { chain: "c" },
    options: z.object({
      chain: z.coerce.number().default(DEFAULT_CHAIN_ID).describe("Chain ID"),
    }),
    run(c) {
      return c.ok(getChainAddresses(c.options.chain), {
        cta: { commands: ["vaults --chain <id>"] },
      });
    },
  })
  .command("vaults", {
    description: "List vaults with filtering, sorting, and pagination",
    alias: { chain: "c", asset: "a", limit: "l" },
    examples: [
      {
        options: { chain: 8453, asset: "USDC", minTvl: 5000000 },
        description: "High-TVL USDC vaults on Base",
      },
    ],
    options: z.object({
      chain: z.coerce.number().default(DEFAULT_CHAIN_ID).describe("Chain ID"),
      asset: z.string().optional().describe("Filter by asset symbol (e.g. USDC)"),
      minTvl: z.coerce.number().default(0).describe("Minimum TVL in USD"),
      minApy: z.coerce.number().optional().describe("Minimum APY (decimal)"),
      minNetApy: z.coerce.number().optional().describe("Minimum net APY (decimal)"),
      sort: z
        .enum(["netApy", "apy", "tvl", "totalAssetsUsd", "name"])
        .default("netApy")
        .describe("Sort field"),
      order: z.enum(["asc", "desc"]).default("desc").describe("Sort order"),
      limit: z.coerce.number().default(50).describe("Maximum number of results"),
    }),
    async run(c) {
      const data = await fetchAndFilterVaults(c.options);
      return c.ok(data, { cta: { commands: ["vaults-snapshot"] } });
    },
  })
  .command("vaults-snapshot", {
    description: "Generate spell params snapshot for vaults",
    alias: { chain: "c", asset: "a", limit: "l" },
    examples: [
      { options: { chain: 8453, asset: "USDC" }, description: "USDC vault snapshot on Base" },
    ],
    outputPolicy: "agent-only" as const,
    options: z.object({
      chain: z.coerce.number().default(DEFAULT_CHAIN_ID).describe("Chain ID"),
      asset: z.string().optional().describe("Filter by asset symbol (e.g. USDC)"),
      minTvl: z.coerce.number().default(0).describe("Minimum TVL in USD"),
      minApy: z.coerce.number().optional().describe("Minimum APY (decimal)"),
      minNetApy: z.coerce.number().optional().describe("Minimum net APY (decimal)"),
      sort: z
        .enum(["netApy", "apy", "tvl", "totalAssetsUsd", "name"])
        .default("netApy")
        .describe("Sort field"),
      order: z.enum(["asc", "desc"]).default("desc").describe("Sort order"),
      limit: z.coerce.number().default(50).describe("Maximum number of results"),
    }),
    output: z.string(),
    async run(c) {
      const rows = await fetchAndFilterVaults(c.options);
      return buildVaultsSnapshot(rows, c.options);
    },
  });

cli.serve();

// --- Vault fetching and filtering ---

type VaultOptions = {
  chain: number;
  asset?: string;
  minTvl: number;
  minApy?: number;
  minNetApy?: number;
  sort: string;
  order: string;
  limit: number;
};

type VaultRow = {
  name: string;
  symbol: string;
  address: string;
  chainId: number;
  asset: string;
  netApy: number | null;
  apy: number | null;
  totalAssetsUsd: number | null;
};

async function fetchAndFilterVaults(options: VaultOptions): Promise<VaultRow[]> {
  const where: Record<string, unknown> = { chainId_in: [options.chain] };
  if (options.asset) where.assetSymbol_in = [options.asset.toUpperCase()];
  if (options.minTvl > 0) where.totalAssetsUsd_gte = options.minTvl;

  const data = await fetchMorphoVaults({ first: options.limit, where });
  let items = data?.vaults?.items ?? [];

  if (options.minApy !== undefined) {
    const minApy = options.minApy;
    items = items.filter((item) => (item.state?.apy ?? 0) >= minApy);
  }
  if (options.minNetApy !== undefined) {
    const minNetApy = options.minNetApy;
    items = items.filter((item) => (item.state?.netApy ?? 0) >= minNetApy);
  }

  const rows: VaultRow[] = items.map((item) => ({
    name: item.name,
    symbol: item.symbol,
    address: item.address,
    chainId: item.chain?.id ?? options.chain,
    asset: item.asset?.symbol ?? "",
    netApy: item.state?.netApy ?? null,
    apy: item.state?.apy ?? null,
    totalAssetsUsd: item.state?.totalAssetsUsd ?? null,
  }));

  sortVaultRows(rows, options.sort, options.order);
  return rows.slice(0, options.limit);
}

function sortVaultRows(rows: VaultRow[], sort: string, order: string): void {
  const sortKey =
    sort === "tvl" || sort === "totalAssetsUsd"
      ? "totalAssetsUsd"
      : sort === "apy"
        ? "apy"
        : sort === "name"
          ? "name"
          : "netApy";
  const direction = order === "asc" ? 1 : -1;

  rows.sort((a, b) => {
    const leftValue = a[sortKey as keyof VaultRow];
    const rightValue = b[sortKey as keyof VaultRow];

    if (typeof leftValue === "string" && typeof rightValue === "string") {
      return leftValue.localeCompare(rightValue) * direction;
    }

    const left = typeof leftValue === "number" ? leftValue : 0;
    const right = typeof rightValue === "number" ? rightValue : 0;
    return (left - right) * direction;
  });
}

// --- GraphQL ---

type MorphoVaultsResponse = {
  vaults?: {
    items?: Array<{
      address: string;
      name: string;
      symbol: string;
      state?: { netApy?: number; apy?: number; totalAssetsUsd?: number };
      asset?: { symbol?: string };
      chain?: { id?: number };
    }>;
  };
};

async function fetchMorphoVaults(
  variables: Record<string, unknown>
): Promise<MorphoVaultsResponse> {
  const query = `
    query ($first: Int!, $where: VaultFilters) {
      vaults(first: $first, where: $where) {
        items {
          address
          name
          symbol
          state { netApy apy totalAssetsUsd }
          asset { symbol }
          chain { id }
        }
      }
    }
  `;

  const response = await fetch(MORPHO_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Morpho API error: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as {
    data?: MorphoVaultsResponse;
    errors?: Array<{ message?: string }>;
  };

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message ?? "Unknown error").join("; "));
  }

  return payload.data ?? {};
}

// --- Spell snapshot ---

function buildVaultsSnapshot(rows: VaultRow[], options: VaultOptions): string {
  const snapshotAt = new Date().toISOString();
  const args: string[] = ["grimoire venue morpho-blue vaults"];

  if (options.chain) args.push(`--chain ${options.chain}`);
  if (options.asset) args.push(`--asset ${options.asset}`);
  if (options.minTvl > 0) args.push(`--min-tvl ${options.minTvl}`);
  if (options.minApy !== undefined) args.push(`--min-apy ${options.minApy}`);
  if (options.minNetApy !== undefined) args.push(`--min-net-apy ${options.minNetApy}`);
  if (options.sort) args.push(`--sort ${options.sort}`);
  if (options.order) args.push(`--order ${options.order}`);
  if (options.limit) args.push(`--limit ${options.limit}`);

  const lines: string[] = [];
  lines.push("params:");
  lines.push(`  snapshot_at: "${snapshotAt}"`);
  lines.push(`  snapshot_source: "${args.join(" ")}"`);

  pushArrayLines(
    lines,
    "vault_names",
    rows.map((r) => r.name ?? ""),
    (v) => `"${v}"`
  );
  pushArrayLines(
    lines,
    "vault_addresses",
    rows.map((r) => r.address ?? ""),
    (v) => `"${v}"`
  );
  pushArrayLines(
    lines,
    "vault_net_apys",
    rows.map((r) => (r.netApy ?? 0).toString()),
    (v) => v
  );
  pushArrayLines(
    lines,
    "vault_tvl_usd",
    rows.map((r) => (r.totalAssetsUsd ?? 0).toString()),
    (v) => v
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
