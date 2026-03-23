/**
 * Shared execution helpers for cast and simulate commands
 */

import type {
  CrossChainReceipt,
  execute,
  LedgerEntry,
  LedgerEvent,
  RunHandoffRecord,
  RunStepResultRecord,
  RunTrackRecord,
  SqliteStateStore,
} from "@grimoirelabs/core";
import { parseRpcUrlMappings, resolveRpcUrlForChain } from "../commands/cross-chain-helpers.js";

export function resolveNoState(options: { noState?: boolean; state?: boolean }): boolean {
  if (typeof options.noState === "boolean") return options.noState;
  if (options.state === false) return true;
  return false;
}

export function isMissingNodeSqliteBackend(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes(
    "SqliteStateStore requires bun:sqlite (Bun) or better-sqlite3 (Node)"
  );
}

export function parseRequiredNumber(value: string | undefined, flag: string): number {
  if (!value) {
    throw new Error(`${flag} is required in cross-chain mode`);
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resolveRpcUrlFromOption(
  chainId: number,
  value?: string | string[]
): string | undefined {
  const parsed = parseRpcUrlMappings(value);
  return resolveRpcUrlForChain(chainId, parsed);
}

export function appendLifecycleLedgerEntries(
  entries: LedgerEntry[],
  lifecycleEvents: LedgerEvent[],
  runId: string,
  spellId: string
): LedgerEntry[] {
  if (lifecycleEvents.length === 0) {
    return entries;
  }
  const start = entries.length;
  const extras = lifecycleEvents.map((event, index) => ({
    id: `evt_cc_${String(start + index).padStart(3, "0")}`,
    timestamp: Date.now(),
    runId,
    spellId,
    event,
  }));
  return [...entries, ...extras];
}

export async function persistCrossChainState(
  store: SqliteStateStore,
  input: {
    runId: string;
    tracks: CrossChainReceipt["tracks"];
    handoffs: CrossChainReceipt["handoffs"];
    sourceSpellId?: string;
    destinationSpellId?: string;
    sourceResult?: Awaited<ReturnType<typeof execute>>;
    destinationResult?: Awaited<ReturnType<typeof execute>>;
  }
): Promise<void> {
  const nowIso = new Date().toISOString();
  for (const track of input.tracks) {
    const row: RunTrackRecord = {
      runId: input.runId,
      trackId: track.trackId,
      role: track.role,
      spellId: track.spellId,
      chainId: track.chainId,
      status: track.status,
      lastStepId: track.lastStepId,
      error: track.error,
      updatedAt: nowIso,
    };
    await store.upsertRunTrack(row);
  }

  for (const handoff of input.handoffs) {
    const row: RunHandoffRecord = {
      runId: input.runId,
      handoffId: handoff.handoffId,
      sourceTrackId: handoff.sourceTrackId,
      destinationTrackId: handoff.destinationTrackId,
      sourceStepId: handoff.sourceStepId,
      originChainId: handoff.originChainId,
      destinationChainId: handoff.destinationChainId,
      asset: handoff.asset,
      submittedAmount: handoff.submittedAmount.toString(),
      settledAmount: handoff.settledAmount?.toString(),
      status: handoff.status,
      reference: handoff.reference,
      originTxHash: handoff.originTxHash,
      reason: handoff.reason,
      createdAt: nowIso,
      updatedAt: nowIso,
      expiresAt: handoff.status === "expired" ? nowIso : undefined,
    };
    await store.upsertRunHandoff(row);
  }

  const sourceSteps = collectStepStatuses(input.sourceResult, "source", input.runId);
  for (const step of sourceSteps) {
    await store.upsertRunStepResult(step);
  }
  const destinationSteps = collectStepStatuses(input.destinationResult, "destination", input.runId);
  for (const step of destinationSteps) {
    await store.upsertRunStepResult(step);
  }
}

export function collectStepStatuses(
  result: Awaited<ReturnType<typeof execute>> | undefined,
  trackId: "source" | "destination",
  runId: string
): RunStepResultRecord[] {
  if (!result?.receipt) {
    return [];
  }
  const nowIso = new Date().toISOString();
  const byStep = new Map<string, RunStepResultRecord>();

  for (const planned of result.receipt.plannedActions) {
    byStep.set(planned.stepId, {
      runId,
      trackId,
      stepId: planned.stepId,
      status: "pending",
      idempotencyKey: `${runId}:${trackId}:${planned.stepId}`,
      updatedAt: nowIso,
    });
  }

  for (const tx of result.commit?.transactions ?? []) {
    const existing = byStep.get(tx.stepId);
    if (!existing) continue;
    existing.status = tx.success ? "confirmed" : "failed";
    existing.reference = tx.hash;
    existing.error = tx.error;
  }

  if (result.success && !result.commit) {
    for (const step of byStep.values()) {
      step.status = "confirmed";
    }
  }

  if (!result.success) {
    for (const step of byStep.values()) {
      if (step.status !== "confirmed") {
        step.status = "failed";
      }
    }
  }

  return [...byStep.values()];
}
