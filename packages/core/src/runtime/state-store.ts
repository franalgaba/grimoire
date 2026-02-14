/**
 * State Store interface and helpers
 * Abstract persistence layer for spell state across runs
 */

import type {
  CrossChainReceipt,
  RunHandoffRecord,
  RunStepResultRecord,
  RunTrackRecord,
} from "../types/cross-chain.js";
import type { ExecutionMetrics, ExecutionResult, LedgerEntry } from "../types/execution.js";

/**
 * Serialized run metrics (bigint → string)
 */
export interface RunMetrics {
  stepsExecuted: number;
  actionsExecuted: number;
  gasUsed: string;
  advisoryCalls: number;
  errors: number;
  retries: number;
}

export type RunProvenance = object;

/**
 * Record of a single spell execution
 */
export interface RunRecord {
  runId: string;
  timestamp: string;
  success: boolean;
  error?: string;
  duration: number;
  metrics: RunMetrics;
  finalState: Record<string, unknown>;
  provenance?: RunProvenance;
  crossChain?: CrossChainReceipt;
}

/**
 * Abstract interface for persisting spell state and run history
 */
export interface StateStore {
  /** Load persistent state for a spell (null if never saved) */
  load(spellId: string): Promise<Record<string, unknown> | null>;

  /** Save persistent state for a spell */
  save(spellId: string, state: Record<string, unknown>): Promise<void>;

  /** Append a run record */
  addRun(spellId: string, run: RunRecord): Promise<void>;

  /** Load a run record by run id */
  getRunById(runId: string): Promise<RunRecord | null>;

  /** Get run records, most recent first */
  getRuns(spellId: string, limit?: number): Promise<RunRecord[]>;

  /** Save ledger entries for a run */
  saveLedger(spellId: string, runId: string, entries: LedgerEntry[]): Promise<void>;

  /** Load ledger entries for a run */
  loadLedger(spellId: string, runId: string): Promise<LedgerEntry[] | null>;

  /** List all spell IDs with saved state */
  listSpells(): Promise<string[]>;

  /** Upsert per-track status for cross-chain orchestration */
  upsertRunTrack(track: RunTrackRecord): Promise<void>;

  /** Read per-track status for a logical run */
  getRunTracks(runId: string): Promise<RunTrackRecord[]>;

  /** Upsert a handoff lifecycle record for a logical run */
  upsertRunHandoff(handoff: RunHandoffRecord): Promise<void>;

  /** Read handoff lifecycle records for a logical run */
  getRunHandoffs(runId: string): Promise<RunHandoffRecord[]>;

  /** Upsert idempotent step execution status for a logical run */
  upsertRunStepResult(step: RunStepResultRecord): Promise<void>;

  /** Read idempotent step execution statuses for a logical run */
  getRunStepResults(runId: string): Promise<RunStepResultRecord[]>;
}

/**
 * Serialize ExecutionMetrics to RunMetrics (bigint → string)
 */
function serializeMetrics(metrics: ExecutionMetrics): RunMetrics {
  return {
    stepsExecuted: metrics.stepsExecuted,
    actionsExecuted: metrics.actionsExecuted,
    gasUsed: metrics.gasUsed.toString(),
    advisoryCalls: metrics.advisoryCalls,
    errors: metrics.errors,
    retries: metrics.retries,
  };
}

/**
 * Create a RunRecord from an ExecutionResult
 */
export function createRunRecord(result: ExecutionResult, provenance?: RunProvenance): RunRecord {
  return {
    runId: result.runId,
    timestamp: new Date(result.startTime).toISOString(),
    success: result.success,
    error: result.error,
    duration: result.duration,
    metrics: serializeMetrics(result.metrics),
    finalState: result.finalState,
    provenance,
    crossChain: result.crossChain,
  };
}
