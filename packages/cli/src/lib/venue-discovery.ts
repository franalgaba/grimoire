/**
 * Unified venue discovery engine.
 *
 * Combines built-in venues (from @grimoirelabs/venues) with external
 * npm packages matching the `grimoire-venue-*` convention.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { VenueAdapter, VenueManifest } from "@grimoirelabs/core";
import { adapters as bundledAdapters, discoverBuiltinVenues } from "@grimoirelabs/venues";

const VENUE_PKG_PREFIX = "grimoire-venue-";
const MAX_PARENT_TRAVERSAL_DEPTH = 8;

/** Module-level cache — venue list doesn't change mid-run. */
let cachedManifests: VenueManifest[] | null = null;
let cachedCliMap: Record<string, string> | null = null;

/** Reset discovery caches. Useful for testing. */
export function clearDiscoveryCache(): void {
  cachedManifests = null;
  cachedCliMap = null;
}

/**
 * Discover all venues: built-in + external npm packages.
 * Results are cached for the lifetime of the process.
 */
export function discoverAllVenues(): VenueManifest[] {
  if (cachedManifests) return cachedManifests;

  const builtin = discoverBuiltinVenues();
  const external = discoverExternalVenues();

  // Merge: external wins on name collision (allows overriding built-ins)
  const byName = new Map<string, VenueManifest>();
  for (const manifest of builtin) {
    byName.set(manifest.name, manifest);
  }
  for (const manifest of external) {
    byName.set(manifest.name, manifest);
  }

  cachedManifests = [...byName.values()];
  return cachedManifests;
}

/**
 * Build a name + aliases → canonical CLI-name map from manifests.
 * Cached alongside the manifest list.
 */
export function buildVenueCliMap(manifests: VenueManifest[]): Record<string, string> {
  if (cachedCliMap) return cachedCliMap;

  const map: Record<string, string> = {};
  for (const manifest of manifests) {
    map[manifest.name] = manifest.name;
    if (manifest.aliases) {
      for (const alias of manifest.aliases) {
        map[alias] = manifest.name;
      }
    }
  }
  cachedCliMap = map;
  return map;
}

/**
 * Normalize a user-supplied adapter name to its canonical form.
 * Shared by venue command routing and venue-doctor filtering.
 */
export function normalizeAdapterName(adapter: string): string {
  return adapter
    .trim()
    .toLowerCase()
    .replace(/^grimoire-/, "")
    .replace(/_/g, "-");
}

/**
 * Filter manifests to only those from external packages (not in bundled adapters).
 */
export function getExternalManifests(manifests: VenueManifest[]): VenueManifest[] {
  const bundledNames = new Set(bundledAdapters.map((adapter) => adapter.meta.name));
  return manifests.filter((manifest) => manifest.adapter && !bundledNames.has(manifest.name));
}

/**
 * Load all adapters: bundled + dynamically imported externals.
 */
export async function loadAllAdapters(): Promise<VenueAdapter[]> {
  const manifests = discoverAllVenues();
  const externalManifests = getExternalManifests(manifests);
  if (externalManifests.length === 0) return [...bundledAdapters];

  const external = await loadExternalAdapters(externalManifests);
  return [...bundledAdapters, ...external];
}

/**
 * Scan node_modules for external venue packages.
 *
 * Convention: packages named `grimoire-venue-*` or `@* /grimoire-venue-*`
 * with a `"grimoire"` field of type `"venue"` in their package.json.
 */
export function discoverExternalVenues(root?: string): VenueManifest[] {
  const projectRoot = root ?? findProjectRoot();
  if (!projectRoot) return [];

  const nodeModulesDir = path.join(projectRoot, "node_modules");
  let topLevelEntries: string[];
  try {
    topLevelEntries = readdirSync(nodeModulesDir);
  } catch {
    return [];
  }

  const manifests: VenueManifest[] = [];

  // Scan top-level grimoire-venue-* packages
  scanVenuePackages(nodeModulesDir, topLevelEntries, manifests);

  // Scan scoped packages @*/grimoire-venue-*
  for (const entry of topLevelEntries) {
    if (!entry.startsWith("@")) continue;
    try {
      const scopedEntries = readdirSync(path.join(nodeModulesDir, entry));
      scanVenuePackages(path.join(nodeModulesDir, entry), scopedEntries, manifests);
    } catch {
      // Scope directory not readable — skip
    }
  }

  return manifests;
}

interface ExternalVenuePackageJson {
  grimoire?: {
    type?: string;
    name?: string;
    aliases?: string[];
    cli?: string;
    adapter?: string;
  };
}

function scanVenuePackages(dir: string, entries: string[], out: VenueManifest[]): void {
  for (const entry of entries) {
    if (!entry.startsWith(VENUE_PKG_PREFIX)) continue;

    const pkgJsonPath = path.join(dir, entry, "package.json");
    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as ExternalVenuePackageJson;
      if (!pkg.grimoire || pkg.grimoire.type !== "venue") continue;

      const pkgRoot = path.join(dir, entry);
      const cliPath = pkg.grimoire.cli ? path.resolve(pkgRoot, pkg.grimoire.cli) : undefined;
      if (!cliPath) continue;

      out.push({
        name: pkg.grimoire.name ?? entry.replace(/^grimoire-venue-/, ""),
        aliases: pkg.grimoire.aliases,
        cli: cliPath,
        adapter: pkg.grimoire.adapter ? path.resolve(pkgRoot, pkg.grimoire.adapter) : undefined,
      });
    } catch {
      // Missing or malformed package.json — skip
    }
  }
}

/**
 * Dynamically import adapters from external venue manifests (in parallel).
 */
export async function loadExternalAdapters(manifests: VenueManifest[]): Promise<VenueAdapter[]> {
  const importable = manifests.filter((manifest) => manifest.adapter);
  if (importable.length === 0) return [];

  const results = await Promise.allSettled(
    importable.map(async (manifest) => {
      const mod = (await import(manifest.adapter as string)) as {
        default?: VenueAdapter;
        adapter?: VenueAdapter;
      };
      return mod.default ?? mod.adapter;
    })
  );

  return results
    .filter(
      (result): result is PromiseFulfilled<VenueAdapter | undefined> =>
        result.status === "fulfilled"
    )
    .map((result) => result.value)
    .filter((adapter): adapter is VenueAdapter => adapter?.meta !== undefined);
}

type PromiseFulfilled<T> = { status: "fulfilled"; value: T };

function findProjectRoot(): string | null {
  let current = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < MAX_PARENT_TRAVERSAL_DEPTH; depth++) {
    try {
      const raw = readFileSync(path.join(current, "package.json"), "utf-8");
      const pkg = JSON.parse(raw) as { workspaces?: unknown };
      if (pkg.workspaces) return current;
    } catch {
      // No package.json here — continue walking up
    }

    // Also accept a directory with node_modules (non-workspace root)
    try {
      readdirSync(path.join(current, "node_modules"), { withFileTypes: false });
      return current;
    } catch {
      // No node_modules — continue
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}
