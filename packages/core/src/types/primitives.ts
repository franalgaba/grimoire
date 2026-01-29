/**
 * Primitive types used throughout Grimoire
 */

/** EIP-155 chain ID */
export type ChainId = number;

/** 0x-prefixed Ethereum address (40 hex chars) */
export type Address = `0x${string}`;

/** Asset identifier - symbol or chain:address */
export type AssetId = string;

/** Unix timestamp in milliseconds */
export type Timestamp = number;

/** Basis points (1 = 0.01%) */
export type BasisPoints = number;

/** Hex-encoded data */
export type HexString = `0x${string}`;

/** Amount with asset context */
export interface Amount {
  asset: AssetId;
  value: bigint;
  decimals: number;
}

/** Venue alias definition */
export interface VenueAlias {
  alias: string;
  chain: ChainId;
  address: Address;
  label?: string;
}

/** Asset definition */
export interface AssetDef {
  symbol: string;
  chain: ChainId;
  address: Address;
  decimals?: number;
}

/** Parameter definition */
export interface ParamDef {
  name: string;
  type: "number" | "bool" | "address" | "asset" | "string";
  default?: unknown;
  min?: number;
  max?: number;
}

/** State field definition */
export interface StateField {
  key: string;
  initialValue: unknown;
}

/** Trigger definition */
export type Trigger =
  | { type: "manual" }
  | { type: "schedule"; cron: string }
  | { type: "condition"; expression: string; pollInterval: number }
  | { type: "any"; triggers: Trigger[] };

/** Wallet mode for execution */
export type WalletMode = "read-only" | "approval-required" | "limited";

/** Common chains */
export const CHAINS = {
  ETHEREUM: 1,
  ARBITRUM: 42161,
  BASE: 8453,
} as const;
