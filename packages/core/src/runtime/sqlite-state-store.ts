/**
 * SQLite-based StateStore implementation
 * Uses bun:sqlite when available, otherwise falls back to better-sqlite3.
 */

import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
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

type SqliteStatement<T, P extends unknown[]> = {
  get: (...params: P) => T | undefined;
  all: (...params: P) => T[];
  run: (...params: P) => void;
};

type DatabaseLike = {
  exec: (sql: string) => void;
  query: <T, P extends unknown[]>(sql: string) => SqliteStatement<T, P>;
  transaction: (fn: () => void) => () => void;
  close: () => void;
};

type BetterSqliteStatement = {
  get: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => unknown[];
  run: (...params: unknown[]) => void;
};

type BetterSqliteDatabase = {
  exec: (sql: string) => void;
  prepare: (sql: string) => BetterSqliteStatement;
  transaction: (fn: () => void) => () => void;
  close: () => void;
};

type BetterSqliteModule = new (path: string) => BetterSqliteDatabase;

class BetterSqliteAdapter implements DatabaseLike {
  private db: BetterSqliteDatabase;

  constructor(dbPath: string) {
    const BetterSqlite = loadBetterSqlite3();
    this.db = new BetterSqlite(dbPath);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  query<T, P extends unknown[]>(sql: string): SqliteStatement<T, P> {
    const stmt = this.db.prepare(sql);
    return {
      get: (...params: P) => stmt.get(...params) as T | undefined,
      all: (...params: P) => stmt.all(...params) as T[],
      run: (...params: P) => {
        stmt.run(...params);
      },
    };
  }

  transaction(fn: () => void): () => void {
    const wrapped = this.db.transaction(fn);
    return () => {
      wrapped();
    };
  }

  close(): void {
    this.db.close();
  }
}

function loadBetterSqlite3(): BetterSqliteModule {
  const require = createRequire(import.meta.url);
  try {
    return require("better-sqlite3") as BetterSqliteModule;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `SqliteStateStore requires bun:sqlite (Bun) or better-sqlite3 (Node). Install better-sqlite3 to use SqliteStateStore in Node (npm i better-sqlite3). (${message})`
    );
  }
}

function createDatabase(dbPath: string): DatabaseLike {
  const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
  if (isBun) {
    const require = createRequire(import.meta.url);
    const { Database } = require("bun:sqlite") as { Database: new (path: string) => DatabaseLike };
    return new Database(dbPath);
  }
  return new BetterSqliteAdapter(dbPath);
}

export class SqliteStateStore implements StateStore {
  private db: DatabaseLike;
  private maxRuns: number;

  constructor(options: SqliteStateStoreOptions = {}) {
    const dbPath = options.dbPath ?? DEFAULT_DB_PATH;
    this.maxRuns = options.maxRuns ?? DEFAULT_MAX_RUNS;

    // Ensure parent directory exists
    mkdirSync(dirname(dbPath), { recursive: true });

    this.db = createDatabase(dbPath);
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
        provenance TEXT,
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

    this.ensureRunsSchema();
  }

  private ensureRunsSchema(): void {
    const columns = this.db.query<{ name: string }, []>("PRAGMA table_info(runs)").all();
    const hasProvenance = columns.some((column) => column.name === "provenance");
    if (!hasProvenance) {
      this.db.exec("ALTER TABLE runs ADD COLUMN provenance TEXT");
    }
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
          `INSERT INTO runs (spell_id, run_id, timestamp, success, error, duration, metrics, provenance, final_state)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          spellId,
          run.runId,
          run.timestamp,
          run.success ? 1 : 0,
          run.error ?? null,
          run.duration,
          JSON.stringify(run.metrics),
          run.provenance ? JSON.stringify(run.provenance) : null,
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
  provenance: string | null;
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
    provenance: row.provenance ? JSON.parse(row.provenance) : undefined,
    finalState: JSON.parse(row.final_state),
  };
}

/** JSON replacer that converts bigint values to strings */
function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
