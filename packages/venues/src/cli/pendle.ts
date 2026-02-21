#!/usr/bin/env node

import { createPendleAdapter } from "../pendle.js";
import { getOption, type OutputFormat, parseArgs, printResult, requireOption } from "./utils.js";

const DEFAULT_BASE_URL = "https://api-v2.pendle.finance/core";

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (!command || command === "help" || options.help) {
    printUsage();
    return;
  }

  const format = (getOption(options, "format") ?? "auto") as OutputFormat;
  const baseUrl = (
    getOption(options, "base-url") ??
    process.env.PENDLE_API_BASE_URL ??
    DEFAULT_BASE_URL
  ).replace(/\/$/, "");

  switch (command) {
    case "info": {
      const adapter = createPendleAdapter({ baseUrl });
      printResult(
        {
          ...adapter.meta,
          baseUrl,
        },
        format
      );
      return;
    }
    case "chains": {
      const data = await fetchJson<Record<string, unknown>>(baseUrl, "/v1/chains");
      printResult(data, format);
      return;
    }
    case "supported-aggregators": {
      const chainId = Number.parseInt(requireOption(options, "chain"), 10);
      const data = await fetchJson<Record<string, unknown>>(
        baseUrl,
        `/v1/sdk/${chainId}/supported-aggregators`
      );
      printResult(data, format);
      return;
    }
    case "markets": {
      const params = new URLSearchParams();
      const chain = getOption(options, "chain");
      const active = getOption(options, "active");
      if (chain) params.set("chainId", chain);
      if (active) params.set("isActive", normalizeBooleanOption(active, "active"));
      const path = `/v1/markets/all${params.size > 0 ? `?${params.toString()}` : ""}`;
      const data = await fetchJson<Record<string, unknown>>(baseUrl, path);
      printResult(data, format);
      return;
    }
    case "assets": {
      const params = new URLSearchParams();
      const chain = getOption(options, "chain");
      const type = getOption(options, "type");
      if (chain) params.set("chainId", chain);
      if (type) params.set("type", normalizeAssetType(type));
      const path = `/v1/assets/all${params.size > 0 ? `?${params.toString()}` : ""}`;
      const data = await fetchJson<Record<string, unknown>>(baseUrl, path);
      printResult(data, format);
      return;
    }
    case "market-tokens": {
      const chainId = Number.parseInt(requireOption(options, "chain"), 10);
      const market = requireOption(options, "market");
      const data = await fetchJson<Record<string, unknown>>(
        baseUrl,
        `/v1/sdk/${chainId}/markets/${market}/tokens`
      );
      printResult(data, format);
      return;
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function printUsage() {
  console.log(
    "\nPendle CLI (grimoire-pendle)\n\nCommands:\n  info [--base-url <url>] [--format <auto|json|table>]\n  chains [--base-url <url>] [--format <auto|json|table>]\n  supported-aggregators --chain <id> [--base-url <url>] [--format <auto|json|table>]\n  markets [--chain <id>] [--active <true|false>] [--base-url <url>] [--format <auto|json|table>]\n  assets [--chain <id>] [--type <PT|YT|LP|SY>] [--base-url <url>] [--format <auto|json|table>]\n  market-tokens --chain <id> --market <address> [--base-url <url>] [--format <auto|json|table>]\n"
  );
}

async function fetchJson<T>(baseUrl: string, path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Pendle API request failed (${response.status}): ${text || response.statusText}`
    );
  }
  return (await response.json()) as T;
}

function normalizeBooleanOption(value: string, key: string): string {
  const lower = value.trim().toLowerCase();
  if (lower === "true" || lower === "false") return lower;
  throw new Error(`Invalid --${key} value '${value}', expected true|false`);
}

function normalizeAssetType(value: string): string {
  const upper = value.trim().toUpperCase();
  if (upper === "PT" || upper === "YT" || upper === "SY" || upper === "PENDLE_LP") {
    return upper;
  }
  if (upper === "LP") {
    return "PENDLE_LP";
  }
  throw new Error(`Invalid --type value '${value}', expected PT|YT|LP|SY`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
