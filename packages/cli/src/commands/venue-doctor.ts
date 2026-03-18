import {
  type Address,
  createProvider,
  createVenueRegistry,
  type VenueAdapter,
} from "@grimoirelabs/core";
import {
  adapters as bundledAdapters,
  getMorphoBlueMarketId,
  MORPHO_BLUE_DEFAULT_MARKETS,
} from "@grimoirelabs/venues";
import chalk from "chalk";
import { parseAbi } from "viem";
import { loadAllAdapters, normalizeAdapterName } from "../lib/venue-discovery.js";

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

type MorphoBorrowReadinessStatus = "ready" | "not_ready" | "skip";

export interface MorphoBorrowReadinessReport {
  status: MorphoBorrowReadinessStatus;
  walletAddress?: string;
  marketId?: string;
  marketOnchainId?: string;
  morphoAddress?: string;
  loanToken?: string;
  collateralToken?: string;
  walletCollateralBalance?: string;
  collateralAllowance?: string;
  positionSupplyShares?: string;
  positionBorrowShares?: string;
  positionCollateral?: string;
  borrowReady: boolean;
  reasons: string[];
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

interface PublicClientLike {
  readContract?: unknown;
}

interface ProviderLike {
  getBlockNumber(): Promise<bigint>;
  getClient?: () => PublicClientLike;
  readonly rpcUrl?: string;
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

const ERC20_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

const MORPHO_ABI = parseAbi([
  "function position(bytes32 marketId, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
]);

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
    console.log(
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
  console.log(
    "\nUsage:\n  grimoire venue doctor [--chain <id>] [--adapter <name>] [--rpc-url <url>] [--json]\n\nExamples:\n  grimoire venue doctor --chain 1\n  grimoire venue doctor --adapter uniswap --chain 1 --rpc-url https://...\n"
  );
}

function printVenueDoctorReport(report: VenueDoctorReport): void {
  const statusLabel = report.ok ? chalk.green("PASS") : chalk.red("FAIL");
  console.log(chalk.bold(`Venue Doctor: ${statusLabel}`));
  console.log(`Timestamp: ${report.timestamp}`);
  if (report.chainId !== undefined) {
    console.log(`Chain: ${report.chainId}`);
  }
  if (report.requestedAdapter) {
    console.log(`Adapter filter: ${report.requestedAdapter}`);
  }
  if (report.rpcUrl) {
    console.log(`RPC: ${report.rpcUrl}`);
  }
  if (report.rpcBlockNumber) {
    console.log(`Block: ${report.rpcBlockNumber}`);
  }
  console.log();

  console.log(chalk.bold("Checks"));
  for (const check of report.checks) {
    const status =
      check.status === "pass"
        ? chalk.green("PASS")
        : check.status === "fail"
          ? chalk.red("FAIL")
          : chalk.yellow("SKIP");
    console.log(`- ${check.name}: ${status} (${check.message})`);
  }

  if (report.adapters.length > 0) {
    console.log();
    console.log(chalk.bold("Adapters"));
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
    const readiness = report.morphoBorrowReadiness;
    console.log();
    console.log(chalk.bold("Morpho Borrow Readiness"));
    console.log(`Status: ${readiness.status}`);
    if (readiness.walletAddress) console.log(`Wallet: ${readiness.walletAddress}`);
    if (readiness.marketId) console.log(`Market ID: ${readiness.marketId}`);
    if (readiness.marketOnchainId) console.log(`Market Onchain ID: ${readiness.marketOnchainId}`);
    if (readiness.loanToken) console.log(`Loan Token: ${readiness.loanToken}`);
    if (readiness.collateralToken) console.log(`Collateral Token: ${readiness.collateralToken}`);
    if (readiness.morphoAddress) console.log(`Morpho Address: ${readiness.morphoAddress}`);
    if (readiness.walletCollateralBalance !== undefined) {
      console.log(`Wallet Collateral Balance: ${readiness.walletCollateralBalance}`);
    }
    if (readiness.collateralAllowance !== undefined) {
      console.log(`Collateral Allowance: ${readiness.collateralAllowance}`);
    }
    if (readiness.positionCollateral !== undefined) {
      console.log(`Position Collateral: ${readiness.positionCollateral}`);
    }
    if (readiness.positionSupplyShares !== undefined) {
      console.log(`Position Supply Shares: ${readiness.positionSupplyShares}`);
    }
    if (readiness.positionBorrowShares !== undefined) {
      console.log(`Position Borrow Shares: ${readiness.positionBorrowShares}`);
    }
    if (readiness.reasons.length > 0) {
      console.log(`Reasons: ${readiness.reasons.join("; ")}`);
    }
  }
}

function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0))
  );

  const formatRow = (row: string[]): string =>
    row.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ");

  console.log(formatRow(headers));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) {
    console.log(formatRow(row));
  }
}

const MORPHO_BLUE_ADDRESS = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb" as Address;

async function collectMorphoBorrowReadiness(input: {
  chainId: number | undefined;
  provider: ProviderLike | undefined;
  env: Record<string, string | undefined>;
}): Promise<MorphoBorrowReadinessReport> {
  if (input.chainId === undefined) {
    return {
      status: "skip",
      borrowReady: false,
      reasons: ["Skipped Morpho readiness (provide --chain)."],
    };
  }

  const market = MORPHO_BLUE_DEFAULT_MARKETS.find((entry) => entry.chainId === input.chainId);
  if (!market) {
    return {
      status: "skip",
      borrowReady: false,
      reasons: [`No built-in Morpho market metadata available for chain ${input.chainId}.`],
    };
  }

  const walletAddress = readDoctorWalletAddress(input.env);
  const marketOnchainId = getMorphoBlueMarketId(market);
  const base: MorphoBorrowReadinessReport = {
    status: "not_ready",
    borrowReady: false,
    walletAddress,
    marketId: market.id,
    marketOnchainId,
    morphoAddress: MORPHO_BLUE_ADDRESS,
    loanToken: market.loanToken,
    collateralToken: market.collateralToken,
    reasons: [],
  };

  if (!walletAddress) {
    base.reasons.push(
      "Wallet address missing. Set GRIMOIRE_WALLET_ADDRESS or WALLET_ADDRESS for Morpho diagnostics."
    );
    return base;
  }

  if (!input.provider?.getClient) {
    base.status = "skip";
    base.reasons.push("RPC provider unavailable for Morpho readiness checks.");
    return base;
  }

  const client = input.provider.getClient();
  if (typeof client?.readContract !== "function") {
    base.status = "skip";
    base.reasons.push("Provider client does not expose readContract.");
    return base;
  }
  const readContract = client.readContract as (params: Record<string, unknown>) => Promise<unknown>;

  try {
    const [walletCollateralBalanceRaw, collateralAllowanceRaw, positionRaw] = await Promise.all([
      readContract({
        address: market.collateralToken,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [walletAddress],
      }),
      readContract({
        address: market.collateralToken,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [walletAddress, MORPHO_BLUE_ADDRESS],
      }),
      readContract({
        address: MORPHO_BLUE_ADDRESS,
        abi: MORPHO_ABI,
        functionName: "position",
        args: [marketOnchainId, walletAddress],
      }),
    ]);

    const walletCollateralBalance = toBigIntOrZero(walletCollateralBalanceRaw);
    const collateralAllowance = toBigIntOrZero(collateralAllowanceRaw);
    const position = parseMorphoPosition(positionRaw);

    base.walletCollateralBalance = walletCollateralBalance.toString();
    base.collateralAllowance = collateralAllowance.toString();
    base.positionSupplyShares = position.supplyShares.toString();
    base.positionBorrowShares = position.borrowShares.toString();
    base.positionCollateral = position.collateral.toString();

    if (walletCollateralBalance <= 0n) {
      base.reasons.push("Wallet collateral token balance is zero.");
    }
    if (collateralAllowance <= 0n) {
      base.reasons.push("Collateral allowance to Morpho is zero.");
    }
    if (position.collateral <= 0n) {
      base.reasons.push("Position collateral is zero for selected market.");
    }
  } catch (error) {
    base.reasons.push(`Morpho readiness query failed: ${(error as Error).message}`);
    return base;
  }

  base.borrowReady = base.reasons.length === 0;
  base.status = base.borrowReady ? "ready" : "not_ready";
  return base;
}

function formatMorphoReadinessMessage(readiness: MorphoBorrowReadinessReport): string {
  const summary =
    readiness.status === "ready"
      ? "Borrow readiness checks passed."
      : readiness.status === "skip"
        ? "Morpho readiness checks skipped."
        : "Borrow readiness checks failed.";
  if (readiness.reasons.length === 0) {
    return summary;
  }
  return `${summary} ${readiness.reasons.join(" ")}`;
}

function parseMorphoPosition(value: unknown): {
  supplyShares: bigint;
  borrowShares: bigint;
  collateral: bigint;
} {
  if (Array.isArray(value)) {
    return {
      supplyShares: toBigIntOrZero(value[0]),
      borrowShares: toBigIntOrZero(value[1]),
      collateral: toBigIntOrZero(value[2]),
    };
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return {
      supplyShares: toBigIntOrZero(record.supplyShares ?? record["0"]),
      borrowShares: toBigIntOrZero(record.borrowShares ?? record["1"]),
      collateral: toBigIntOrZero(record.collateral ?? record["2"]),
    };
  }

  return { supplyShares: 0n, borrowShares: 0n, collateral: 0n };
}

function toBigIntOrZero(value: unknown): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return 0n;
    return BigInt(Math.floor(value));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return 0n;
    try {
      return BigInt(trimmed);
    } catch {
      return 0n;
    }
  }
  return 0n;
}

function readDoctorWalletAddress(env: Record<string, string | undefined>): Address | undefined {
  const candidate = env.GRIMOIRE_WALLET_ADDRESS ?? env.WALLET_ADDRESS ?? env.VAULT_ADDRESS;
  if (!candidate) {
    return undefined;
  }
  const trimmed = candidate.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    return trimmed as Address;
  }
  return undefined;
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
