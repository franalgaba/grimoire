/**
 * @grimoire/core
 * Core compiler and runtime for Grimoire spell execution
 */

// Types
export * from "./types/index.js";

// Compiler
export { compile, compileFile, parseSpell, parseExpression, validateIR } from "./compiler/index.js";
export type { ParseResult, IRGeneratorResult, ValidationResult } from "./compiler/index.js";

// Runtime
export {
  execute,
  createContext,
  InMemoryLedger,
  evaluate,
  evaluateAsync,
  createRunRecord,
  SqliteStateStore,
  CircuitBreakerManager,
} from "./runtime/index.js";
export type {
  ExecuteOptions,
  CreateContextOptions,
  EvalContext,
  EvalValue,
  StateStore,
  RunRecord,
  RunMetrics,
  SqliteStateStoreOptions,
  BreakerState,
  BreakerRecord,
  TimestampedEvent,
  CircuitBreakerCheckResult,
  CircuitBreakerTriggerResult,
} from "./runtime/index.js";

// Wallet
export {
  createWallet,
  createWalletFromMnemonic,
  createWalletFromConfig,
  getAddressFromConfig,
  generatePrivateKey,
  createKeystore,
  loadPrivateKey,
  KeyLoadError,
  Provider,
  createProvider,
  formatWei,
  formatGasCostUsd,
  TransactionBuilder,
  createTransactionBuilder,
  Executor,
  createExecutor,
  CHAIN_CONFIGS,
  isTestnet,
  getChainName,
  getNativeCurrencySymbol,
  isNativeCurrency,
} from "./wallet/index.js";
export type {
  KeySourceType,
  KeyConfig,
  Wallet,
  TransactionRequest,
  TransactionReceipt,
  TransactionLog,
  ProviderConfig,
  GasEstimate,
  BuiltTransaction,
  ExecutionMode,
  ExecutorOptions,
  TransactionResult,
  ExecutionResult as WalletExecutionResult,
} from "./wallet/index.js";

// Builders
export {
  spell,
  action,
  conditional,
  repeat,
  forLoop,
  until,
  parallel,
  compute,
  wait,
  emit,
  halt,
  tryBlock,
  advisory,
  pipeline,
  arrayAccess,
  propertyAccess,
  literal,
  param,
  binding,
  binary,
  call,
} from "./builders/index.js";
export type {
  SpellBuilder,
  ActionBuilder,
  ConditionalBuilder,
  LoopBuilder,
  ParallelBuilder,
  ComputeBuilder,
  WaitBuilder,
  EmitBuilder,
  HaltBuilder,
  TryBuilder,
  AdvisoryBuilder,
  PipelineBuilder,
} from "./builders/index.js";

// Venues
export { createVenueRegistry } from "./venues/index.js";
export type {
  VenueAdapter,
  VenueAdapterContext,
  VenueAdapterMeta,
  VenueRegistry,
  OffchainExecutionResult,
  VenueBuildResult,
} from "./venues/types.js";
