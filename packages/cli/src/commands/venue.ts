/**
 * Venue Command
 * Proxies venue metadata CLIs bundled in @grimoirelabs/venues
 * and externally discovered grimoire-venue-* packages.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  buildVenueCliMap,
  discoverAllVenues,
  normalizeAdapterName,
} from "../lib/venue-discovery.js";
import { venueDoctorCommand } from "./venue-doctor.js";

export function normalizeAdapter(adapter: string): string {
  return normalizeAdapterName(adapter);
}

export function resolveVenueCliPath(cliName: string): string {
  const manifests = discoverAllVenues();
  const manifest = manifests.find((venue) => venue.name === cliName);
  if (manifest) return manifest.cli;

  throw new Error(`Venue CLI "${cliName}" not found. Is @grimoirelabs/venues installed?`);
}

export async function venueCommand(adapter: string, args: string[] = []): Promise<void> {
  if (!adapter || adapter === "--help" || adapter === "-h") {
    printUsage();
    return;
  }

  const normalized = normalizeAdapterName(adapter);
  if (normalized === "doctor") {
    try {
      const report = await venueDoctorCommand(args);
      if (!report.ok) {
        process.exit(1);
      }
      return;
    } catch (error) {
      console.error((error as Error).message);
      process.exit(1);
    }
  }

  const manifests = discoverAllVenues();
  const cliMap = buildVenueCliMap(manifests);
  const cliName = cliMap[normalized];

  if (!cliName) {
    const options = manifests.map((venue) => venue.name).join(", ");
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
  const manifests = discoverAllVenues();
  const adapterLines = manifests
    .map((venue) => {
      if (!venue.aliases || venue.aliases.length === 0) return `  - ${venue.name}`;
      return `  - ${venue.name} (aliases: ${venue.aliases.join(", ")})`;
    })
    .join("\n");

  console.log(
    `\nUsage:\n  grimoire venue <adapter> [args...]\n  grimoire venue doctor [--chain <id>] [--adapter <name>] [--rpc-url <url>] [--json]\n\nAdapters:\n${adapterLines}\n\nExamples:\n  grimoire venue morpho-blue vaults --chain 8453 --asset USDC --min-tvl 5000000 --format spell\n  grimoire venue uniswap tokens --chain 1 --symbol USDC\n  grimoire venue pendle chains\n  grimoire venue polymarket markets --format json\n  grimoire venue aave markets --chain 1\n  grimoire venue doctor --chain 1 --adapter uniswap\n`
  );
}
