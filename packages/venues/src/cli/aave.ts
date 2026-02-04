#!/usr/bin/env node

import { AaveClient, chainId, evmAddress } from "@aave/client";
import { chains, health, market, markets, reserve } from "@aave/client/actions";
import { type OutputFormat, getOption, parseArgs, printResult, requireOption } from "./utils.js";

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (!command || command === "help" || options.help) {
    printUsage();
    return;
  }

  const client = AaveClient.create();
  const format = (getOption(options, "format") ?? "auto") as OutputFormat;

  switch (command) {
    case "health": {
      const result = await unwrap(health(client));
      printResult({ healthy: result }, format);
      return;
    }
    case "chains": {
      const result = await unwrap(chains(client));
      printResult(result, format);
      return;
    }
    case "markets": {
      const chain = Number.parseInt(getOption(options, "chain") ?? "1", 10);
      const user = getOption(options, "user");
      const result = await unwrap(
        markets(client, {
          chainIds: [chainId(chain)],
          user: user ? evmAddress(user) : undefined,
        })
      );
      printResult(result, format);
      return;
    }
    case "market": {
      const chain = Number.parseInt(requireOption(options, "chain"), 10);
      const address = requireOption(options, "address");
      const user = getOption(options, "user");
      const result = await unwrap(
        market(client, {
          chainId: chainId(chain),
          address: evmAddress(address),
          user: user ? evmAddress(user) : undefined,
        })
      );
      printResult(result, format);
      return;
    }
    case "reserve": {
      const chain = Number.parseInt(requireOption(options, "chain"), 10);
      const marketAddress = requireOption(options, "market");
      const token = requireOption(options, "token");
      const result = await unwrap(
        reserve(client, {
          chainId: chainId(chain),
          market: evmAddress(marketAddress),
          underlyingToken: evmAddress(token),
        })
      );
      printResult(result, format);
      return;
    }
    case "reserves": {
      const chain = Number.parseInt(getOption(options, "chain") ?? "1", 10);
      let marketAddress = getOption(options, "market");
      const asset = getOption(options, "asset");
      const output = getOption(options, "format") ?? "auto";

      if (!marketAddress) {
        const marketsResult = await unwrap(
          markets(client, {
            chainIds: [chainId(chain)],
          })
        );
        const firstMarket = pickMarketAddress(marketsResult);
        if (!firstMarket) {
          throw new Error("Missing --market and could not infer market address from markets");
        }
        marketAddress = firstMarket;
      }

      const result = await unwrap(
        market(client, {
          chainId: chainId(chain),
          address: evmAddress(marketAddress),
        })
      );

      let reserves = extractReserves(result);

      if (asset) {
        const needle = asset.toLowerCase();
        reserves = reserves.filter((reserve) => matchReserveAsset(reserve, needle));
      }

      if (output === "spell") {
        printReservesSpellSnapshot(reserves, {
          chain,
          marketAddress,
          asset,
        });
        return;
      }

      printResult(reserves, output as OutputFormat);
      return;
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function printUsage() {
  console.log(
    "\nAave CLI (grimoire-aave)\n\nCommands:\n  health [--format <json|table>]\n  chains [--format <json|table>]\n  markets --chain <id> [--user <address>] [--format <json|table>]\n  market --chain <id> --address <market> [--user <address>] [--format <json|table>]\n  reserve --chain <id> --market <address> --token <address> [--format <json|table>]\n  reserves --chain <id> [--market <address>] [--asset <symbol|address>] [--format <json|table|spell>]\n"
  );
}

type AaveResult<T> = {
  isErr?: () => boolean;
  error?: { message?: string };
  value?: T;
};

async function unwrap<T>(result: Promise<AaveResult<T> | T> | AaveResult<T> | T): Promise<T> {
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

type UnknownRecord = Record<string, unknown>;

function pickMarketAddress(marketsResult: unknown): string | null {
  if (Array.isArray(marketsResult)) {
    return extractAddress(marketsResult[0]);
  }
  if (marketsResult && typeof marketsResult === "object") {
    const record = marketsResult as UnknownRecord;
    const markets = record.markets;
    if (Array.isArray(markets)) {
      return extractAddress(markets[0]);
    }
    if (Array.isArray(record.data)) {
      return extractAddress(record.data[0]);
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

function matchReserveAsset(reserve: UnknownRecord, needle: string): boolean {
  const symbol = typeof reserve.symbol === "string" ? reserve.symbol.toLowerCase() : "";
  const underlying =
    typeof reserve.underlyingToken === "string" ? reserve.underlyingToken.toLowerCase() : "";
  const address =
    typeof reserve.underlyingAsset === "string" ? reserve.underlyingAsset.toLowerCase() : "";
  const id = typeof reserve.id === "string" ? reserve.id.toLowerCase() : "";
  return [symbol, underlying, address, id].some((value) => value === needle);
}

type ReserveSnapshotOptions = {
  chain: number;
  marketAddress: string;
  asset?: string;
};

function printReservesSpellSnapshot(
  reserves: UnknownRecord[],
  options: ReserveSnapshotOptions
): void {
  const snapshotAt = new Date().toISOString();
  const args: string[] = ["grimoire venue aave reserves", `--chain ${options.chain}`];

  if (options.marketAddress) {
    args.push(`--market ${options.marketAddress}`);
  }
  if (options.asset) {
    args.push(`--asset ${options.asset}`);
  }

  const snapshotSource = args.join(" ");

  const symbols = reserves.map((reserve) => getStringField(reserve, ["symbol", "assetSymbol"]));
  const addresses = reserves.map((reserve) =>
    getStringField(reserve, ["underlyingAsset", "underlyingToken", "address", "tokenAddress", "id"])
  );
  const supplyRates = reserves.map((reserve) =>
    getNumberField(reserve, ["liquidityRate", "supplyAPY", "supplyRate", "depositRate"])
  );
  const borrowRates = reserves.map((reserve) =>
    getNumberField(reserve, ["variableBorrowRate", "borrowRate", "borrowAPY"])
  );
  const totalLiquidity = reserves.map((reserve) =>
    getNumberField(reserve, [
      "totalLiquidity",
      "availableLiquidity",
      "totalSupply",
      "totalDeposits",
    ])
  );

  const lines: string[] = [];
  lines.push("params:");
  lines.push(`  snapshot_at: "${snapshotAt}"`);
  lines.push(`  snapshot_source: "${snapshotSource}"`);

  lines.push("  reserve_symbols: [");
  for (const symbol of symbols) {
    lines.push(`    "${symbol}",`);
  }
  lines.push("  ]");

  lines.push("  reserve_addresses: [");
  for (const address of addresses) {
    lines.push(`    "${address}",`);
  }
  lines.push("  ]");

  lines.push("  reserve_supply_rates: [");
  for (const rate of supplyRates) {
    lines.push(`    ${rate},`);
  }
  lines.push("  ]");

  lines.push("  reserve_borrow_rates: [");
  for (const rate of borrowRates) {
    lines.push(`    ${rate},`);
  }
  lines.push("  ]");

  lines.push("  reserve_total_liquidity: [");
  for (const total of totalLiquidity) {
    lines.push(`    ${total},`);
  }
  lines.push("  ]");

  console.log(lines.join("\n"));
}

function getStringField(record: UnknownRecord, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return "";
}

function getNumberField(record: UnknownRecord, keys: string[]): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number.parseFloat(value);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }
  return 0;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
