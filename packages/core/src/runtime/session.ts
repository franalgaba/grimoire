/**
 * Session execution helpers.
 * Normalizes one-shot and managed invocations through the same runtime API.
 */

import type { ExecutionContext, ExecutionResult } from "../types/execution.js";
import type { SpellIR } from "../types/ir.js";
import type { Trigger } from "../types/primitives.js";
import { type ExecuteOptions, execute } from "./interpreter.js";

export type SessionMode = "one-shot" | "managed";

export interface SessionRunOptions extends Omit<ExecuteOptions, "trigger"> {
  /** Stable session identifier owned by the caller */
  sessionId: string;
  /** Invocation mode */
  mode?: SessionMode;
  /** Trigger that fired this run; defaults to spell trigger or manual */
  trigger?: ExecutionContext["trigger"];
  /** Optional managed firing timestamp (ms epoch) */
  firedAt?: number;
  /** Optional trigger origin descriptor */
  source?: string;
  /** Optional invocation metadata for auditing */
  metadata?: Record<string, unknown>;
}

export interface SessionRunResult {
  sessionId: string;
  mode: SessionMode;
  trigger: ExecutionContext["trigger"];
  result: ExecutionResult;
}

/**
 * Execute a spell run within a runtime session.
 * One-shot and managed invocations share the same execute() path.
 */
export async function runSession(options: SessionRunOptions): Promise<SessionRunResult> {
  const mode = options.mode ?? "one-shot";
  const trigger = withSessionMetadata(
    options.trigger ?? defaultTrigger(options.spell),
    options.sessionId,
    mode,
    options
  );

  const result = await execute({
    ...options,
    trigger,
  });

  return {
    sessionId: options.sessionId,
    mode,
    trigger,
    result,
  };
}

export async function runOneShotSession(
  options: Omit<SessionRunOptions, "mode">
): Promise<SessionRunResult> {
  return runSession({ ...options, mode: "one-shot" });
}

export async function runManagedSession(
  options: Omit<SessionRunOptions, "mode">
): Promise<SessionRunResult> {
  return runSession({ ...options, mode: "managed" });
}

function defaultTrigger(spell: SpellIR): ExecutionContext["trigger"] {
  return normalizeTrigger(spell.triggers[0]);
}

function withSessionMetadata(
  trigger: ExecutionContext["trigger"],
  sessionId: string,
  mode: SessionMode,
  options: Pick<SessionRunOptions, "firedAt" | "source" | "metadata">
): ExecutionContext["trigger"] {
  const firedAt = options.firedAt ?? Date.now();
  const source = options.source ?? (mode === "managed" ? "managed_trigger" : "direct_invocation");

  return {
    ...trigger,
    sessionId,
    mode,
    firedAt,
    source,
    ...(options.metadata ? { metadata: options.metadata } : {}),
  };
}

function normalizeTrigger(
  trigger: Trigger | ExecutionContext["trigger"] | undefined
): ExecutionContext["trigger"] {
  if (!trigger) {
    return { type: "manual" };
  }

  if (trigger.type === "any" && "triggers" in trigger && Array.isArray(trigger.triggers)) {
    return {
      type: "any",
      triggers: trigger.triggers.map((inner) => normalizeTrigger(inner)),
    };
  }

  return { ...trigger };
}
