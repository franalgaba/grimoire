/**
 * Wallet module
 *
 * Provides key management, transaction building, and execution capabilities.
 */

// Executor
export type {
  ExecutionMode,
  ExecutionResult,
  ExecutorOptions,
  TransactionResult,
} from "./executor.js";
export { createExecutor, Executor } from "./executor.js";

// Keystore
export {
  createKeystore,
  createWallet,
  createWalletFromConfig,
  createWalletFromMnemonic,
  generatePrivateKey,
  getAddressFromConfig,
  KeyLoadError,
  loadPrivateKey,
} from "./keystore.js";

// Provider
export {
  createProvider,
  formatGasCostUsd,
  formatWei,
  Provider,
} from "./provider.js";

// Transaction Builder
export type { BuiltTransaction } from "./tx-builder.js";
export { createTransactionBuilder, TransactionBuilder } from "./tx-builder.js";
// Types
export type {
  GasEstimate,
  KeyConfig,
  KeySourceType,
  ProviderConfig,
  TransactionLog,
  TransactionReceipt,
  TransactionRequest,
  Wallet,
} from "./types.js";
export {
  CHAIN_CONFIGS,
  getChainName,
  getNativeCurrencySymbol,
  isNativeCurrency,
  isTestnet,
} from "./types.js";
