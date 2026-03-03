/**
 * Execution context and result types
 */

import type { Action, ActionConstraintsResolved } from "./actions.js";
import type { CrossChainReceipt } from "./cross-chain.js";
import type { SpellIR } from "./ir.js";
import type { PolicySet } from "./policy.js";
import type { Address, ChainId, Timestamp, VenueAlias } from "./primitives.js";
import type { QueryProvider } from "./query-provider.js";
import type { CommitResult, Receipt, StructuredError, ValueDelta } from "./receipt.js";

/**
 * Execution context - passed through during spell execution
 */
export interface ExecutionContext {
  // Strategy
  spell: SpellIR;
  policy?: PolicySet;
  advisorTooling?: Record<
    string,
    {
      skills: string[];
      allowedTools: string[];
      mcp?: string[];
    }
  >;

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

  // Query provider for blockchain data (balance, price, etc.)
  queryProvider?: QueryProvider;
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
  structuredError?: StructuredError;
  metrics: ExecutionMetrics;
  finalState: Record<string, unknown>;
  ledgerEvents: LedgerEntry[];
  /** Preview receipt generated during execution */
  receipt?: Receipt;
  /** Commit result when irreversible actions are committed */
  commit?: CommitResult;
  /** Cross-chain orchestration receipt (Phase 1) */
  crossChain?: CrossChainReceipt;
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
  rawOutput?: unknown;
  effectiveOutput?: unknown;
  violationPolicy?: "reject" | "clamp";
  clamped?: boolean;
  advisoryViolations?: AdvisoryViolationEventDetail[];
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
  // Cross-chain orchestration
  | TrackWaitingEvent
  | TrackResumedEvent
  | TrackCompletedEvent
  | HandoffSubmittedEvent
  | HandoffSettledEvent
  | HandoffExpiredEvent
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
  | AdvisoryModelUsedEvent
  | AdvisoryToolExecutionStartEvent
  | AdvisoryToolExecutionUpdateEvent
  | AdvisoryToolExecutionEndEvent
  // Custom events
  | EventEmittedEvent
  | ConstraintEvaluatedEvent
  // Errors
  | ErrorCaughtEvent
  | RetryAttemptedEvent
  | RetrySucceededEvent
  | RetryExhaustedEvent
  // Circuit breakers
  | CircuitBreakerTriggeredEvent
  | CircuitBreakerActionEvent
  // Preview/Commit lifecycle
  | PreviewStartedEvent
  | PreviewCompletedEvent
  | CommitStartedEvent
  | CommitCompletedEvent
  | DriftCheckEvent
  | ValueDeltaEvent
  | ReceiptGeneratedEvent
  | ApprovalRequiredEvent;

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
  line?: number;
  column?: number;
}

interface StepSkippedEvent {
  type: "step_skipped";
  stepId: string;
  reason: string;
}

// Cross-chain orchestration events
interface TrackWaitingEvent {
  type: "track_waiting";
  runId: string;
  trackId: string;
  reason: string;
  chainId: number;
}

interface TrackResumedEvent {
  type: "track_resumed";
  runId: string;
  trackId: string;
  chainId: number;
}

interface TrackCompletedEvent {
  type: "track_completed";
  runId: string;
  trackId: string;
  chainId: number;
  success: boolean;
}

interface HandoffSubmittedEvent {
  type: "handoff_submitted";
  runId: string;
  handoffId: string;
  trackId: string;
  stepId: string;
  originChainId: number;
  destinationChainId: number;
  asset: string;
  submittedAmount: string;
  reference?: string;
  txHash?: string;
}

interface HandoffSettledEvent {
  type: "handoff_settled";
  runId: string;
  handoffId: string;
  trackId: string;
  originChainId: number;
  destinationChainId: number;
  settledAmount: string;
  reference?: string;
}

interface HandoffExpiredEvent {
  type: "handoff_expired";
  runId: string;
  handoffId: string;
  trackId: string;
  originChainId: number;
  destinationChainId: number;
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
interface AdvisoryViolationEventDetail {
  path: string;
  message: string;
  actual?: unknown;
  expected?: unknown;
}

interface AdvisoryStartedEvent {
  type: "advisory_started";
  stepId: string;
  advisor: string;
  prompt: string;
  skills?: string[];
  allowedTools?: string[];
  mcp?: string[];
  schema?: AdvisorySchemaEvent;
}

interface AdvisoryCompletedEvent {
  type: "advisory_completed";
  stepId: string;
  advisor: string;
  output: unknown;
  rawOutput?: unknown;
  effectiveOutput?: unknown;
  onViolation?: "reject" | "clamp";
  policyScope?: string;
  clampConstraints?: string[];
  clamped?: boolean;
  violations?: AdvisoryViolationEventDetail[];
}

interface AdvisoryFailedEvent {
  type: "advisory_failed";
  stepId: string;
  advisor: string;
  error: string;
  fallback: unknown;
}

interface AdvisoryRateLimitedEvent {
  type: "advisory_rate_limited";
  stepId: string;
  advisor: string;
}

interface AdvisoryModelUsedEvent {
  type: "advisory_model_used";
  stepId: string;
  provider: string;
  modelId: string;
  thinkingLevel?: string;
}

interface AdvisoryToolExecutionStartEvent {
  type: "advisory_tool_execution_start";
  stepId: string;
  toolCallId: string;
  toolName: string;
  args: unknown;
}

interface AdvisoryToolExecutionUpdateEvent {
  type: "advisory_tool_execution_update";
  stepId: string;
  toolCallId: string;
  toolName: string;
  partial: unknown;
}

interface AdvisoryToolExecutionEndEvent {
  type: "advisory_tool_execution_end";
  stepId: string;
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError?: boolean;
}

interface EventEmittedEvent {
  type: "event_emitted";
  stepId: string;
  event: string;
  data: Record<string, unknown>;
}

interface ConstraintEvaluatedEvent {
  type: "constraint_evaluated";
  stepId: string;
  constraints: ActionConstraintsResolved;
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

// Preview/Commit lifecycle events
interface PreviewStartedEvent {
  type: "preview_started";
  runId: string;
  spellId: string;
}

interface PreviewCompletedEvent {
  type: "preview_completed";
  runId: string;
  receiptId: string;
  status: string;
}

interface CommitStartedEvent {
  type: "commit_started";
  runId: string;
  receiptId: string;
}

interface CommitCompletedEvent {
  type: "commit_completed";
  runId: string;
  receiptId: string;
  success: boolean;
}

interface DriftCheckEvent {
  type: "drift_check";
  field: string;
  passed: boolean;
  previewValue: unknown;
  commitValue: unknown;
}

interface ValueDeltaEvent {
  type: "value_delta";
  delta: ValueDelta;
}

interface ReceiptGeneratedEvent {
  type: "receipt_generated";
  receiptId: string;
}

interface ApprovalRequiredEvent {
  type: "approval_required";
  receiptId: string;
  reason: string;
}

export interface AdvisorySchemaEvent {
  type: "boolean" | "number" | "enum" | "string" | "object" | "array";
  values?: string[];
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  fields?: Record<string, AdvisorySchemaEvent>;
  items?: AdvisorySchemaEvent;
}
