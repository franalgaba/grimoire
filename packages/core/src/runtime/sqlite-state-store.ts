/**
 * SQLite-based StateStore implementation
 * Uses bun:sqlite when available, otherwise falls back to better-sqlite3.
 */

import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type {
  RunHandoffRecord,
  RunStepResultRecord,
  RunTrackRecord,
} from "../types/cross-chain.js";
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
const SCHEMA_VERSION = 2;

type SqliteStatement<T, P extends unknown[] = unknown[]> = {
  get: (...params: P) => T | undefined;
  all: (...params: P) => T[];
  run: (...params: P) => void;
};

type DatabaseLike = {
  exec: (sql: string) => void;
  query: <T, P extends unknown[] = unknown[]>(sql: string) => SqliteStatement<T, P>;
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

    mkdirSync(dirname(dbPath), { recursive: true });

    this.db = createDatabase(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.initSchema();
  }

  private initSchema(): void {
    this.applyMigrations();
    this.ensureRunsColumns();
  }

  private applyMigrations(): void {
    let version = this.getSchemaVersion();

    if (version < 1) {
      const migration = this.db.transaction(() => {
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
            cross_chain TEXT,
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
        this.setSchemaVersion(1);
      });
      migration();
      version = 1;
    }

    if (version < 2) {
      const migration = this.db.transaction(() => {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS run_tracks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id TEXT NOT NULL,
            track_id TEXT NOT NULL,
            role TEXT NOT NULL,
            spell_id TEXT NOT NULL,
            chain_id INTEGER NOT NULL,
            status TEXT NOT NULL,
            last_step_id TEXT,
            error TEXT,
            updated_at TEXT NOT NULL,
            UNIQUE(run_id, track_id)
          );

          CREATE TABLE IF NOT EXISTS run_handoffs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id TEXT NOT NULL,
            handoff_id TEXT NOT NULL,
            source_track_id TEXT NOT NULL,
            destination_track_id TEXT NOT NULL,
            source_step_id TEXT NOT NULL,
            origin_chain_id INTEGER NOT NULL,
            destination_chain_id INTEGER NOT NULL,
            asset TEXT NOT NULL,
            submitted_amount TEXT NOT NULL,
            settled_amount TEXT,
            status TEXT NOT NULL,
            reference TEXT,
            origin_tx_hash TEXT,
            reason TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            expires_at TEXT,
            UNIQUE(run_id, handoff_id)
          );

          CREATE TABLE IF NOT EXISTS run_step_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id TEXT NOT NULL,
            track_id TEXT NOT NULL,
            step_id TEXT NOT NULL,
            status TEXT NOT NULL,
            idempotency_key TEXT NOT NULL,
            reference TEXT,
            error TEXT,
            updated_at TEXT NOT NULL,
            UNIQUE(run_id, track_id, step_id),
            UNIQUE(idempotency_key)
          );
        `);
        this.setSchemaVersion(2);
      });
      migration();
      version = 2;
    }

    if (version > SCHEMA_VERSION) {
      throw new Error(
        `State store schema version ${version} is newer than supported version ${SCHEMA_VERSION}`
      );
    }
  }

  private getSchemaVersion(): number {
    const row = this.db.query<{ user_version: number }, []>("PRAGMA user_version").get();
    return row?.user_version ?? 0;
  }

  private setSchemaVersion(version: number): void {
    this.db.exec(`PRAGMA user_version = ${version}`);
  }

  private ensureRunsColumns(): void {
    const columns = this.db.query<{ name: string }, []>("PRAGMA table_info(runs)").all();
    const hasProvenance = columns.some((column) => column.name === "provenance");
    const hasCrossChain = columns.some((column) => column.name === "cross_chain");
    if (!hasProvenance) {
      this.db.exec("ALTER TABLE runs ADD COLUMN provenance TEXT");
    }
    if (!hasCrossChain) {
      this.db.exec("ALTER TABLE runs ADD COLUMN cross_chain TEXT");
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
          `INSERT INTO runs (spell_id, run_id, timestamp, success, error, duration, metrics, provenance, cross_chain, final_state)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          spellId,
          run.runId,
          run.timestamp,
          run.success ? 1 : 0,
          run.error ?? null,
          run.duration,
          JSON.stringify(run.metrics),
          run.provenance ? JSON.stringify(run.provenance, bigintReplacer) : null,
          run.crossChain ? JSON.stringify(run.crossChain, bigintReplacer) : null,
          JSON.stringify(run.finalState, bigintReplacer)
        );

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

  async getRunById(runId: string): Promise<RunRecord | null> {
    const row = this.db
      .query<RunRow, [string]>("SELECT * FROM runs WHERE run_id = ? ORDER BY id DESC LIMIT 1")
      .get(runId);
    return row ? rowToRunRecord(row) : null;
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

  async upsertRunTrack(track: RunTrackRecord): Promise<void> {
    this.db
      .query(
        `INSERT INTO run_tracks (
           run_id, track_id, role, spell_id, chain_id, status, last_step_id, error, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(run_id, track_id) DO UPDATE SET
           role = excluded.role,
           spell_id = excluded.spell_id,
           chain_id = excluded.chain_id,
           status = excluded.status,
           last_step_id = excluded.last_step_id,
           error = excluded.error,
           updated_at = excluded.updated_at`
      )
      .run(
        track.runId,
        track.trackId,
        track.role,
        track.spellId,
        track.chainId,
        track.status,
        track.lastStepId ?? null,
        track.error ?? null,
        track.updatedAt
      );
  }

  async getRunTracks(runId: string): Promise<RunTrackRecord[]> {
    const rows = this.db
      .query<RunTrackRow, [string]>(
        `SELECT run_id, track_id, role, spell_id, chain_id, status, last_step_id, error, updated_at
         FROM run_tracks
         WHERE run_id = ?
         ORDER BY id ASC`
      )
      .all(runId);

    return rows.map((row) => ({
      runId: row.run_id,
      trackId: row.track_id,
      role: row.role as RunTrackRecord["role"],
      spellId: row.spell_id,
      chainId: row.chain_id,
      status: row.status as RunTrackRecord["status"],
      lastStepId: row.last_step_id ?? undefined,
      error: row.error ?? undefined,
      updatedAt: row.updated_at,
    }));
  }

  async upsertRunHandoff(handoff: RunHandoffRecord): Promise<void> {
    this.db
      .query(
        `INSERT INTO run_handoffs (
           run_id, handoff_id, source_track_id, destination_track_id, source_step_id,
           origin_chain_id, destination_chain_id, asset, submitted_amount, settled_amount,
           status, reference, origin_tx_hash, reason, created_at, updated_at, expires_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(run_id, handoff_id) DO UPDATE SET
           source_track_id = excluded.source_track_id,
           destination_track_id = excluded.destination_track_id,
           source_step_id = excluded.source_step_id,
           origin_chain_id = excluded.origin_chain_id,
           destination_chain_id = excluded.destination_chain_id,
           asset = excluded.asset,
           submitted_amount = excluded.submitted_amount,
           settled_amount = excluded.settled_amount,
           status = excluded.status,
           reference = excluded.reference,
           origin_tx_hash = excluded.origin_tx_hash,
           reason = excluded.reason,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at,
           expires_at = excluded.expires_at`
      )
      .run(
        handoff.runId,
        handoff.handoffId,
        handoff.sourceTrackId,
        handoff.destinationTrackId,
        handoff.sourceStepId,
        handoff.originChainId,
        handoff.destinationChainId,
        handoff.asset,
        handoff.submittedAmount,
        handoff.settledAmount ?? null,
        handoff.status,
        handoff.reference ?? null,
        handoff.originTxHash ?? null,
        handoff.reason ?? null,
        handoff.createdAt,
        handoff.updatedAt,
        handoff.expiresAt ?? null
      );
  }

  async getRunHandoffs(runId: string): Promise<RunHandoffRecord[]> {
    const rows = this.db
      .query<RunHandoffRow, [string]>(
        `SELECT
           run_id,
           handoff_id,
           source_track_id,
           destination_track_id,
           source_step_id,
           origin_chain_id,
           destination_chain_id,
           asset,
           submitted_amount,
           settled_amount,
           status,
           reference,
           origin_tx_hash,
           reason,
           created_at,
           updated_at,
           expires_at
         FROM run_handoffs
         WHERE run_id = ?
         ORDER BY id ASC`
      )
      .all(runId);

    return rows.map((row) => ({
      runId: row.run_id,
      handoffId: row.handoff_id,
      sourceTrackId: row.source_track_id,
      destinationTrackId: row.destination_track_id,
      sourceStepId: row.source_step_id,
      originChainId: row.origin_chain_id,
      destinationChainId: row.destination_chain_id,
      asset: row.asset,
      submittedAmount: row.submitted_amount,
      settledAmount: row.settled_amount ?? undefined,
      status: row.status as RunHandoffRecord["status"],
      reference: row.reference ?? undefined,
      originTxHash: row.origin_tx_hash ?? undefined,
      reason: row.reason ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at ?? undefined,
    }));
  }

  async upsertRunStepResult(step: RunStepResultRecord): Promise<void> {
    this.db
      .query(
        `INSERT INTO run_step_results (
           run_id, track_id, step_id, status, idempotency_key, reference, error, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(run_id, track_id, step_id) DO UPDATE SET
           status = excluded.status,
           idempotency_key = excluded.idempotency_key,
           reference = excluded.reference,
           error = excluded.error,
           updated_at = excluded.updated_at`
      )
      .run(
        step.runId,
        step.trackId,
        step.stepId,
        step.status,
        step.idempotencyKey,
        step.reference ?? null,
        step.error ?? null,
        step.updatedAt
      );
  }

  async getRunStepResults(runId: string): Promise<RunStepResultRecord[]> {
    const rows = this.db
      .query<RunStepRow, [string]>(
        `SELECT run_id, track_id, step_id, status, idempotency_key, reference, error, updated_at
         FROM run_step_results
         WHERE run_id = ?
         ORDER BY id ASC`
      )
      .all(runId);

    return rows.map((row) => ({
      runId: row.run_id,
      trackId: row.track_id,
      stepId: row.step_id,
      status: row.status as RunStepResultRecord["status"],
      idempotencyKey: row.idempotency_key,
      reference: row.reference ?? undefined,
      error: row.error ?? undefined,
      updatedAt: row.updated_at,
    }));
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
  cross_chain: string | null;
  final_state: string;
}

interface RunTrackRow {
  run_id: string;
  track_id: string;
  role: string;
  spell_id: string;
  chain_id: number;
  status: string;
  last_step_id: string | null;
  error: string | null;
  updated_at: string;
}

interface RunHandoffRow {
  run_id: string;
  handoff_id: string;
  source_track_id: string;
  destination_track_id: string;
  source_step_id: string;
  origin_chain_id: number;
  destination_chain_id: number;
  asset: string;
  submitted_amount: string;
  settled_amount: string | null;
  status: string;
  reference: string | null;
  origin_tx_hash: string | null;
  reason: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

interface RunStepRow {
  run_id: string;
  track_id: string;
  step_id: string;
  status: string;
  idempotency_key: string;
  reference: string | null;
  error: string | null;
  updated_at: string;
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
    crossChain: row.cross_chain ? JSON.parse(row.cross_chain) : undefined,
    finalState: JSON.parse(row.final_state),
  };
}

/** JSON replacer that converts bigint values to strings */
function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
