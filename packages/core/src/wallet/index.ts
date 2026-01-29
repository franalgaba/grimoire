/**
 * Wallet module
 *
 * Provides key management, transaction building, and execution capabilities.
 */

// Types
export type {
  KeySourceType,
  KeyConfig,
  Wallet,
  TransactionRequest,
  TransactionReceipt,
  TransactionLog,
  ProviderConfig,
  GasEstimate,
} from "./types.js";

export { CHAIN_CONFIGS, isTestnet, getChainName } from "./types.js";

// Keystore
export {
  loadPrivateKey,
  createWallet,
  createWalletFromMnemonic,
  createWalletFromConfig,
  getAddressFromConfig,
  KeyLoadError,
} from "./keystore.js";

// Provider
export {
  Provider,
  createProvider,
  formatWei,
  formatGasCostUsd,
} from "./provider.js";

// Transaction Builder
export type { BuiltTransaction } from "./tx-builder.js";
export { TransactionBuilder, createTransactionBuilder } from "./tx-builder.js";

// Executor
export type {
  ExecutionMode,
  ExecutorOptions,
  TransactionResult,
  ExecutionResult,
} from "./executor.js";
export { Executor, createExecutor } from "./executor.js";
