#!/usr/bin/env node

import { getChainAddresses } from "@morpho-org/blue-sdk";
import { createMorphoBlueAdapter } from "../morpho-blue.js";
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
      const adapter = createMorphoBlueAdapter({ markets: [] });
      printResult(adapter.meta, format);
      return;
    }
    case "addresses": {
      const format = (getOption(options, "format") ?? "auto") as OutputFormat;
      const chain = Number.parseInt(getOption(options, "chain") ?? "1", 10);
      const addresses = getChainAddresses(chain);
      printResult(addresses, format);
      return;
    }
    case "vaults": {
      const format = getOption(options, "format") ?? "auto";
      const chain = Number.parseInt(getOption(options, "chain") ?? "1", 10);
      const asset = getOption(options, "asset");
      const minTvl = Number.parseFloat(getOption(options, "min-tvl") ?? "0");
      const minApy = Number.parseFloat(getOption(options, "min-apy") ?? "nan");
      const minNetApy = Number.parseFloat(getOption(options, "min-net-apy") ?? "nan");
      const sort = getOption(options, "sort") ?? "netApy";
      const order = (getOption(options, "order") ?? "desc").toLowerCase();
      const limit = Number.parseInt(getOption(options, "limit") ?? "50", 10);

      const where: Record<string, unknown> = {
        chainId_in: [chain],
      };

      if (asset) {
        where.assetSymbol_in = [asset.toUpperCase()];
      }
      if (!Number.isNaN(minTvl) && minTvl > 0) {
        where.totalAssetsUsd_gte = minTvl;
      }

      const data = await fetchMorphoVaults({ first: limit, where });
      let items = data?.vaults?.items ?? [];

      if (!Number.isNaN(minApy)) {
        items = items.filter((item) => (item.state?.apy ?? 0) >= minApy);
      }
      if (!Number.isNaN(minNetApy)) {
        items = items.filter((item) => (item.state?.netApy ?? 0) >= minNetApy);
      }

      const rows = items.map((item) => ({
        name: item.name,
        symbol: item.symbol,
        address: item.address,
        chainId: item.chain?.id ?? chain,
        asset: item.asset?.symbol ?? "",
        netApy: item.state?.netApy ?? null,
        apy: item.state?.apy ?? null,
        totalAssetsUsd: item.state?.totalAssetsUsd ?? null,
      }));

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
        const leftValue = a[sortKey as keyof typeof a];
        const rightValue = b[sortKey as keyof typeof b];

        if (typeof leftValue === "string" && typeof rightValue === "string") {
          return leftValue.localeCompare(rightValue) * direction;
        }

        const left = typeof leftValue === "number" ? leftValue : 0;
        const right = typeof rightValue === "number" ? rightValue : 0;
        return (left - right) * direction;
      });

      const limited = rows.slice(0, limit);

      if (format === "spell") {
        printSpellSnapshot(limited, {
          chain,
          asset,
          minTvl,
          minApy,
          minNetApy,
          sort,
          order,
          limit,
        });
        return;
      }

      printResult(limited, format as OutputFormat);
      return;
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function printUsage() {
  console.log(
    "\nMorpho Blue CLI (grimoire-morpho-blue)\n\nCommands:\n  info [--format <json|table>]\n  addresses [--chain <id>] [--format <json|table>]\n  vaults [--chain <id>] [--asset <symbol>] [--min-tvl <usd>] [--min-apy <decimal>] [--min-net-apy <decimal>] [--sort <field>] [--order <asc|desc>] [--limit <n>] [--format <json|table|spell>]\n"
  );
}

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

  const response = await fetch("https://blue-api.morpho.org/graphql", {
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

type VaultSnapshotRow = {
  name: string;
  symbol: string;
  address: string;
  chainId: number;
  asset: string;
  netApy: number | null;
  apy: number | null;
  totalAssetsUsd: number | null;
};

type SnapshotOptions = {
  chain: number;
  asset?: string;
  minTvl: number;
  minApy: number;
  minNetApy: number;
  sort: string;
  order: string;
  limit: number;
};

function printSpellSnapshot(rows: VaultSnapshotRow[], options: SnapshotOptions): void {
  const snapshotAt = new Date().toISOString();
  const args: string[] = ["grimoire venue morpho-blue vaults"];

  if (options.chain) args.push(`--chain ${options.chain}`);
  if (options.asset) args.push(`--asset ${options.asset}`);
  if (!Number.isNaN(options.minTvl) && options.minTvl > 0) args.push(`--min-tvl ${options.minTvl}`);
  if (!Number.isNaN(options.minApy)) args.push(`--min-apy ${options.minApy}`);
  if (!Number.isNaN(options.minNetApy)) args.push(`--min-net-apy ${options.minNetApy}`);
  if (options.sort) args.push(`--sort ${options.sort}`);
  if (options.order) args.push(`--order ${options.order}`);
  if (options.limit) args.push(`--limit ${options.limit}`);

  const snapshotSource = args.join(" ");

  const lines: string[] = [];
  lines.push("params:");
  lines.push(`  snapshot_at: "${snapshotAt}"`);
  lines.push(`  snapshot_source: "${snapshotSource}"`);

  const names = rows.map((row) => row.name ?? "");
  const addresses = rows.map((row) => row.address ?? "");
  const netApys = rows.map((row) => (row.netApy ?? 0).toString());
  const tvls = rows.map((row) => (row.totalAssetsUsd ?? 0).toString());

  lines.push("  vault_names: [");
  for (const name of names) {
    lines.push(`    "${name}",`);
  }
  lines.push("  ]");

  lines.push("  vault_addresses: [");
  for (const address of addresses) {
    lines.push(`    "${address}",`);
  }
  lines.push("  ]");

  lines.push("  vault_net_apys: [");
  for (const apy of netApys) {
    lines.push(`    ${apy},`);
  }
  lines.push("  ]");

  lines.push("  vault_tvl_usd: [");
  for (const tvl of tvls) {
    lines.push(`    ${tvl},`);
  }
  lines.push("  ]");

  console.log(lines.join("\n"));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
