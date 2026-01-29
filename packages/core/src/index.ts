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
} from "./runtime/index.js";
export type {
  ExecuteOptions,
  CreateContextOptions,
  EvalContext,
  EvalValue,
} from "./runtime/index.js";

// Wallet
export {
  createWallet,
  createWalletFromMnemonic,
  createWalletFromConfig,
  getAddressFromConfig,
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
  ExecutionResult,
} from "./wallet/index.js";

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
