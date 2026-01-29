/**
 * Execution Context
 * Manages state during spell execution
 */

import type { CallFrame, ExecutionContext, LedgerEntry, LedgerEvent } from "../types/execution.js";
import type { SpellIR } from "../types/ir.js";
import type { PolicySet } from "../types/policy.js";
import type { Address, ChainId } from "../types/primitives.js";

/**
 * Options for creating an execution context
 */
export interface CreateContextOptions {
  spell: SpellIR;
  policy?: PolicySet;
  vault: Address;
  chain: ChainId;
  params?: Record<string, unknown>;
  persistentState?: Record<string, unknown>;
}

/**
 * Create a new execution context
 */
export function createContext(options: CreateContextOptions): ExecutionContext {
  const { spell, policy, vault, chain, params = {}, persistentState = {} } = options;

  // Generate run ID
  const now = new Date();
  const timestamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "");
  const random = Math.random().toString(36).slice(2, 8);
  const runId = `${timestamp}-${random}`;

  // Initialize state from schema
  const persistent = new Map<string, unknown>();
  const ephemeral = new Map<string, unknown>();

  // Load persistent state schema defaults
  for (const [key, field] of Object.entries(spell.state.persistent)) {
    persistent.set(key, persistentState[key] ?? field.initialValue);
  }

  // Initialize ephemeral state from schema
  for (const [key, field] of Object.entries(spell.state.ephemeral)) {
    ephemeral.set(key, field.initialValue);
  }

  // Initialize bindings with params
  const bindings = new Map<string, unknown>();
  for (const param of spell.params) {
    const value = params[param.name] ?? param.default;
    bindings.set(param.name, value);
  }

  return {
    spell,
    policy,
    runId,
    startTime: now.getTime(),
    trigger: { type: "manual" },
    vault,
    chain,
    state: { persistent, ephemeral },
    bindings,
    callStack: [],
    executedSteps: [],
    metrics: {
      stepsExecuted: 0,
      actionsExecuted: 0,
      gasUsed: 0n,
      advisoryCalls: 0,
      errors: 0,
      retries: 0,
    },
  };
}

/**
 * Push a call frame onto the stack
 */
export function pushFrame(
  ctx: ExecutionContext,
  stepId: string,
  iteration?: number,
  branch?: string
): void {
  ctx.callStack.push({
    stepId,
    startTime: Date.now(),
    iteration,
    branch,
  });
}

/**
 * Pop a call frame from the stack
 */
export function popFrame(ctx: ExecutionContext): CallFrame | undefined {
  return ctx.callStack.pop();
}

/**
 * Set a binding value
 */
export function setBinding(ctx: ExecutionContext, name: string, value: unknown): void {
  ctx.bindings.set(name, value);
}

/**
 * Get a binding value
 */
export function getBinding(ctx: ExecutionContext, name: string): unknown {
  return ctx.bindings.get(name);
}

/**
 * Update persistent state
 */
export function setPersistentState(ctx: ExecutionContext, key: string, value: unknown): void {
  ctx.state.persistent.set(key, value);
}

/**
 * Update ephemeral state
 */
export function setEphemeralState(ctx: ExecutionContext, key: string, value: unknown): void {
  ctx.state.ephemeral.set(key, value);
}

/**
 * Mark a step as executed
 */
export function markStepExecuted(ctx: ExecutionContext, stepId: string): void {
  ctx.executedSteps.push(stepId);
  ctx.metrics.stepsExecuted++;
}

/**
 * Increment action counter
 */
export function incrementActions(ctx: ExecutionContext): void {
  ctx.metrics.actionsExecuted++;
}

/**
 * Add gas used
 */
export function addGasUsed(ctx: ExecutionContext, gas: bigint): void {
  ctx.metrics.gasUsed += gas;
}

/**
 * Increment error counter
 */
export function incrementErrors(ctx: ExecutionContext): void {
  ctx.metrics.errors++;
}

/**
 * Increment retry counter
 */
export function incrementRetries(ctx: ExecutionContext): void {
  ctx.metrics.retries++;
}

/**
 * Increment advisory call counter
 */
export function incrementAdvisoryCalls(ctx: ExecutionContext): void {
  ctx.metrics.advisoryCalls++;
}

/**
 * Check if a step has been executed
 */
export function isStepExecuted(ctx: ExecutionContext, stepId: string): boolean {
  return ctx.executedSteps.includes(stepId);
}

/**
 * Get persistent state as a plain object
 */
export function getPersistentStateObject(ctx: ExecutionContext): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [key, value] of ctx.state.persistent) {
    obj[key] = value;
  }
  return obj;
}

/**
 * Simple in-memory ledger for Mode 1
 */
export class InMemoryLedger {
  private entries: LedgerEntry[] = [];
  private runId: string;
  private spellId: string;

  constructor(runId: string, spellId: string) {
    this.runId = runId;
    this.spellId = spellId;
  }

  emit(event: LedgerEvent): void {
    this.entries.push({
      id: `evt_${this.entries.length.toString().padStart(3, "0")}`,
      timestamp: Date.now(),
      runId: this.runId,
      spellId: this.spellId,
      event,
    });
  }

  getEntries(): LedgerEntry[] {
    return [...this.entries];
  }

  toJSON(): object {
    return {
      runId: this.runId,
      spellId: this.spellId,
      events: this.entries.map((e) => ({
        id: e.id,
        timestamp: new Date(e.timestamp).toISOString(),
        event: e.event,
      })),
    };
  }
}
