/**
 * Execution context and result types
 */

import type { Action } from "./actions.js";
import type { SpellIR } from "./ir.js";
import type { PolicySet } from "./policy.js";
import type { Address, ChainId, Timestamp, VenueAlias } from "./primitives.js";

/**
 * Execution context - passed through during spell execution
 */
export interface ExecutionContext {
  // Strategy
  spell: SpellIR;
  policy?: PolicySet;

  // Run identity
  runId: string;
  startTime: Timestamp;
  trigger: { type: string; [key: string]: unknown };

  // Blockchain
  vault: Address;
  chain: ChainId;

  // State
  state: {
    persistent: Map<string, unknown>;
    ephemeral: Map<string, unknown>;
  };
  bindings: Map<string, unknown>;

  // Execution tracking
  callStack: CallFrame[];
  executedSteps: string[];

  // Metrics
  metrics: ExecutionMetrics;
}

/** Call frame for tracking nested execution */
export interface CallFrame {
  stepId: string;
  startTime: Timestamp;
  iteration?: number;
  branch?: string;
}

/** Execution metrics */
export interface ExecutionMetrics {
  stepsExecuted: number;
  actionsExecuted: number;
  gasUsed: bigint;
  advisoryCalls: number;
  errors: number;
  retries: number;
}

/**
 * Result of executing a spell
 */
export interface ExecutionResult {
  success: boolean;
  runId: string;
  startTime: Timestamp;
  endTime: Timestamp;
  duration: number; // milliseconds
  error?: string;
  metrics: ExecutionMetrics;
  finalState: Record<string, unknown>;
  ledgerEvents: LedgerEntry[];
}

/**
 * Result of executing a single step
 */
export interface StepResult {
  success: boolean;
  stepId: string;
  output?: unknown;
  error?: string;
  halted?: boolean;
  skipped?: boolean;
  fallback?: boolean;
}

// =============================================================================
// LEDGER TYPES
// =============================================================================

/** All ledger event types */
export type LedgerEvent =
  // Run lifecycle
  | RunStartedEvent
  | RunCompletedEvent
  | RunFailedEvent
  // Step execution
  | StepStartedEvent
  | StepCompletedEvent
  | StepFailedEvent
  | StepSkippedEvent
  // Actions
  | ActionSimulatedEvent
  | ActionSubmittedEvent
  | ActionConfirmedEvent
  | ActionRevertedEvent
  // Policy
  | PolicyCheckPassedEvent
  | PolicyCheckFailedEvent
  // Guards
  | GuardPassedEvent
  | GuardFailedEvent
  // State
  | StateReadEvent
  | StateWriteEvent
  | BindingSetEvent
  // Advisory
  | AdvisoryStartedEvent
  | AdvisoryCompletedEvent
  | AdvisoryFailedEvent
  | AdvisoryRateLimitedEvent
  // Errors
  | ErrorCaughtEvent
  | RetryAttemptedEvent
  | RetrySucceededEvent
  | RetryExhaustedEvent
  // Circuit breakers
  | CircuitBreakerTriggeredEvent
  | CircuitBreakerActionEvent;

// Run lifecycle events
interface RunStartedEvent {
  type: "run_started";
  runId: string;
  spellId: string;
  trigger: { type: string };
}

interface RunCompletedEvent {
  type: "run_completed";
  runId: string;
  success: boolean;
  metrics: ExecutionMetrics;
}

interface RunFailedEvent {
  type: "run_failed";
  runId: string;
  error: string;
}

// Step events
interface StepStartedEvent {
  type: "step_started";
  stepId: string;
  kind: string;
}

interface StepCompletedEvent {
  type: "step_completed";
  stepId: string;
  result: unknown;
}

interface StepFailedEvent {
  type: "step_failed";
  stepId: string;
  error: string;
}

interface StepSkippedEvent {
  type: "step_skipped";
  stepId: string;
  reason: string;
}

// Action events
interface ActionSimulatedEvent {
  type: "action_simulated";
  action: Action;
  venue: VenueAlias;
  result: {
    success: boolean;
    input: { asset: string; amount: string };
    output: { asset: string; amount: string };
    gasEstimate: string;
  };
}

interface ActionSubmittedEvent {
  type: "action_submitted";
  action: Action;
  txHash: string;
}

interface ActionConfirmedEvent {
  type: "action_confirmed";
  txHash: string;
  gasUsed: string;
}

interface ActionRevertedEvent {
  type: "action_reverted";
  txHash: string;
  reason: string;
}

// Policy events
interface PolicyCheckPassedEvent {
  type: "policy_check_passed";
  action: Action;
}

interface PolicyCheckFailedEvent {
  type: "policy_check_failed";
  action: Action;
  violations: string[];
}

// Guard events
interface GuardPassedEvent {
  type: "guard_passed";
  guardId: string;
}

interface GuardFailedEvent {
  type: "guard_failed";
  guardId: string;
  severity: string;
  message: string;
}

// State events
interface StateReadEvent {
  type: "state_read";
  scope: string;
  key: string;
  value: unknown;
}

interface StateWriteEvent {
  type: "state_write";
  scope: string;
  key: string;
  oldValue: unknown;
  newValue: unknown;
}

interface BindingSetEvent {
  type: "binding_set";
  name: string;
  value: unknown;
}

// Advisory events
interface AdvisoryStartedEvent {
  type: "advisory_started";
  advisor: string;
  prompt: string;
}

interface AdvisoryCompletedEvent {
  type: "advisory_completed";
  advisor: string;
  output: unknown;
}

interface AdvisoryFailedEvent {
  type: "advisory_failed";
  advisor: string;
  error: string;
  fallback: unknown;
}

interface AdvisoryRateLimitedEvent {
  type: "advisory_rate_limited";
  advisor: string;
}

// Error events
interface ErrorCaughtEvent {
  type: "error_caught";
  stepId: string;
  errorType: string;
  handler: string;
}

interface RetryAttemptedEvent {
  type: "retry_attempted";
  stepId: string;
  attempt: number;
}

interface RetrySucceededEvent {
  type: "retry_succeeded";
  stepId: string;
  attempt: number;
}

interface RetryExhaustedEvent {
  type: "retry_exhausted";
  stepId: string;
  attempts: number;
}

// Circuit breaker events
interface CircuitBreakerTriggeredEvent {
  type: "circuit_breaker_triggered";
  breakerId: string;
  trigger: unknown;
}

interface CircuitBreakerActionEvent {
  type: "circuit_breaker_action";
  breakerId: string;
  action: string;
}

/** Ledger entry with metadata */
export interface LedgerEntry {
  id: string;
  timestamp: Timestamp;
  runId: string;
  spellId: string;
  event: LedgerEvent;
}
