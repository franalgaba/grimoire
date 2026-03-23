/**
 * Morpho Blue Readiness Checks + Report Formatting
 * Collects on-chain data to assess Morpho borrow readiness
 */

import type { Address } from "@grimoirelabs/core";
import { getMorphoBlueMarketId, MORPHO_BLUE_DEFAULT_MARKETS } from "@grimoirelabs/venues";
import chalk from "chalk";
import { parseAbi } from "viem";

export type MorphoBorrowReadinessStatus = "ready" | "not_ready" | "skip";

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

export interface PublicClientLike {
  readContract?: unknown;
}

export interface ProviderLike {
  getBlockNumber(): Promise<bigint>;
  getClient?: () => PublicClientLike;
  readonly rpcUrl?: string;
}

const ERC20_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

const MORPHO_ABI = parseAbi([
  "function position(bytes32 marketId, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
]);

const MORPHO_BLUE_ADDRESS = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb" as Address;

export async function collectMorphoBorrowReadiness(input: {
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

export function formatMorphoReadinessMessage(readiness: MorphoBorrowReadinessReport): string {
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

export function printMorphoBorrowReadinessSection(readiness: MorphoBorrowReadinessReport): void {
  console.error();
  console.error(chalk.bold("Morpho Borrow Readiness"));
  console.error(`Status: ${readiness.status}`);
  if (readiness.walletAddress) console.error(`Wallet: ${readiness.walletAddress}`);
  if (readiness.marketId) console.error(`Market ID: ${readiness.marketId}`);
  if (readiness.marketOnchainId) console.error(`Market Onchain ID: ${readiness.marketOnchainId}`);
  if (readiness.loanToken) console.error(`Loan Token: ${readiness.loanToken}`);
  if (readiness.collateralToken) console.error(`Collateral Token: ${readiness.collateralToken}`);
  if (readiness.morphoAddress) console.error(`Morpho Address: ${readiness.morphoAddress}`);
  if (readiness.walletCollateralBalance !== undefined) {
    console.error(`Wallet Collateral Balance: ${readiness.walletCollateralBalance}`);
  }
  if (readiness.collateralAllowance !== undefined) {
    console.error(`Collateral Allowance: ${readiness.collateralAllowance}`);
  }
  if (readiness.positionCollateral !== undefined) {
    console.error(`Position Collateral: ${readiness.positionCollateral}`);
  }
  if (readiness.positionSupplyShares !== undefined) {
    console.error(`Position Supply Shares: ${readiness.positionSupplyShares}`);
  }
  if (readiness.positionBorrowShares !== undefined) {
    console.error(`Position Borrow Shares: ${readiness.positionBorrowShares}`);
  }
  if (readiness.reasons.length > 0) {
    console.error(`Reasons: ${readiness.reasons.join("; ")}`);
  }
}

export function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0))
  );

  const formatRow = (row: string[]): string =>
    row.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ");

  console.error(formatRow(headers));
  console.error(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) {
    console.error(formatRow(row));
  }
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
