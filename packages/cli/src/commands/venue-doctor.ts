import { createProvider, createVenueRegistry, type VenueAdapter } from "@grimoirelabs/core";
import { adapters as bundledAdapters } from "@grimoirelabs/venues";
import chalk from "chalk";
import { loadAllAdapters, normalizeAdapterName } from "../lib/venue-discovery.js";
import {
  collectMorphoBorrowReadiness,
  formatMorphoReadinessMessage,
  type MorphoBorrowReadinessReport,
  type ProviderLike,
  printMorphoBorrowReadinessSection,
  printTable,
} from "./venue-doctor-morpho.js";

export type { MorphoBorrowReadinessReport };

type DoctorStatus = "pass" | "fail" | "skip";

export interface VenueDoctorOptions {
  chainId?: number;
  adapter?: string;
  rpcUrl?: string;
  json?: boolean;
}

interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  message: string;
}

interface AdapterCheck {
  name: string;
  registered: boolean;
  chainSupported: boolean | null;
  requiredEnv: string[];
  missingEnv: string[];
}

export interface VenueDoctorReport {
  ok: boolean;
  timestamp: string;
  chainId?: number;
  requestedAdapter?: string;
  rpcUrl?: string;
  rpcBlockNumber?: string;
  checks: DoctorCheck[];
  adapters: AdapterCheck[];
  morphoBorrowReadiness?: MorphoBorrowReadinessReport;
}

interface VenueDoctorDeps {
  adapters?: VenueAdapter[];
  createProviderFn?: (chainId: number, rpcUrl?: string) => ProviderLike;
  env?: Record<string, string | undefined>;
  now?: () => Date;
}

const ADAPTER_FILTER_MAP: Record<string, string[]> = {
  aave: ["aave_v3"],
  "aave-v3": ["aave_v3"],
  aave_v3: ["aave_v3"],
  uniswap: ["uniswap_v3", "uniswap_v4"],
  "uniswap-v3": ["uniswap_v3"],
  uniswap_v3: ["uniswap_v3"],
  "uniswap-v4": ["uniswap_v4"],
  uniswap_v4: ["uniswap_v4"],
  morpho: ["morpho_blue"],
  "morpho-blue": ["morpho_blue"],
  morpho_blue: ["morpho_blue"],
  hyperliquid: ["hyperliquid"],
  across: ["across"],
  pendle: ["pendle"],
  polymarket: ["polymarket"],
};

export function parseVenueDoctorArgs(args: string[]): VenueDoctorOptions | { help: true } {
  const options: VenueDoctorOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;

    if (arg === "--help" || arg === "-h") {
      return { help: true };
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--chain") {
      const value = args[i + 1];
      if (!value) throw new Error("Missing value for --chain");
      const chainId = Number.parseInt(value, 10);
      if (!Number.isFinite(chainId)) throw new Error(`Invalid --chain value: ${value}`);
      options.chainId = chainId;
      i++;
      continue;
    }

    if (arg === "--adapter") {
      const value = args[i + 1];
      if (!value) throw new Error("Missing value for --adapter");
      options.adapter = value;
      i++;
      continue;
    }

    if (arg === "--rpc-url") {
      const value = args[i + 1];
      if (!value) throw new Error("Missing value for --rpc-url");
      options.rpcUrl = value;
      i++;
      continue;
    }

    throw new Error(`Unknown option for venue doctor: ${arg}`);
  }

  return options;
}

export async function runVenueDoctor(
  options: VenueDoctorOptions,
  deps: VenueDoctorDeps = {}
): Promise<VenueDoctorReport> {
  const activeAdapters = deps.adapters ?? bundledAdapters;
  const createProviderFn = deps.createProviderFn ?? createProvider;
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const metas = activeAdapters.map((adapter) => adapter.meta);
  const selectedMetas = selectAdapters(metas, options.adapter);

  if (selectedMetas.length === 0) {
    throw new Error(`No adapters matched filter '${options.adapter}'`);
  }

  const registry = createVenueRegistry(activeAdapters);
  const adapterChecks: AdapterCheck[] = selectedMetas.map((meta) => {
    const requiredEnv = meta.requiredEnv ?? [];
    const missingEnv = requiredEnv.filter((name) => !env[name]);
    const chainSupported =
      options.chainId === undefined ? null : meta.supportedChains.includes(options.chainId);
    return {
      name: meta.name,
      registered: registry.get(meta.name) !== undefined,
      chainSupported,
      requiredEnv,
      missingEnv,
    };
  });

  const checks: DoctorCheck[] = [];

  const registrationOk = adapterChecks.every((entry) => entry.registered);
  checks.push({
    name: "adapter_registration",
    status: registrationOk ? "pass" : "fail",
    message: registrationOk
      ? "All selected adapters are registered."
      : "Some selected adapters are not registered.",
  });

  const envOk = adapterChecks.every((entry) => entry.missingEnv.length === 0);
  checks.push({
    name: "required_env",
    status: envOk ? "pass" : "fail",
    message: envOk
      ? "All required environment variables are present."
      : "Missing required environment variables for one or more adapters.",
  });

  if (options.chainId === undefined) {
    checks.push({
      name: "chain_support",
      status: "skip",
      message: "Skipped (provide --chain to validate chain compatibility).",
    });
  } else {
    const chainOk = adapterChecks.every((entry) => entry.chainSupported === true);
    checks.push({
      name: "chain_support",
      status: chainOk ? "pass" : "fail",
      message: chainOk
        ? `All selected adapters support chain ${options.chainId}.`
        : `Some selected adapters do not support chain ${options.chainId}.`,
    });
  }

  let rpcUrlUsed: string | undefined;
  let rpcBlockNumber: string | undefined;
  let providerForDiagnostics: ProviderLike | undefined;
  let morphoBorrowReadiness: MorphoBorrowReadinessReport | undefined;

  if (options.chainId === undefined) {
    checks.push({
      name: "rpc_reachability",
      status: "skip",
      message: "Skipped (provide --chain to check RPC reachability).",
    });
  } else {
    const rpcCandidate = resolveRpcUrl(options.chainId, options.rpcUrl, env);
    try {
      const provider = createProviderFn(options.chainId, rpcCandidate);
      providerForDiagnostics = provider;
      const blockNumber = await provider.getBlockNumber();
      rpcBlockNumber = blockNumber.toString();
      rpcUrlUsed = provider.rpcUrl ?? rpcCandidate;
      checks.push({
        name: "rpc_reachability",
        status: "pass",
        message: `Reachable at block ${rpcBlockNumber}.`,
      });
    } catch (error) {
      rpcUrlUsed = rpcCandidate;
      checks.push({
        name: "rpc_reachability",
        status: "fail",
        message: (error as Error).message,
      });
    }
  }

  const morphoSelected = selectedMetas.some((meta) => meta.name === "morpho_blue");
  if (morphoSelected) {
    morphoBorrowReadiness = await collectMorphoBorrowReadiness({
      chainId: options.chainId,
      provider: providerForDiagnostics,
      env,
    });

    checks.push({
      name: "morpho_borrow_readiness",
      status:
        morphoBorrowReadiness.status === "ready"
          ? "pass"
          : morphoBorrowReadiness.status === "skip"
            ? "skip"
            : "fail",
      message: formatMorphoReadinessMessage(morphoBorrowReadiness),
    });
  }

  const ok = checks.every((check) => check.status !== "fail");

  return {
    ok,
    timestamp: now().toISOString(),
    chainId: options.chainId,
    requestedAdapter: options.adapter,
    rpcUrl: rpcUrlUsed,
    rpcBlockNumber,
    checks,
    adapters: adapterChecks,
    morphoBorrowReadiness,
  };
}

export async function venueDoctorCommand(
  args: string[],
  deps: VenueDoctorDeps = {}
): Promise<VenueDoctorReport> {
  const parsed = parseVenueDoctorArgs(args);
  if ("help" in parsed) {
    printVenueDoctorUsage();
    return {
      ok: true,
      timestamp: new Date().toISOString(),
      checks: [],
      adapters: [],
    };
  }

  // Include external adapters when no explicit deps.adapters provided
  if (!deps.adapters) {
    const allAdapters = await loadAllAdapters();
    if (allAdapters.length > bundledAdapters.length) {
      deps = { ...deps, adapters: allAdapters };
    }
  }

  const report = await runVenueDoctor(parsed, deps);
  if (parsed.json) {
    console.error(
      JSON.stringify(
        report,
        (_key, value) => (typeof value === "bigint" ? value.toString() : value),
        2
      )
    );
  } else {
    printVenueDoctorReport(report);
  }

  return report;
}

export function printVenueDoctorUsage(): void {
  console.error(
    "\nUsage:\n  grimoire venue doctor [--chain <id>] [--adapter <name>] [--rpc-url <url>] [--json]\n\nExamples:\n  grimoire venue doctor --chain 1\n  grimoire venue doctor --adapter uniswap --chain 1 --rpc-url https://...\n"
  );
}

function printVenueDoctorReport(report: VenueDoctorReport): void {
  const statusLabel = report.ok ? chalk.green("PASS") : chalk.red("FAIL");
  console.error(chalk.bold(`Venue Doctor: ${statusLabel}`));
  console.error(`Timestamp: ${report.timestamp}`);
  if (report.chainId !== undefined) {
    console.error(`Chain: ${report.chainId}`);
  }
  if (report.requestedAdapter) {
    console.error(`Adapter filter: ${report.requestedAdapter}`);
  }
  if (report.rpcUrl) {
    console.error(`RPC: ${report.rpcUrl}`);
  }
  if (report.rpcBlockNumber) {
    console.error(`Block: ${report.rpcBlockNumber}`);
  }
  console.error();

  console.error(chalk.bold("Checks"));
  for (const check of report.checks) {
    const status =
      check.status === "pass"
        ? chalk.green("PASS")
        : check.status === "fail"
          ? chalk.red("FAIL")
          : chalk.yellow("SKIP");
    console.error(`- ${check.name}: ${status} (${check.message})`);
  }

  if (report.adapters.length > 0) {
    console.error();
    console.error(chalk.bold("Adapters"));
    const headers = ["Name", "Registered", "Chain", "Required Env", "Missing Env"];
    const rows = report.adapters.map((adapter) => [
      adapter.name,
      adapter.registered ? "yes" : "no",
      adapter.chainSupported === null ? "-" : adapter.chainSupported ? "yes" : "no",
      adapter.requiredEnv.length > 0 ? adapter.requiredEnv.join(", ") : "-",
      adapter.missingEnv.length > 0 ? adapter.missingEnv.join(", ") : "-",
    ]);
    printTable(headers, rows);
  }

  if (report.morphoBorrowReadiness) {
    printMorphoBorrowReadinessSection(report.morphoBorrowReadiness);
  }
}

function selectAdapters(
  metas: VenueAdapter["meta"][],
  adapterFilter: string | undefined
): VenueAdapter["meta"][] {
  if (!adapterFilter) return metas;

  const normalized = normalizeAdapterName(adapterFilter);
  const mapped = ADAPTER_FILTER_MAP[normalized];
  const targetNames = new Set(mapped ?? [normalized.replace(/-/g, "_")]);

  return metas.filter((meta) => {
    const canonical = normalizeAdapterName(meta.name).replace(/-/g, "_");
    return targetNames.has(canonical);
  });
}

function resolveRpcUrl(
  chainId: number,
  explicitRpcUrl: string | undefined,
  env: Record<string, string | undefined>
): string | undefined {
  if (explicitRpcUrl && explicitRpcUrl.trim().length > 0) {
    return explicitRpcUrl.trim();
  }

  const chainScoped = env[`RPC_URL_${chainId}`];
  if (chainScoped && chainScoped.trim().length > 0) {
    return chainScoped.trim();
  }

  const generic = env.RPC_URL;
  if (generic && generic.trim().length > 0) {
    return generic.trim();
  }

  return undefined;
}
