/**
 * Policy types for risk controls
 */

import type { Address, AssetId, BasisPoints, ChainId } from "./primitives.js";

/**
 * Policy set for controlling strategy execution
 */
export interface PolicySet {
  id: string;
  version: string;
  owner: Address;

  /** Venue access controls */
  venueRules: {
    allowedAliases?: string[];
    deniedAliases?: string[];
    allowedAddresses?: Array<{ chain: ChainId; address: Address }>;
    deniedAddresses?: Array<{ chain: ChainId; address: Address }>;
    allowedChains?: ChainId[];
  };

  /** Asset access controls */
  assetRules: {
    allowedAssets?: AssetId[];
    deniedAssets?: AssetId[];
  };

  /** Exposure limits */
  exposureLimits: ExposureLimit[];

  /** Slippage constraints */
  slippageLimit: {
    maxBps: BasisPoints;
    perAsset?: Record<AssetId, BasisPoints>;
  };

  /** Leverage constraints */
  leverageLimit?: {
    maxGross: number;
    maxNet: number;
  };

  /** Minimum liquidity to maintain */
  liquidityFloor?: {
    asset: AssetId;
    minAbsolute?: bigint;
    minPercentNAV?: number;
  };

  /** Gas limits */
  gasLimit?: {
    maxPerAction: bigint;
    maxPerRun: bigint;
  };

  /** Time-based trading windows */
  timeWindows?: Array<{
    start: string; // HH:MM UTC
    end: string;
    days?: number[]; // 0=Sun, 6=Sat
  }>;

  /** Approval thresholds */
  approvalThresholds?: Array<{
    condition: "amount_above" | "exposure_above" | "new_venue" | "new_asset";
    threshold?: bigint | number;
    approvers: Address[];
    requiredCount: number;
  }>;

  /** Circuit breakers */
  circuitBreakers: CircuitBreaker[];

  /** Emergency unwind procedure */
  unwindRecipe?: {
    priority: AssetId[];
    targetAsset: AssetId;
    maxSlippageBps: BasisPoints;
    maxDuration: number;
  };
}

/** Exposure limit definition */
export interface ExposureLimit {
  scope: "asset" | "venue" | "chain";
  target: string;
  maxAbsolute?: bigint;
  maxPercentNAV?: number;
}

/** Circuit breaker triggers */
export type CircuitBreakerTrigger =
  | { type: "oracle_deviation"; maxBps: BasisPoints; window: number }
  | { type: "cumulative_slippage"; maxBps: BasisPoints; window: number }
  | { type: "revert_rate"; maxPercent: number; window: number }
  | { type: "gas_spike"; maxMultiple: number }
  | { type: "nav_drawdown"; maxBps: BasisPoints; window: number };

/** Circuit breaker definition */
export interface CircuitBreaker {
  id: string;
  trigger: CircuitBreakerTrigger;
  action: "pause" | "unwind" | "alert";
  cooldown?: number;
}

/** Result of policy check */
export interface PolicyCheckResult {
  allowed: boolean;
  violations: string[];
  warnings: string[];
}

/** Exposure calculation result */
export interface ExposureResult {
  absolute: bigint;
  percentNAV: number;
}
