/**
 * Shared state persistence helpers for CLI commands
 */

import { join } from "node:path";
import {
  type ExecutionResult,
  type RunProvenance,
  type RunRecord,
  SqliteStateStore,
  createRunRecord,
} from "@grimoirelabs/core";

interface StatePersistenceOptions {
  stateDir?: string;
  noState?: boolean;
  buildRunProvenance?: (result: ExecutionResult) => RunProvenance | undefined;
}

/**
 * Wraps an execution function with state load/save lifecycle.
 *
 * 1. Load persistent state from the store
 * 2. Call executeFn with the loaded state
 * 3. Save updated state, run record, and ledger
 */
export async function withStatePersistence(
  spellId: string,
  options: StatePersistenceOptions,
  executeFn: (persistentState: Record<string, unknown>) => Promise<ExecutionResult>
): Promise<ExecutionResult> {
  if (options.noState) {
    return executeFn({});
  }

  const dbPath = options.stateDir ? join(options.stateDir, "grimoire.db") : undefined;

  const store = new SqliteStateStore({ dbPath });

  try {
    // Load existing state
    const persistentState = (await store.load(spellId)) ?? {};

    // Execute
    const result = await executeFn(persistentState);

    // Persist results
    await store.save(spellId, result.finalState);
    await store.addRun(spellId, createRunRecord(result, options.buildRunProvenance?.(result)));
    await store.saveLedger(spellId, result.runId, result.ledgerEvents);

    return result;
  } finally {
    store.close();
  }
}

export async function loadRunRecords(
  spellId: string,
  options: Pick<StatePersistenceOptions, "stateDir">
): Promise<RunRecord[]> {
  const dbPath = options.stateDir ? join(options.stateDir, "grimoire.db") : undefined;
  const store = new SqliteStateStore({ dbPath });
  try {
    return await store.getRuns(spellId);
  } finally {
    store.close();
  }
}
