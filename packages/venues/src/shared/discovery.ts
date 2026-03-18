/**
 * Convention-based discovery for built-in venue adapters.
 *
 * Scans `src/cli/*.ts` (dev / bun) or `dist/cli/*.js` (prod) and builds
 * VenueManifest entries so the CLI doesn't need hardcoded maps.
 */

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { VenueManifest } from "@grimoirelabs/core";

/** Mapping from CLI filename (without extension) to known aliases. */
const BUILTIN_ALIAS_MAP: Record<string, string[]> = {
  aave: ["aave-v3"],
  uniswap: ["uniswap-v3", "uniswap-v4"],
  "morpho-blue": ["morpho"],
};

/**
 * Mapping from CLI filename to the adapter source file(s) it covers.
 * The first matching file is used as the canonical adapter path.
 */
const CLI_TO_ADAPTER_MAP: Record<string, string[]> = {
  aave: ["aave-v3"],
  uniswap: ["uniswap-v3", "uniswap-v4"],
  "morpho-blue": ["morpho-blue"],
  hyperliquid: ["hyperliquid"],
  pendle: ["pendle"],
  polymarket: ["polymarket"],
};

function isBunRuntime(): boolean {
  return typeof (process.versions as Record<string, string | undefined>).bun === "string";
}

function getVenuesRoot(): string {
  return path.resolve(
    import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname),
    "../.."
  );
}

/** Only recognize known venue entry-point CLI files (ignore split helper modules). */
const KNOWN_CLI_ENTRIES = new Set([
  ...Object.keys(CLI_TO_ADAPTER_MAP),
  ...Object.keys(BUILTIN_ALIAS_MAP),
]);

function isCliSourceFile(filename: string, ext: string): boolean {
  if (!filename.endsWith(ext)) return false;
  if (filename.endsWith(".test.ts") || filename.endsWith(".test.js")) return false;
  const name = filename.slice(0, -ext.length);
  return KNOWN_CLI_ENTRIES.has(name);
}

function resolveAdapterPath(
  cliName: string,
  adapterFiles: Set<string>,
  srcDir: string,
  ext: string
): string | undefined {
  const adapterNames = CLI_TO_ADAPTER_MAP[cliName];
  if (!adapterNames) return undefined;

  for (const adapterName of adapterNames) {
    // Check for flat file: {adapterName}{ext}
    const filename = `${adapterName}${ext}`;
    if (adapterFiles.has(filename)) {
      return path.join(srcDir, filename);
    }
    // Check for subfolder: {adapterName}/index{ext}
    const indexPath = path.join(srcDir, adapterName, `index${ext}`);
    if (existsSync(indexPath)) {
      return indexPath;
    }
  }
  return undefined;
}

/**
 * Discover all built-in venue manifests by scanning the CLI directory.
 */
export function discoverBuiltinVenues(): VenueManifest[] {
  const venuesRoot = getVenuesRoot();
  const useSrc = isBunRuntime() && existsSync(path.join(venuesRoot, "src", "cli"));
  const cliDir = useSrc
    ? path.join(venuesRoot, "src", "cli")
    : path.join(venuesRoot, "dist", "cli");
  const srcDir = useSrc
    ? path.join(venuesRoot, "src", "adapters")
    : path.join(venuesRoot, "dist", "adapters");
  const ext = useSrc ? ".ts" : ".js";

  if (!existsSync(cliDir)) {
    return [];
  }

  const cliEntries = readdirSync(cliDir).filter((filename) => isCliSourceFile(filename, ext));

  // Pre-read adapter directory to avoid per-file existsSync calls
  let adapterFiles: Set<string>;
  try {
    adapterFiles = new Set(readdirSync(srcDir));
  } catch {
    /* readdir failed — treat as empty */
    adapterFiles = new Set();
  }

  return cliEntries.map((entry) => {
    const name = path.basename(entry, ext);
    return {
      name,
      aliases: BUILTIN_ALIAS_MAP[name],
      cli: path.join(cliDir, entry),
      adapter: resolveAdapterPath(name, adapterFiles, srcDir, ext),
    };
  });
}
