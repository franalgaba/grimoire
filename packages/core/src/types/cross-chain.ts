/**
 * Cross-chain runtime and persistence types.
 */

import type { Address, ChainId } from "./primitives.js";

export type CrossChainTrackRole = "source" | "destination";

export type CrossChainTrackStatus = "pending" | "running" | "waiting" | "completed" | "failed";

export type CrossChainHandoffStatus = "planned" | "submitted" | "settled" | "expired" | "failed";

export type CrossChainStepStatus = "pending" | "submitted" | "confirmed" | "failed";

export interface CrossChainTrackReceiptEntry {
  trackId: string;
  role: CrossChainTrackRole;
  spellId: string;
  chainId: ChainId;
  status: CrossChainTrackStatus;
  lastStepId?: string;
  error?: string;
}

export interface CrossChainHandoffReceiptEntry {
  handoffId: string;
  sourceTrackId: string;
  destinationTrackId: string;
  sourceStepId: string;
  originChainId: ChainId;
  destinationChainId: ChainId;
  asset: string;
  submittedAmount: bigint;
  settledAmount?: bigint;
  status: CrossChainHandoffStatus;
  reference?: string;
  originTxHash?: string;
  reason?: string;
}

export interface CrossChainReceipt {
  runId: string;
  sourceSpellId: string;
  destinationSpellId: string;
  sourceChainId: ChainId;
  destinationChainId: ChainId;
  tracks: CrossChainTrackReceiptEntry[];
  handoffs: CrossChainHandoffReceiptEntry[];
}

export interface RunTrackRecord {
  runId: string;
  trackId: string;
  role: CrossChainTrackRole;
  spellId: string;
  chainId: ChainId;
  status: CrossChainTrackStatus;
  lastStepId?: string;
  error?: string;
  updatedAt: string;
}

export interface RunHandoffRecord {
  runId: string;
  handoffId: string;
  sourceTrackId: string;
  destinationTrackId: string;
  sourceStepId: string;
  originChainId: ChainId;
  destinationChainId: ChainId;
  asset: string;
  submittedAmount: string;
  settledAmount?: string;
  status: CrossChainHandoffStatus;
  reference?: string;
  originTxHash?: string;
  reason?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export interface RunStepResultRecord {
  runId: string;
  trackId: string;
  stepId: string;
  status: CrossChainStepStatus;
  idempotencyKey: string;
  reference?: string;
  error?: string;
  updatedAt: string;
}

export type BridgeLifecycleStatus = "pending" | "settled" | "failed" | "expired";

export interface BridgeLifecycleStatusInput {
  handoffId: string;
  originChainId: ChainId;
  destinationChainId: ChainId;
  originTxHash?: string;
  reference?: string;
  asset?: string;
  submittedAmount?: bigint;
  walletAddress?: Address;
}

export interface BridgeLifecycleStatusResult {
  status: BridgeLifecycleStatus;
  settledAmount?: bigint;
  reference?: string;
  reason?: string;
}

export interface BridgeLifecycleAdapter {
  resolveHandoffStatus: (input: BridgeLifecycleStatusInput) => Promise<BridgeLifecycleStatusResult>;
}
