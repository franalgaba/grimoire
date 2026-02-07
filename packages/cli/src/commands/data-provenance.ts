import { createHash } from "node:crypto";
import type { RunRecord } from "@grimoirelabs/core";
import { loadRunRecords } from "./state-helpers.js";

export type OnStalePolicy = "fail" | "warn";

export type RuntimeFlow = "simulate" | "cast_dry_run" | "cast_execute";

type ReplayMode = "off" | "auto" | "explicit";

interface JsonRecord {
  [key: string]: unknown;
}

interface DataPolicyInput {
  defaultReplay: "off" | "auto";
  dataReplay?: string;
  dataMaxAge?: string;
  onStale?: string;
}

export interface RuntimeDataPolicy {
  replayMode: ReplayMode;
  replayKey?: string;
  dataMaxAgeSec: number;
  onStale: OnStalePolicy;
}

export interface ReplayResolution {
  params: Record<string, unknown>;
  replayUsed: boolean;
  replayMatchType?: "run_id" | "snapshot_id";
  replaySourceRunId?: string;
  replaySourceSnapshotId?: string;
}

export interface RuntimeDataSource {
  path: string;
  snapshot_id?: string;
  snapshot_at: string;
  snapshot_age_sec: number;
  snapshot_source?: string;
  venue?: string;
  dataset?: string;
  chain_id?: number;
  asset?: string;
  filters?: Record<string, unknown>;
  units?: Record<string, string>;
  source_hash?: string;
  status?: string;
  record_count?: number;
  warnings: string[];
  stale: boolean;
}

export interface RuntimeProvenanceManifest {
  schema_version: "grimoire.runtime.provenance.v1";
  generated_at: string;
  runtime_mode: RuntimeFlow;
  chain_id: number;
  block_number?: string;
  rpc_url?: string;
  data_replay: ReplayMode;
  data_replay_key?: string;
  data_replay_resolved_run_id?: string;
  data_replay_resolved_snapshot_id?: string;
  data_max_age_sec: number;
  on_stale: OnStalePolicy;
  input_params_hash: string;
  snapshot_hash?: string;
  unit_map: Record<string, string>;
  source_count: number;
  stale_source_count: number;
  selection_policy: string;
  fallback_used: "none";
  rejected_count: number;
  sources: RuntimeDataSource[];
  resolved_params: Record<string, unknown>;
}

export function resolveDataPolicy(input: DataPolicyInput): RuntimeDataPolicy {
  const replayValue = (input.dataReplay ?? input.defaultReplay).trim();

  let replayMode: ReplayMode = "explicit";
  let replayKey: string | undefined;
  if (replayValue === "off") {
    replayMode = "off";
  } else if (replayValue === "auto") {
    replayMode = "auto";
  } else {
    replayMode = "explicit";
    replayKey = replayValue;
  }

  const parsedMaxAge = input.dataMaxAge ? Number.parseInt(input.dataMaxAge, 10) : 3600;
  if (!Number.isFinite(parsedMaxAge) || parsedMaxAge <= 0) {
    throw new Error("--data-max-age must be a positive integer (seconds)");
  }

  const staleValue = (input.onStale ?? "fail").trim();
  if (staleValue !== "fail" && staleValue !== "warn") {
    throw new Error("--on-stale must be either 'fail' or 'warn'");
  }

  return {
    replayMode,
    replayKey,
    dataMaxAgeSec: parsedMaxAge,
    onStale: staleValue,
  };
}

export async function resolveReplayParams(options: {
  spellId: string;
  params: Record<string, unknown>;
  stateDir?: string;
  noState?: boolean;
  policy: RuntimeDataPolicy;
}): Promise<ReplayResolution> {
  if (options.policy.replayMode !== "explicit") {
    return {
      params: options.params,
      replayUsed: false,
    };
  }

  if (!options.policy.replayKey) {
    throw new Error("--data-replay requires a run ID or snapshot ID");
  }

  if (options.noState) {
    throw new Error("--data-replay requires state persistence (omit --no-state)");
  }

  const runs = await loadRunRecords(options.spellId, { stateDir: options.stateDir });
  const match = findReplayRun(runs, options.policy.replayKey);
  if (!match) {
    throw new Error(
      `No replay source found for '${options.policy.replayKey}' in spell ${options.spellId}`
    );
  }

  const replayParams = extractResolvedParams(match.run);
  if (!replayParams) {
    throw new Error(
      `Run ${match.run.runId} does not include replayable data (missing provenance.resolved_params)`
    );
  }

  return {
    params: deepMergeRecords(replayParams, options.params),
    replayUsed: true,
    replayMatchType: match.matchType,
    replaySourceRunId: match.run.runId,
    replaySourceSnapshotId: match.snapshotId,
  };
}

export function buildRuntimeProvenanceManifest(input: {
  runtimeMode: RuntimeFlow;
  chainId: number;
  policy: RuntimeDataPolicy;
  replay: ReplayResolution;
  params: Record<string, unknown>;
  blockNumber?: bigint;
  rpcUrl?: string;
  now?: Date;
}): RuntimeProvenanceManifest {
  const now = input.now ?? new Date();
  const sources = collectSnapshotSources(input.params, input.policy.dataMaxAgeSec, now.getTime());
  const unitMap = mergeUnitMap(sources);
  const snapshotHash =
    sources.length > 0
      ? `sha256:${sha256(stableStringify(sources.map(stripPathForSnapshotHash)))}`
      : undefined;

  return {
    schema_version: "grimoire.runtime.provenance.v1",
    generated_at: now.toISOString(),
    runtime_mode: input.runtimeMode,
    chain_id: input.chainId,
    block_number: input.blockNumber?.toString(),
    rpc_url: input.rpcUrl,
    data_replay: input.policy.replayMode,
    data_replay_key: input.policy.replayKey,
    data_replay_resolved_run_id: input.replay.replaySourceRunId,
    data_replay_resolved_snapshot_id: input.replay.replaySourceSnapshotId,
    data_max_age_sec: input.policy.dataMaxAgeSec,
    on_stale: input.policy.onStale,
    input_params_hash: `sha256:${sha256(stableStringify(input.params))}`,
    snapshot_hash: snapshotHash,
    unit_map: unitMap,
    source_count: sources.length,
    stale_source_count: sources.filter((source) => source.stale).length,
    selection_policy: resolveSelectionPolicy(input.params),
    fallback_used: "none",
    rejected_count: 0,
    sources,
    resolved_params: cloneRecord(input.params),
  };
}

export function enforceFreshnessPolicy(manifest: RuntimeProvenanceManifest): string[] {
  if (manifest.stale_source_count === 0) {
    return [];
  }

  const staleSummaries = manifest.sources
    .filter((source) => source.stale)
    .map((source) => `${source.path} (${source.snapshot_age_sec}s)`)
    .join(", ");

  const message =
    `Found ${manifest.stale_source_count} stale data source(s): ${staleSummaries}. ` +
    `max_age=${manifest.data_max_age_sec}s`;

  if (manifest.on_stale === "fail") {
    throw new Error(`${message}. Use --on-stale warn to continue.`);
  }

  return [message];
}

function findReplayRun(
  runs: RunRecord[],
  replayKey: string
): { run: RunRecord; matchType: "run_id" | "snapshot_id"; snapshotId?: string } | undefined {
  for (const run of runs) {
    if (run.runId === replayKey) {
      return { run, matchType: "run_id" };
    }
  }

  for (const run of runs) {
    const snapshotIds = getSnapshotIdsFromRun(run);
    const found = snapshotIds.find((id) => id === replayKey);
    if (found) {
      return { run, matchType: "snapshot_id", snapshotId: found };
    }
  }

  return undefined;
}

function getSnapshotIdsFromRun(run: RunRecord): string[] {
  if (!isRecord(run.provenance)) return [];
  const sourcesValue = run.provenance.sources;
  if (!Array.isArray(sourcesValue)) return [];

  const ids: string[] = [];
  for (const source of sourcesValue) {
    if (!isRecord(source)) continue;
    const snapshotId = source.snapshot_id;
    if (typeof snapshotId === "string" && snapshotId.length > 0) {
      ids.push(snapshotId);
    }
  }
  return ids;
}

function extractResolvedParams(run: RunRecord): Record<string, unknown> | undefined {
  if (!isRecord(run.provenance)) return undefined;
  const value = run.provenance.resolved_params;
  if (!isRecord(value)) return undefined;
  return cloneRecord(value);
}

function collectSnapshotSources(
  value: unknown,
  dataMaxAgeSec: number,
  nowMs: number,
  path = "params"
): RuntimeDataSource[] {
  const out: RuntimeDataSource[] = [];
  walkForSnapshots(value, path, dataMaxAgeSec, nowMs, out);
  return out;
}

function walkForSnapshots(
  value: unknown,
  path: string,
  dataMaxAgeSec: number,
  nowMs: number,
  out: RuntimeDataSource[]
): void {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      walkForSnapshots(value[i], `${path}[${i}]`, dataMaxAgeSec, nowMs, out);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  const snapshotAt = value.snapshot_at;
  if (typeof snapshotAt === "string") {
    const parsed = Date.parse(snapshotAt);
    const validTimestamp = Number.isFinite(parsed);
    const ageSec = validTimestamp
      ? Math.max(0, Math.floor((nowMs - parsed) / 1000))
      : Number.MAX_SAFE_INTEGER;

    out.push({
      path,
      snapshot_id: readString(value, "snapshot_id"),
      snapshot_at: snapshotAt,
      snapshot_age_sec: ageSec,
      snapshot_source: readString(value, "snapshot_source"),
      venue: readString(value, "venue"),
      dataset: readString(value, "dataset"),
      chain_id: readNumber(value, ["chain_id", "chainId", "chain"]),
      asset: readString(value, "asset"),
      filters: readRecord(value, "filters"),
      units: readStringRecord(value, "units"),
      source_hash: readString(value, "source_hash"),
      status: readString(value, "status"),
      record_count: readNumber(value, ["record_count"]),
      warnings: readStringArray(value, "warnings"),
      stale: ageSec > dataMaxAgeSec,
    });
  }

  for (const [key, child] of Object.entries(value)) {
    walkForSnapshots(child, `${path}.${key}`, dataMaxAgeSec, nowMs, out);
  }
}

function mergeUnitMap(sources: RuntimeDataSource[]): Record<string, string> {
  const map = new Map<string, string>();
  for (const source of sources) {
    if (!source.units) continue;
    for (const [key, value] of Object.entries(source.units)) {
      if (!map.has(key)) {
        map.set(key, value);
      }
    }
  }

  const out: Record<string, string> = {};
  for (const [key, value] of map.entries()) {
    out[key] = value;
  }
  return out;
}

function resolveSelectionPolicy(params: Record<string, unknown>): string {
  const direct = params.selection_policy;
  if (typeof direct === "string" && direct.length > 0) {
    return direct;
  }

  const formula = params.selection_formula;
  if (typeof formula === "string" && formula.length > 0) {
    return formula;
  }

  return "not_specified";
}

function stripPathForSnapshotHash(
  source: RuntimeDataSource
): Omit<RuntimeDataSource, "path" | "snapshot_age_sec" | "stale"> {
  const { path: _path, snapshot_age_sec: _snapshotAgeSec, stale: _stale, ...rest } = source;
  return rest;
}

function deepMergeRecords(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = cloneRecord(base);

  for (const [key, value] of Object.entries(override)) {
    const existing = result[key];
    if (isRecord(existing) && isRecord(value)) {
      result[key] = deepMergeRecords(existing, value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeForStableJson(value));
}

function normalizeForStableJson(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeForStableJson(item));
  }

  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      out[key] = normalizeForStableJson(value[key]);
    }
    return out;
  }

  return String(value);
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(obj: JsonRecord, key: string): string | undefined {
  const value = obj[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(obj: JsonRecord, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function readRecord(obj: JsonRecord, key: string): Record<string, unknown> | undefined {
  const value = obj[key];
  return isRecord(value) ? cloneRecord(value) : undefined;
}

function readStringRecord(obj: JsonRecord, key: string): Record<string, string> | undefined {
  const value = obj[key];
  if (!isRecord(value)) return undefined;

  const out: Record<string, string> = {};
  let hasAny = false;

  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (typeof entryValue === "string") {
      out[entryKey] = entryValue;
      hasAny = true;
    }
  }

  return hasAny ? out : undefined;
}

function readStringArray(obj: JsonRecord, key: string): string[] {
  const value = obj[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(normalizeForStableJson(value))) as Record<string, unknown>;
}
