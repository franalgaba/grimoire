#!/usr/bin/env node

import { AaveClient, chainId, evmAddress } from "@aave/client";
import { chains, health, market, markets, reserve } from "@aave/client/actions";
import { Cli, z } from "incur";

const DEFAULT_CHAIN_ID = 1;

const cli = Cli.create("grimoire-aave", {
  description: "Aave V3 market data — health, chains, markets, and reserves",
  vars: z.object({ aaveClient: z.custom<ReturnType<typeof AaveClient.create>>() }),
  sync: { suggestions: ["check aave protocol health", "list aave reserves for USDC on Ethereum"] },
})
  .use(async (c, next) => {
    c.set("aaveClient", AaveClient.create());
    const start = performance.now();
    await next();
    if (!c.agent) console.error(`Done in ${(performance.now() - start).toFixed(0)}ms`);
  })
  .command("health", {
    description: "Check Aave protocol health",
    output: z.object({ healthy: z.boolean() }),
    async run(c) {
      const client = c.var.aaveClient;
      const result = await unwrapAaveResult(health(client));
      return c.ok({ healthy: Boolean(result) }, { cta: { commands: ["chains"] } });
    },
  })
  .command("chains", {
    description: "List supported chains",
    async run(c) {
      const client = c.var.aaveClient;
      const data = await unwrapAaveResult(chains(client));
      return c.ok(data, { cta: { commands: ["markets --chain <id>"] } });
    },
  })
  .command("markets", {
    description: "List markets for a chain",
    alias: { chain: "c" },
    examples: [{ options: { chain: 1 }, description: "Markets on Ethereum" }],
    options: z.object({
      chain: z.coerce.number().default(DEFAULT_CHAIN_ID).describe("Chain ID"),
      user: z.string().optional().describe("User address to include positions"),
    }),
    async run(c) {
      const client = c.var.aaveClient;
      const data = await unwrapAaveResult(
        markets(client, {
          chainIds: [chainId(c.options.chain)],
          user: c.options.user ? evmAddress(c.options.user) : undefined,
        })
      );
      return c.ok(data, { cta: { commands: ["market --chain <id> --address <addr>"] } });
    },
  })
  .command("market", {
    description: "Get details for a specific market",
    alias: { chain: "c" },
    options: z.object({
      chain: z.coerce.number().describe("Chain ID"),
      address: z.string().describe("Market address"),
      user: z.string().optional().describe("User address to include positions"),
    }),
    async run(c) {
      const client = c.var.aaveClient;
      const data = await unwrapAaveResult(
        market(client, {
          chainId: chainId(c.options.chain),
          address: evmAddress(c.options.address),
          user: c.options.user ? evmAddress(c.options.user) : undefined,
        })
      );
      return c.ok(data, {
        cta: { commands: ["reserve --chain <id> --market <addr> --token <addr>"] },
      });
    },
  })
  .command("reserve", {
    description: "Get details for a specific reserve",
    alias: { chain: "c" },
    options: z.object({
      chain: z.coerce.number().describe("Chain ID"),
      market: z.string().describe("Market address"),
      token: z.string().describe("Underlying token address"),
    }),
    async run(c) {
      const client = c.var.aaveClient;
      return unwrapAaveResult(
        reserve(client, {
          chainId: chainId(c.options.chain),
          market: evmAddress(c.options.market),
          underlyingToken: evmAddress(c.options.token),
        })
      );
    },
  })
  .command("reserves", {
    description: "List reserves for a market, optionally filtered by asset",
    alias: { chain: "c", asset: "a" },
    examples: [{ options: { chain: 1, asset: "USDC" }, description: "USDC reserves on Ethereum" }],
    options: z.object({
      chain: z.coerce.number().default(DEFAULT_CHAIN_ID).describe("Chain ID"),
      market: z.string().optional().describe("Market address (auto-detected if omitted)"),
      asset: z.string().optional().describe("Filter by symbol or address"),
    }),
    async run(c) {
      const client = c.var.aaveClient;
      const marketAddress = c.options.market ?? (await inferMarketAddress(client, c.options.chain));

      const result = await unwrapAaveResult(
        market(client, {
          chainId: chainId(c.options.chain),
          address: evmAddress(marketAddress),
        })
      );

      let reserves = extractReserves(result);

      if (c.options.asset) {
        const needle = c.options.asset.toLowerCase();
        reserves = reserves.filter((r) => matchReserveAsset(r, needle));
      }

      return c.ok(reserves, { cta: { commands: ["reserves-snapshot"] } });
    },
  })
  .command("reserves-snapshot", {
    description: "Generate spell params snapshot for reserves",
    alias: { chain: "c", asset: "a" },
    outputPolicy: "agent-only" as const,
    options: z.object({
      chain: z.coerce.number().default(DEFAULT_CHAIN_ID).describe("Chain ID"),
      market: z.string().optional().describe("Market address (auto-detected if omitted)"),
      asset: z.string().optional().describe("Filter by symbol or address"),
    }),
    output: z.string(),
    async run(c) {
      const client = c.var.aaveClient;
      const marketAddress = c.options.market ?? (await inferMarketAddress(client, c.options.chain));

      const result = await unwrapAaveResult(
        market(client, {
          chainId: chainId(c.options.chain),
          address: evmAddress(marketAddress),
        })
      );

      let reserves = extractReserves(result);

      if (c.options.asset) {
        const needle = c.options.asset.toLowerCase();
        reserves = reserves.filter((r) => matchReserveAsset(r, needle));
      }

      return buildReservesSnapshot(reserves, {
        chain: c.options.chain,
        marketAddress,
        asset: c.options.asset,
      });
    },
  });

cli.serve();

// --- Aave result unwrapping ---

type AaveResult<T> = {
  isErr?: () => boolean;
  error?: { message?: string };
  value?: T;
};

async function unwrapAaveResult<T>(
  result: Promise<AaveResult<T> | T> | AaveResult<T> | T
): Promise<T> {
  const resolved = await result;

  if (resolved && typeof resolved === "object" && "isErr" in resolved) {
    const aaveResult = resolved as AaveResult<T>;
    if (aaveResult.isErr?.()) {
      throw new Error(aaveResult.error?.message ?? "Aave request failed");
    }
    if (aaveResult.value !== undefined) {
      return aaveResult.value;
    }
  }

  return resolved as T;
}

// --- Market address inference ---

async function inferMarketAddress(
  client: ReturnType<typeof AaveClient.create>,
  chain: number
): Promise<string> {
  const marketsResult = await unwrapAaveResult(markets(client, { chainIds: [chainId(chain)] }));
  const address = pickMarketAddress(marketsResult);
  if (!address) {
    throw new Error("Missing --market and could not infer market address from markets");
  }
  return address;
}

type UnknownRecord = Record<string, unknown>;

function pickMarketAddress(marketsResult: unknown): string | null {
  if (Array.isArray(marketsResult)) {
    return extractAddress(marketsResult[0]);
  }
  if (marketsResult && typeof marketsResult === "object") {
    const record = marketsResult as UnknownRecord;
    const candidates = [record.markets, record.data];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) return extractAddress(candidate[0]);
    }
  }
  return null;
}

function extractAddress(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as UnknownRecord;
  const candidates = [record.address, record.marketAddress, record.market, record.id];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.startsWith("0x")) {
      return candidate;
    }
  }
  return null;
}

// --- Reserve extraction and matching ---

function extractReserves(result: unknown): UnknownRecord[] {
  if (Array.isArray(result)) {
    return result.filter((item) => item && typeof item === "object") as UnknownRecord[];
  }
  if (result && typeof result === "object") {
    const record = result as UnknownRecord;
    const candidates = [record.reserves, record.poolReserves, record.reservesData, record.data];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate.filter((item) => item && typeof item === "object") as UnknownRecord[];
      }
    }
  }
  return [];
}

function matchReserveAsset(reserveRecord: UnknownRecord, needle: string): boolean {
  const symbol = typeof reserveRecord.symbol === "string" ? reserveRecord.symbol.toLowerCase() : "";
  const underlying =
    typeof reserveRecord.underlyingToken === "string"
      ? reserveRecord.underlyingToken.toLowerCase()
      : "";
  const address =
    typeof reserveRecord.underlyingAsset === "string"
      ? reserveRecord.underlyingAsset.toLowerCase()
      : "";
  const id = typeof reserveRecord.id === "string" ? reserveRecord.id.toLowerCase() : "";
  return [symbol, underlying, address, id].some((value) => value === needle);
}

// --- Spell snapshot ---

type ReserveSnapshotOptions = {
  chain: number;
  marketAddress: string;
  asset?: string;
};

function buildReservesSnapshot(reserves: UnknownRecord[], options: ReserveSnapshotOptions): string {
  const snapshotAt = new Date().toISOString();
  const args: string[] = ["grimoire venue aave reserves", `--chain ${options.chain}`];

  if (options.marketAddress) args.push(`--market ${options.marketAddress}`);
  if (options.asset) args.push(`--asset ${options.asset}`);

  const snapshotSource = args.join(" ");

  const symbols = reserves.map((r) => getStringField(r, ["symbol", "assetSymbol"]));
  const addresses = reserves.map((r) =>
    getStringField(r, ["underlyingAsset", "underlyingToken", "address", "tokenAddress", "id"])
  );
  const supplyRates = reserves.map((r) =>
    getNumberField(r, ["liquidityRate", "supplyAPY", "supplyRate", "depositRate"])
  );
  const borrowRates = reserves.map((r) =>
    getNumberField(r, ["variableBorrowRate", "borrowRate", "borrowAPY"])
  );
  const totalLiquidity = reserves.map((r) =>
    getNumberField(r, ["totalLiquidity", "availableLiquidity", "totalSupply", "totalDeposits"])
  );

  const lines: string[] = [];
  lines.push("params:");
  lines.push(`  snapshot_at: "${snapshotAt}"`);
  lines.push(`  snapshot_source: "${snapshotSource}"`);

  pushArrayLines(lines, "reserve_symbols", symbols, (v) => `"${v}"`);
  pushArrayLines(lines, "reserve_addresses", addresses, (v) => `"${v}"`);
  pushArrayLines(lines, "reserve_supply_rates", supplyRates, String);
  pushArrayLines(lines, "reserve_borrow_rates", borrowRates, String);
  pushArrayLines(lines, "reserve_total_liquidity", totalLiquidity, String);

  return lines.join("\n");
}

function pushArrayLines<T>(lines: string[], key: string, values: T[], fmt: (v: T) => string): void {
  lines.push(`  ${key}: [`);
  for (const value of values) {
    lines.push(`    ${fmt(value)},`);
  }
  lines.push("  ]");
}

function getStringField(record: UnknownRecord, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "";
}

function getNumberField(record: UnknownRecord, keys: string[]): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number.parseFloat(value);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return 0;
}
