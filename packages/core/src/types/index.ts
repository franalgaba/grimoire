/**
 * Type exports for @grimoire/core
 */

// Primitives
export type {
  ChainId,
  Address,
  AssetId,
  Timestamp,
  BasisPoints,
  HexString,
  Amount,
  VenueAlias,
  AssetDef,
  ParamDef,
  StateField,
  Trigger,
  WalletMode,
} from "./primitives.js";

export { CHAINS } from "./primitives.js";

// Expressions
export type {
  Expression,
  BinaryOp,
  UnaryOp,
  BuiltinFn,
  LiteralExpr,
  ParamExpr,
  StateExpr,
  BindingExpr,
  ItemExpr,
  IndexExpr,
  BinaryExpr,
  UnaryExpr,
  TernaryExpr,
  CallExpr,
  ArrayAccessExpr,
  PropertyAccessExpr,
} from "./expressions.js";

export { literal, param, binding, binary, call } from "./expressions.js";

// Actions
export type {
  Action,
  ActionType,
  SwapAction,
  LendAction,
  WithdrawAction,
  BorrowAction,
  RepayAction,
  StakeAction,
  UnstakeAction,
  BridgeAction,
  ClaimAction,
  TransferAction,
  ActionConstraints,
  CalldataBundle,
  SimulationResult,
  ActionResult,
} from "./actions.js";

// Steps
export type {
  Step,
  StepKind,
  OnFailure,
  ComputeStep,
  ActionStep,
  ConditionalStep,
  LoopStep,
  LoopType,
  ParallelStep,
  JoinStrategy,
  Branch,
  PipelineStep,
  PipelineStage,
  TryStep,
  CatchBlock,
  ErrorType,
  AdvisoryStep,
  AdvisoryOutputSchema,
  WaitStep,
  EmitStep,
  HaltStep,
} from "./steps.js";

// IR
export type {
  SpellIR,
  SpellSource,
  AdvisorDef,
  SkillDef,
  Guard,
  AdvisoryGuard,
  GuardDef,
  StateSchema,
  CompilationResult,
  CompilationError,
  CompilationWarning,
} from "./ir.js";

// Policy
export type {
  PolicySet,
  ExposureLimit,
  CircuitBreaker,
  CircuitBreakerTrigger,
  PolicyCheckResult,
  ExposureResult,
} from "./policy.js";

// Execution
export type {
  ExecutionContext,
  CallFrame,
  ExecutionMetrics,
  ExecutionResult,
  StepResult,
  LedgerEvent,
  LedgerEntry,
} from "./execution.js";
