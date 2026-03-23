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
    const report = await venueDoctorCommand(args);
    if (!report.ok) {
      throw new Error("Venue doctor checks failed");
    }
    return;
  }

  const manifests = discoverAllVenues();
  const cliMap = buildVenueCliMap(manifests);
  const cliName = cliMap[normalized];

  if (!cliName) {
    const options = manifests.map((venue) => venue.name).join(", ");
    throw new Error(
      `Unknown venue adapter "${adapter}". Available: ${options}. Run 'grimoire venue --help' or 'grimoire venues' for a full list.`
    );
  }

  const cliPath = resolveVenueCliPath(cliName);
  if (!existsSync(cliPath)) {
    throw new Error(
      `Venue CLI not found at ${cliPath}. Build @grimoirelabs/venues or reinstall @grimoirelabs/cli.`
    );
  }

  const result = spawnSync(process.execPath, [cliPath, ...args], { stdio: "inherit" });
  if (result.error) {
    throw new Error(result.error instanceof Error ? result.error.message : String(result.error));
  }
  const exitCode = result.status ?? (result.signal ? 1 : 0);
  if (exitCode !== 0) {
    throw new Error(`Venue CLI exited with code ${exitCode}`);
  }
}

function printUsage(): void {
  const manifests = discoverAllVenues();
  const adapterLines = manifests
    .map((venue) => {
      if (!venue.aliases || venue.aliases.length === 0) return `  - ${venue.name}`;
      return `  - ${venue.name} (aliases: ${venue.aliases.join(", ")})`;
    })
    .join("\n");

  console.error(
    `\nUsage:\n  grimoire venue <adapter> [args...]\n  grimoire venue doctor [--chain <id>] [--adapter <name>] [--rpc-url <url>] [--json]\n\nAdapters:\n${adapterLines}\n\nExamples:\n  grimoire venue morpho-blue vaults --chain 8453 --asset USDC --min-tvl 5000000 --format spell\n  grimoire venue uniswap tokens --chain 1 --symbol USDC\n  grimoire venue pendle chains\n  grimoire venue polymarket markets --format json\n  grimoire venue aave markets --chain 1\n  grimoire venue doctor --chain 1 --adapter uniswap\n`
  );
}
