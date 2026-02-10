/**
 * Receipt and Value-Flow types for preview/commit execution model (SPEC-004)
 */

import type { Action, ActionConstraintsResolved } from "./actions.js";
import type { ExecutionMetrics, LedgerEntry } from "./execution.js";
import type { Address, AssetId, BasisPoints, ChainId, Timestamp } from "./primitives.js";

// =============================================================================
// VALUE DELTA
// =============================================================================

/** Tracks a single asset movement during execution */
export interface ValueDelta {
  asset: AssetId;
  amount: bigint;
  from: Address;
  to: Address;
  reason: string;
}

// =============================================================================
// DRIFT KEYS
// =============================================================================

/** Captures a preview-time value for commit-time drift checking */
export interface DriftKey {
  field: string;
  previewValue: unknown;
  timestamp: Timestamp;
  source: string;
}

/** Policy controlling acceptable drift between preview and commit */
export interface DriftPolicy {
  balance?: { toleranceBps: BasisPoints };
  quote?: { toleranceBps: BasisPoints };
  rate?: { toleranceBps: BasisPoints };
  gas?: { toleranceBps: BasisPoints };
  /** Maximum seconds since preview before commit is rejected */
  maxAge?: number;
}

/** Result of a single drift check at commit time */
export interface DriftCheckResult {
  field: string;
  passed: boolean;
  previewValue: unknown;
  commitValue: unknown;
  driftBps?: BasisPoints;
}

// =============================================================================
// RECEIPT SUB-RECORDS
// =============================================================================

/** Result of a guard evaluation during preview */
export interface GuardResult {
  guardId: string;
  passed: boolean;
  severity: string;
  message?: string;
}

/** Result of an advisory resolution during preview */
export interface AdvisoryResult {
  stepId: string;
  advisor: string;
  output: unknown;
  fallback: boolean;
}

/** A planned on-chain action collected during preview */
export interface PlannedAction {
  stepId: string;
  action: Action;
  venue: string;
  constraints: ActionConstraintsResolved;
  simulationResult?: {
    success: boolean;
    gasEstimate: string;
    input: { asset: string; amount: string };
    output: { asset: string; amount: string };
  };
  valueDeltas: ValueDelta[];
}

/** Stub for Phase 5 — provenance tracking for preview values */
export type PreviewProvenance =
  | { type: "deterministic_stub" }
  | { type: "provider_quote"; provider: string; timestamp: Timestamp }
  | { type: "fork_call"; blockNumber: bigint; timestamp: Timestamp };

/** Stub for Phase 2 — constraint check results */
export interface ConstraintCheckResult {
  stepId: string;
  constraintName: string;
  passed: boolean;
  actual?: unknown;
  limit?: unknown;
  message?: string;
}

// =============================================================================
// RECEIPT
// =============================================================================

/** Receipt status */
export type ReceiptStatus = "ready" | "rejected" | "expired" | "committed";

/** The canonical preview receipt — the artifact produced by preview() */
export interface Receipt {
  id: string;
  spellId: string;
  phase: "preview";
  timestamp: Timestamp;
  chainContext: {
    chainId: ChainId;
    vault: Address;
  };
  guardResults: GuardResult[];
  advisoryResults: AdvisoryResult[];
  plannedActions: PlannedAction[];
  valueDeltas: ValueDelta[];
  constraintResults: ConstraintCheckResult[];
  driftKeys: DriftKey[];
  requiresApproval: boolean;
  status: ReceiptStatus;
  metrics: ExecutionMetrics;
  finalState: Record<string, unknown>;
  error?: string;
}

// =============================================================================
// PREVIEW / COMMIT RESULTS
// =============================================================================

/** Result of preview() */
export interface PreviewResult {
  success: boolean;
  receipt?: Receipt;
  error?: string;
  ledgerEvents: LedgerEntry[];
}

/** Result of commit() */
export interface CommitResult {
  success: boolean;
  receiptId: string;
  transactions: Array<{
    stepId: string;
    hash?: string;
    gasUsed?: bigint;
    success: boolean;
    error?: string;
  }>;
  driftChecks: DriftCheckResult[];
  finalState: Record<string, unknown>;
  ledgerEvents: LedgerEntry[];
  error?: string;
}

// =============================================================================
// STRUCTURED ERROR
// =============================================================================

/** Structured error with phase and constraint context */
export interface StructuredError {
  phase: "preview" | "commit";
  code: string;
  constraint?: string;
  actual?: unknown;
  limit?: unknown;
  path?: string;
  suggestion?: string;
  message: string;
}
