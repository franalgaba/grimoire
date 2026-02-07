/**
 * Runtime exports
 */

export { execute, type ExecuteOptions } from "./interpreter.js";
export type { AdvisoryHandler, AdvisoryHandlerInput } from "./steps/advisory.js";
export {
  createContext,
  InMemoryLedger,
  setBinding,
  getBinding,
  setPersistentState,
  setEphemeralState,
  markStepExecuted,
  isStepExecuted,
  getPersistentStateObject,
  type CreateContextOptions,
} from "./context.js";
export {
  evaluate,
  evaluateAsync,
  createEvalContext,
  type EvalValue,
  type EvalContext,
} from "./expression-evaluator.js";
export { classifyError, matchesCatchBlock } from "./error-classifier.js";
export {
  CircuitBreakerManager,
  type BreakerState,
  type BreakerRecord,
  type TimestampedEvent,
  type CircuitBreakerCheckResult,
  type CircuitBreakerTriggerResult,
} from "./circuit-breaker.js";
export {
  type StateStore,
  type RunRecord,
  type RunMetrics,
  type RunProvenance,
  createRunRecord,
} from "./state-store.js";
export { SqliteStateStore, type SqliteStateStoreOptions } from "./sqlite-state-store.js";
