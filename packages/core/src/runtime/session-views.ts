/**
 * Session-level ledger and P&L views derived from persisted runs.
 */

import type { LedgerEntry } from "../types/execution.js";
import type { ValueDelta } from "../types/receipt.js";
import type { RunRecord, StateStore } from "./state-store.js";
import { computeAssetAccounting } from "./value-flow.js";

export interface SessionLedgerView {
  spellId: string;
  runs: {
    total: number;
    success: number;
    failed: number;
    latestRunAt?: string;
  };
  triggers: Record<string, number>;
  receipts: Record<string, number>;
  events: Record<string, number>;
}

export interface SessionPnlAssetView {
  asset: string;
  debits: string;
  credits: string;
  fees: string;
  losses: string;
  net: string;
  unaccounted: string;
}

export interface SessionPnlView {
  spellId: string;
  runCount: number;
  deltaCount: number;
  accountingPassed: boolean;
  totalUnaccounted: string;
  totalNet: string;
  assets: SessionPnlAssetView[];
}

export async function getSessionLedgerView(
  store: StateStore,
  spellId: string,
  limit = 100
): Promise<SessionLedgerView> {
  const records = await loadSessionRecords(store, spellId, limit);
  const runs = records.map((record) => record.run);
  const entries = records.flatMap((record) => record.ledger);

  const triggers: Record<string, number> = {};
  const receipts: Record<string, number> = {};
  const events: Record<string, number> = {};

  for (const entry of entries) {
    increment(events, entry.event.type);

    if (entry.event.type === "run_started") {
      increment(triggers, entry.event.trigger.type);
    }

    if (entry.event.type === "preview_completed") {
      increment(receipts, entry.event.status);
    }
  }

  return {
    spellId,
    runs: {
      total: runs.length,
      success: runs.filter((run) => run.success).length,
      failed: runs.filter((run) => !run.success).length,
      latestRunAt: runs[0]?.timestamp,
    },
    triggers,
    receipts,
    events,
  };
}

export async function getSessionPnlView(
  store: StateStore,
  spellId: string,
  limit = 100
): Promise<SessionPnlView> {
  const records = await loadSessionRecords(store, spellId, limit);
  const valueDeltas = records.flatMap((record) => extractValueDeltas(record.ledger));
  const accounting = computeAssetAccounting(valueDeltas);
  const assets = accounting.assets.map((row) => ({
    asset: row.asset,
    debits: row.debits.toString(),
    credits: row.credits.toString(),
    fees: row.fees.toString(),
    losses: row.losses.toString(),
    net: (row.credits - row.debits - row.fees - row.losses).toString(),
    unaccounted: row.unaccounted.toString(),
  }));

  const totalNet = accounting.assets.reduce(
    (sum, row) => sum + (row.credits - row.debits - row.fees - row.losses),
    0n
  );

  return {
    spellId,
    runCount: records.length,
    deltaCount: valueDeltas.length,
    accountingPassed: accounting.passed,
    totalUnaccounted: accounting.totalUnaccounted.toString(),
    totalNet: totalNet.toString(),
    assets,
  };
}

async function loadSessionRecords(
  store: StateStore,
  spellId: string,
  limit: number
): Promise<Array<{ run: RunRecord; ledger: LedgerEntry[] }>> {
  const runs = await store.getRuns(spellId, limit);
  const ledgers = await Promise.all(
    runs.map(async (run) => {
      const ledger = (await store.loadLedger(spellId, run.runId)) ?? [];
      return { run, ledger };
    })
  );

  return ledgers;
}

function extractValueDeltas(entries: LedgerEntry[]): ValueDelta[] {
  const deltas: ValueDelta[] = [];
  for (const entry of entries) {
    if (entry.event.type === "value_delta") {
      const amount = toBigInt(entry.event.delta.amount);
      if (amount === undefined) {
        continue;
      }
      deltas.push({
        ...entry.event.delta,
        amount,
      });
    }
  }
  return deltas;
}

function increment(counter: Record<string, number>, key: string): void {
  counter[key] = (counter[key] ?? 0) + 1;
}

function toBigInt(value: unknown): bigint | undefined {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? BigInt(Math.trunc(value)) : undefined;
  }
  if (typeof value === "string" && /^[-+]?\d+$/.test(value.trim())) {
    return BigInt(value.trim());
  }
  return undefined;
}
