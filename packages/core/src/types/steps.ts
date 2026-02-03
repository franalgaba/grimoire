/**
 * Step types for the execution graph
 */

import type { Action, ActionConstraints } from "./actions.js";
import type { Expression } from "./expressions.js";

/** All step types */
export type Step =
  | ComputeStep
  | ActionStep
  | ConditionalStep
  | LoopStep
  | ParallelStep
  | PipelineStep
  | TryStep
  | AdvisoryStep
  | WaitStep
  | EmitStep
  | HaltStep;

/** Step kind discriminator */
export type StepKind = Step["kind"];

/** On failure behavior */
export type OnFailure = "revert" | "skip" | "halt" | "catch";

// =============================================================================
// COMPUTE STEP
// =============================================================================

/** Compute step - evaluate expressions and store in bindings */
export interface ComputeStep {
  kind: "compute";
  id: string;
  assignments: Array<{
    variable: string;
    expression: Expression;
  }>;
  dependsOn: string[];
}

// =============================================================================
// ACTION STEP
// =============================================================================

/** Action step - execute a DeFi action */
export interface ActionStep {
  kind: "action";
  id: string;
  skill?: string;
  action: Action;
  constraints: ActionConstraints;
  outputBinding?: string;
  dependsOn: string[];
  onFailure: OnFailure;
}

// =============================================================================
// CONDITIONAL STEP
// =============================================================================

/** Conditional step - if/then/else branching */
export interface ConditionalStep {
  kind: "conditional";
  id: string;
  condition: Expression;
  thenSteps: string[];
  elseSteps: string[];
  dependsOn: string[];
}

// =============================================================================
// LOOP STEP
// =============================================================================

/** Loop type variants */
export type LoopType =
  | { type: "repeat"; count: number }
  | { type: "for"; variable: string; source: Expression }
  | { type: "until"; condition: Expression };

/** Loop step - repeat execution */
export interface LoopStep {
  kind: "loop";
  id: string;
  loopType: LoopType;
  bodySteps: string[];
  maxIterations: number; // Always required for safety
  parallel?: boolean;
  outputBinding?: string;
  dependsOn: string[];
}

// =============================================================================
// PARALLEL STEP
// =============================================================================

/** Join strategy for parallel execution */
export type JoinStrategy =
  | { type: "all" }
  | { type: "first" }
  | { type: "best"; metric: Expression; order: "max" | "min" }
  | { type: "any"; count: number }
  | { type: "majority" };

/** Branch definition */
export interface Branch {
  id: string;
  name: string;
  steps: string[];
}

/** Parallel step - concurrent execution */
export interface ParallelStep {
  kind: "parallel";
  id: string;
  branches: Branch[];
  join: JoinStrategy;
  onFail: "abort" | "continue";
  timeout?: number;
  outputBinding?: string;
  dependsOn: string[];
}

// =============================================================================
// PIPELINE STEP
// =============================================================================

/** Pipeline stage operations */
export type PipelineStage =
  | { op: "where"; predicate: Expression }
  | { op: "map"; step: string }
  | { op: "filter"; step: string }
  | { op: "reduce"; step: string; initial: Expression }
  | { op: "take"; count: number }
  | { op: "skip"; count: number }
  | { op: "sort"; by: Expression; order: "asc" | "desc" };

/** Pipeline step - functional data processing */
export interface PipelineStep {
  kind: "pipeline";
  id: string;
  source: Expression;
  stages: PipelineStage[];
  parallel?: boolean;
  parallelConfig?: {
    maxConcurrency?: number;
    onFail: "abort" | "continue";
  };
  outputBinding?: string;
  dependsOn: string[];
}

// =============================================================================
// TRY STEP
// =============================================================================

/** Error types that can be caught */
export type ErrorType =
  | "slippage_exceeded"
  | "insufficient_liquidity"
  | "insufficient_balance"
  | "venue_unavailable"
  | "deadline_exceeded"
  | "simulation_failed"
  | "policy_violation"
  | "guard_failed"
  | "tx_reverted"
  | "gas_exceeded";

/** Catch block definition */
export interface CatchBlock {
  errorType: ErrorType | "*";
  steps?: string[];
  retry?: {
    maxAttempts: number;
    backoff: "none" | "linear" | "exponential";
    backoffBase?: number;
    maxBackoff?: number;
    modifyOnRetry?: {
      slippage?: { increase: number };
      venue?: string;
    };
  };
  action?: "skip" | "rollback" | "halt";
  alert?: {
    channels: string[];
    severity: "info" | "warn" | "critical";
  };
}

/** Try/catch step - error handling */
export interface TryStep {
  kind: "try";
  id: string;
  trySteps: string[];
  catchBlocks: CatchBlock[];
  finallySteps?: string[];
  dependsOn: string[];
}

// =============================================================================
// ADVISORY STEP
// =============================================================================

/** Output schema for advisory */
export type AdvisoryOutputSchema =
  | { type: "boolean" }
  | { type: "number"; min?: number; max?: number }
  | { type: "enum"; values?: string[] }
  | { type: "string"; minLength?: number; maxLength?: number; pattern?: string }
  | { type: "object"; fields?: Record<string, AdvisoryOutputSchema> }
  | { type: "array"; items?: AdvisoryOutputSchema };

/** Advisory step - AI consultation (read-only) */
export interface AdvisoryStep {
  kind: "advisory";
  id: string;
  advisor: string;
  prompt: string;
  context?: Record<string, Expression>;
  outputSchema: AdvisoryOutputSchema;
  outputBinding: string;
  timeout: number;
  fallback: Expression;
  dependsOn: string[];
}

// =============================================================================
// WAIT STEP
// =============================================================================

/** Wait step - pause execution */
export interface WaitStep {
  kind: "wait";
  id: string;
  duration: number; // seconds
  dependsOn: string[];
}

// =============================================================================
// EMIT STEP
// =============================================================================

/** Emit step - record event */
export interface EmitStep {
  kind: "emit";
  id: string;
  event: string;
  data: Record<string, Expression>;
  dependsOn: string[];
}

// =============================================================================
// HALT STEP
// =============================================================================

/** Halt step - stop execution */
export interface HaltStep {
  kind: "halt";
  id: string;
  reason: string;
  dependsOn: string[];
}
