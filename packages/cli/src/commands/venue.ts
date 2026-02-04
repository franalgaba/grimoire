/**
 * Venue Command
 * Proxies venue metadata CLIs bundled in @grimoirelabs/venues
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

export const VENUE_CLI_MAP: Record<string, string> = {
  aave: "aave",
  "aave-v3": "aave",
  uniswap: "uniswap",
  "uniswap-v3": "uniswap",
  "uniswap-v4": "uniswap",
  "morpho-blue": "morpho-blue",
  morpho: "morpho-blue",
  hyperliquid: "hyperliquid",
};

const PRIMARY_ADAPTERS = [
  { name: "aave", aliases: ["aave-v3"] },
  { name: "uniswap", aliases: ["uniswap-v3", "uniswap-v4"] },
  { name: "morpho-blue", aliases: ["morpho"] },
  { name: "hyperliquid", aliases: [] },
];

export function normalizeAdapter(adapter: string): string {
  return adapter
    .toLowerCase()
    .replace(/^grimoire-/, "")
    .replace(/_/g, "-");
}

export function resolveVenueCliPath(cliName: string): string {
  const venuesRoot = resolveVenuesRoot();
  return path.join(venuesRoot, "dist", "cli", `${cliName}.js`);
}

function resolveVenuesRoot(): string {
  try {
    const venuesPkg = require.resolve("@grimoirelabs/venues/package.json");
    return path.dirname(venuesPkg);
  } catch {
    const workspaceRoot = findWorkspaceVenuesRoot();
    if (workspaceRoot) return workspaceRoot;
    throw new Error("Unable to resolve @grimoirelabs/venues. Is it installed?");
  }
}

function findWorkspaceVenuesRoot(): string | null {
  let current = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(current, "packages", "venues", "package.json");
    if (existsSync(candidate)) {
      return path.dirname(candidate);
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

export async function venueCommand(adapter: string, args: string[] = []): Promise<void> {
  if (!adapter || adapter === "--help" || adapter === "-h") {
    printUsage();
    return;
  }

  const normalized = normalizeAdapter(adapter);
  const cliName = VENUE_CLI_MAP[normalized];

  if (!cliName) {
    const options = PRIMARY_ADAPTERS.map((adapter) => adapter.name).join(", ");
    console.error(`Unknown venue adapter "${adapter}". Available: ${options}`);
    console.error("Run `grimoire venue --help` or `grimoire venues` for a full list.");
    process.exit(1);
  }

  const cliPath = resolveVenueCliPath(cliName);
  if (!existsSync(cliPath)) {
    console.error(
      `Venue CLI not found at ${cliPath}. Build @grimoirelabs/venues or reinstall @grimoirelabs/cli.`
    );
    process.exit(1);
  }

  const result = spawnSync(process.execPath, [cliPath, ...args], { stdio: "inherit" });
  if (result.error) {
    console.error(result.error instanceof Error ? result.error.message : String(result.error));
    process.exit(1);
  }
  const exitCode = result.status ?? (result.signal ? 1 : 0);
  process.exit(exitCode);
}

function printUsage(): void {
  const adapterLines = PRIMARY_ADAPTERS.map((adapter) => {
    if (adapter.aliases.length === 0) return `  - ${adapter.name}`;
    return `  - ${adapter.name} (aliases: ${adapter.aliases.join(", ")})`;
  }).join("\n");

  console.log(
    `\nUsage:\n  grimoire venue <adapter> [args...]\n\nAdapters:\n${adapterLines}\n\nExamples:\n  grimoire venue morpho-blue vaults --chain 8453 --asset USDC --min-tvl 5000000 --format spell\n  grimoire venue uniswap tokens --chain 1 --symbol USDC\n  grimoire venue aave markets --chain 1\n`
  );
}
