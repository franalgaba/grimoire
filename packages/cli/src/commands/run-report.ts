import type { ExecutionResult, LedgerEntry } from "@grimoirelabs/core";
import type { RuntimeProvenanceManifest } from "./data-provenance.js";

interface RunReportEvent {
  name: string;
  data: Record<string, unknown>;
}

interface RunReportTrigger {
  type: string;
  id?: string;
  index?: number;
  label?: string;
}

export interface RunReportEnvelope {
  run: {
    spell: string;
    trigger: string;
    trigger_id?: string;
    trigger_index?: number;
    trigger_label?: string;
    status: "success" | "failed";
    run_id: string;
    duration_ms: number;
    error?: string;
  };
  data: {
    mode: "real_snapshot" | "none";
    snapshot_id: string;
    snapshot_at: string;
    snapshot_age_sec: number;
    snapshot_source: string;
    units: Record<string, string>;
    selection_policy: string;
    fallback_used: "none";
    rejected_count: number;
    source_count: number;
    stale_source_count: number;
    data_replay: "off" | "auto" | "explicit";
    data_replay_source: string;
    data_max_age_sec: number;
    on_stale: "fail" | "warn";
    provenance: RuntimeProvenanceManifest;
  };
  events: RunReportEvent[];
  bindings: Record<string, unknown>;
  metrics: {
    steps_executed: number;
    actions_executed: number;
    advisory_calls: number;
    retries: number;
    errors: number;
    gas_used: string;
  };
}

export function buildRunReportEnvelope(input: {
  spellName: string;
  result: ExecutionResult;
  provenance: RuntimeProvenanceManifest;
}): RunReportEnvelope {
  const trigger = extractTrigger(input.result);
  const events = extractEmittedEvents(input.result.ledgerEvents);
  const firstSource = input.provenance.sources[0];

  return {
    run: {
      spell: input.spellName,
      trigger: trigger.label ?? trigger.type,
      trigger_id: trigger.id,
      trigger_index: trigger.index,
      trigger_label: trigger.label,
      status: input.result.success ? "success" : "failed",
      run_id: input.result.runId,
      duration_ms: input.result.duration,
      error: input.result.error,
    },
    data: {
      mode: input.provenance.source_count > 0 ? "real_snapshot" : "none",
      snapshot_id: firstSource?.snapshot_id ?? "none",
      snapshot_at: firstSource?.snapshot_at ?? "none",
      snapshot_age_sec: firstSource?.snapshot_age_sec ?? 0,
      snapshot_source: firstSource?.snapshot_source ?? "none",
      units: input.provenance.unit_map,
      selection_policy: input.provenance.selection_policy,
      fallback_used: input.provenance.fallback_used,
      rejected_count: input.provenance.rejected_count,
      source_count: input.provenance.source_count,
      stale_source_count: input.provenance.stale_source_count,
      data_replay: input.provenance.data_replay,
      data_replay_source:
        input.provenance.data_replay_resolved_snapshot_id ??
        input.provenance.data_replay_resolved_run_id ??
        "none",
      data_max_age_sec: input.provenance.data_max_age_sec,
      on_stale: input.provenance.on_stale,
      provenance: input.provenance,
    },
    events,
    bindings: extractBindings(input.result.ledgerEvents, input.result.finalState),
    metrics: {
      steps_executed: input.result.metrics.stepsExecuted,
      actions_executed: input.result.metrics.actionsExecuted,
      advisory_calls: input.result.metrics.advisoryCalls,
      retries: input.result.metrics.retries,
      errors: input.result.metrics.errors,
      gas_used: input.result.metrics.gasUsed.toString(),
    },
  };
}

export function formatRunReportText(report: RunReportEnvelope): string {
  const lines: string[] = [];

  lines.push("Run:");
  lines.push(`  spell: ${report.run.spell}`);
  lines.push(`  trigger: ${report.run.trigger}`);
  if (report.run.trigger_id) {
    lines.push(`  trigger_id: ${report.run.trigger_id}`);
  }
  if (report.run.trigger_index !== undefined) {
    lines.push(`  trigger_index: ${report.run.trigger_index}`);
  }
  if (report.run.trigger_label) {
    lines.push(`  trigger_label: ${report.run.trigger_label}`);
  }
  lines.push(`  status: ${report.run.status}`);
  lines.push(`  run_id: ${report.run.run_id}`);
  lines.push(`  duration_ms: ${report.run.duration_ms}`);
  if (report.run.error) {
    lines.push(`  error: ${report.run.error}`);
  }

  lines.push("");
  lines.push("Data:");
  lines.push(`  mode: ${report.data.mode}`);
  lines.push(`  snapshot_id: ${report.data.snapshot_id}`);
  lines.push(`  snapshot_at: ${report.data.snapshot_at}`);
  lines.push(`  snapshot_age_sec: ${report.data.snapshot_age_sec}`);
  lines.push(`  snapshot_source: ${report.data.snapshot_source}`);
  lines.push(`  units: ${formatUnits(report.data.units)}`);
  lines.push(`  selection_policy: ${report.data.selection_policy}`);
  lines.push(`  fallback_used: ${report.data.fallback_used}`);
  lines.push(`  rejected_count: ${report.data.rejected_count}`);
  lines.push(`  source_count: ${report.data.source_count}`);
  lines.push(`  stale_source_count: ${report.data.stale_source_count}`);
  lines.push(`  data_replay: ${report.data.data_replay}`);
  lines.push(`  data_replay_source: ${report.data.data_replay_source}`);
  lines.push(`  data_max_age_sec: ${report.data.data_max_age_sec}`);
  lines.push(`  on_stale: ${report.data.on_stale}`);

  lines.push("");
  lines.push("Events:");
  if (report.events.length === 0) {
    lines.push("  - (none)");
  } else {
    for (const event of report.events) {
      lines.push(`  - ${event.name}(${formatEventData(event.data)})`);
    }
  }

  lines.push("");
  lines.push("Bindings:");
  const bindings = Object.entries(report.bindings);
  if (bindings.length === 0) {
    lines.push("  (none)");
  } else {
    for (const [key, value] of bindings) {
      lines.push(`  ${key}: ${stringifyValue(value)}`);
    }
  }

  return lines.join("\n");
}

function extractTrigger(result: ExecutionResult): RunReportTrigger {
  if (result.selectedTrigger) {
    return {
      type: result.selectedTrigger.label,
      id: result.selectedTrigger.id,
      index: result.selectedTrigger.index,
      label: result.selectedTrigger.label,
    };
  }

  for (const entry of result.ledgerEvents) {
    if (entry.event.type === "run_started") {
      return {
        type: entry.event.trigger.type,
        id: entry.event.trigger.id,
        index: entry.event.trigger.index,
        label:
          typeof entry.event.trigger.label === "string" ? entry.event.trigger.label : undefined,
      };
    }
  }
  return { type: "manual" };
}

export function extractEmittedEvents(entries: LedgerEntry[]): RunReportEvent[] {
  const out: RunReportEvent[] = [];
  for (const entry of entries) {
    if (entry.event.type === "event_emitted") {
      out.push({
        name: entry.event.event,
        data: entry.event.data,
      });
    }
  }
  return out;
}

function extractBindings(
  entries: LedgerEntry[],
  finalState: Record<string, unknown>
): Record<string, unknown> {
  const bindings: Record<string, unknown> = {};

  for (const entry of entries) {
    if (entry.event.type === "binding_set") {
      bindings[entry.event.name] = entry.event.value;
    }
  }

  if (Object.keys(bindings).length > 0) {
    return bindings;
  }

  return finalState;
}

function formatUnits(units: Record<string, string>): string {
  const pairs = Object.entries(units);
  if (pairs.length === 0) {
    return "none";
  }

  return pairs.map(([key, value]) => `${key}=${value}`).join(", ");
}

function formatEventData(data: Record<string, unknown>): string {
  const pairs = Object.entries(data);
  if (pairs.length === 0) {
    return "";
  }

  return pairs.map(([key, value]) => `${key}=${stringifyValue(value)}`).join(", ");
}

function stringifyValue(value: unknown): string {
  return JSON.stringify(value, (_key, innerValue) =>
    typeof innerValue === "bigint" ? innerValue.toString() : innerValue
  );
}
