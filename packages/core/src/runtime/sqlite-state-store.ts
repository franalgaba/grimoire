/**
 * SQLite-based StateStore implementation
 * Uses bun:sqlite for zero-dependency persistence
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { LedgerEntry } from "../types/execution.js";
import type { RunRecord, StateStore } from "./state-store.js";

export interface SqliteStateStoreOptions {
  /** Path to SQLite database file (default: .grimoire/grimoire.db) */
  dbPath?: string;
  /** Maximum number of run records per spell before pruning (default: 100) */
  maxRuns?: number;
}

const DEFAULT_DB_PATH = ".grimoire/grimoire.db";
const DEFAULT_MAX_RUNS = 100;

export class SqliteStateStore implements StateStore {
  private db: Database;
  private maxRuns: number;

  constructor(options: SqliteStateStoreOptions = {}) {
    const dbPath = options.dbPath ?? DEFAULT_DB_PATH;
    this.maxRuns = options.maxRuns ?? DEFAULT_MAX_RUNS;

    // Ensure parent directory exists
    mkdirSync(dirname(dbPath), { recursive: true });

    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS spell_state (
        spell_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        spell_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        success INTEGER NOT NULL,
        error TEXT,
        duration INTEGER NOT NULL,
        metrics TEXT NOT NULL,
        final_state TEXT NOT NULL,
        UNIQUE(spell_id, run_id)
      );

      CREATE TABLE IF NOT EXISTS ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        spell_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        entries TEXT NOT NULL,
        UNIQUE(spell_id, run_id)
      );
    `);
  }

  async load(spellId: string): Promise<Record<string, unknown> | null> {
    const row = this.db
      .query<{ state: string }, [string]>("SELECT state FROM spell_state WHERE spell_id = ?")
      .get(spellId);

    if (!row) return null;
    return JSON.parse(row.state);
  }

  async save(spellId: string, state: Record<string, unknown>): Promise<void> {
    this.db
      .query(
        `INSERT INTO spell_state (spell_id, state, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(spell_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`
      )
      .run(spellId, JSON.stringify(state), new Date().toISOString());
  }

  async addRun(spellId: string, run: RunRecord): Promise<void> {
    const tx = this.db.transaction(() => {
      this.db
        .query(
          `INSERT INTO runs (spell_id, run_id, timestamp, success, error, duration, metrics, final_state)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          spellId,
          run.runId,
          run.timestamp,
          run.success ? 1 : 0,
          run.error ?? null,
          run.duration,
          JSON.stringify(run.metrics),
          JSON.stringify(run.finalState)
        );

      // Prune old runs beyond maxRuns
      this.db
        .query(
          `DELETE FROM runs WHERE spell_id = ? AND id NOT IN (
             SELECT id FROM runs WHERE spell_id = ? ORDER BY id DESC LIMIT ?
           )`
        )
        .run(spellId, spellId, this.maxRuns);
    });

    tx();
  }

  async getRuns(spellId: string, limit?: number): Promise<RunRecord[]> {
    const query = limit
      ? "SELECT * FROM runs WHERE spell_id = ? ORDER BY id DESC LIMIT ?"
      : "SELECT * FROM runs WHERE spell_id = ? ORDER BY id DESC";

    const rows = limit
      ? this.db.query<RunRow, [string, number]>(query).all(spellId, limit)
      : this.db.query<RunRow, [string]>(query).all(spellId);

    return rows.map(rowToRunRecord);
  }

  async saveLedger(spellId: string, runId: string, entries: LedgerEntry[]): Promise<void> {
    this.db
      .query(
        `INSERT INTO ledger (spell_id, run_id, entries)
         VALUES (?, ?, ?)
         ON CONFLICT(spell_id, run_id) DO UPDATE SET entries = excluded.entries`
      )
      .run(spellId, runId, JSON.stringify(entries, bigintReplacer));
  }

  async loadLedger(spellId: string, runId: string): Promise<LedgerEntry[] | null> {
    const row = this.db
      .query<{ entries: string }, [string, string]>(
        "SELECT entries FROM ledger WHERE spell_id = ? AND run_id = ?"
      )
      .get(spellId, runId);

    if (!row) return null;
    return JSON.parse(row.entries);
  }

  async listSpells(): Promise<string[]> {
    const rows = this.db
      .query<{ spell_id: string }, []>("SELECT spell_id FROM spell_state ORDER BY spell_id")
      .all();

    return rows.map((r) => r.spell_id);
  }

  /** Close the database connection */
  close(): void {
    this.db.close();
  }
}

interface RunRow {
  id: number;
  spell_id: string;
  run_id: string;
  timestamp: string;
  success: number;
  error: string | null;
  duration: number;
  metrics: string;
  final_state: string;
}

function rowToRunRecord(row: RunRow): RunRecord {
  return {
    runId: row.run_id,
    timestamp: row.timestamp,
    success: row.success === 1,
    error: row.error ?? undefined,
    duration: row.duration,
    metrics: JSON.parse(row.metrics),
    finalState: JSON.parse(row.final_state),
  };
}

/** JSON replacer that converts bigint values to strings */
function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
