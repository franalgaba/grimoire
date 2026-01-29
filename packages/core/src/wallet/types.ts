/**
 * Wallet and transaction types
 */

import type { Address } from "../types/primitives.js";

/** Supported key source types */
export type KeySourceType = "raw" | "env" | "mnemonic" | "keystore";

/** Configuration for loading a private key */
export interface KeyConfig {
  /** Type of key source */
  type: KeySourceType;
  /** Source value - env var name, file path, or raw hex */
  source: string;
  /** Password for keystore files */
  password?: string;
  /** Derivation path for mnemonic (default: m/44'/60'/0'/0/0) */
  derivationPath?: string;
}

/** Wallet interface for signing operations */
export interface Wallet {
  /** Get the wallet's address */
  readonly address: Address;
  /** Get the chain ID this wallet is connected to */
  readonly chainId: number;
  /** Sign a transaction */
  signTransaction(tx: TransactionRequest): Promise<string>;
  /** Sign a message */
  signMessage(message: string): Promise<string>;
  /** Send a signed transaction */
  sendTransaction(tx: TransactionRequest): Promise<TransactionReceipt>;
}

/** Transaction request parameters */
export interface TransactionRequest {
  /** Recipient address */
  to: Address;
  /** Transaction value in wei */
  value?: bigint;
  /** Encoded calldata */
  data?: string;
  /** Gas limit */
  gasLimit?: bigint;
  /** Max fee per gas (EIP-1559) */
  maxFeePerGas?: bigint;
  /** Max priority fee per gas (EIP-1559) */
  maxPriorityFeePerGas?: bigint;
  /** Legacy gas price */
  gasPrice?: bigint;
  /** Transaction nonce */
  nonce?: number;
  /** Chain ID */
  chainId?: number;
}

/** Transaction receipt after confirmation */
export interface TransactionReceipt {
  /** Transaction hash */
  hash: string;
  /** Block number */
  blockNumber: bigint;
  /** Block hash */
  blockHash: string;
  /** Gas used */
  gasUsed: bigint;
  /** Effective gas price */
  effectiveGasPrice: bigint;
  /** Transaction status (1 = success, 0 = failure) */
  status: "success" | "reverted";
  /** Contract address if deployment */
  contractAddress?: Address;
  /** Transaction logs */
  logs: TransactionLog[];
}

/** Transaction log entry */
export interface TransactionLog {
  /** Contract address that emitted the log */
  address: Address;
  /** Log topics */
  topics: string[];
  /** Log data */
  data: string;
  /** Log index in the block */
  logIndex: number;
}

/** RPC provider configuration */
export interface ProviderConfig {
  /** Chain ID */
  chainId: number;
  /** Primary RPC URL */
  rpcUrl: string;
  /** Fallback RPC URLs */
  fallbackUrls?: string[];
  /** Request timeout in ms */
  timeout?: number;
  /** Retry attempts */
  retries?: number;
}

/** Gas estimation result */
export interface GasEstimate {
  /** Estimated gas limit */
  gasLimit: bigint;
  /** Current max fee per gas */
  maxFeePerGas: bigint;
  /** Current max priority fee */
  maxPriorityFeePerGas: bigint;
  /** Estimated total cost in wei */
  estimatedCost: bigint;
}

/** Supported chains with default configurations */
export const CHAIN_CONFIGS: Record<number, ProviderConfig> = {
  // Mainnets
  1: {
    chainId: 1,
    rpcUrl: "https://eth.llamarpc.com",
    fallbackUrls: ["https://rpc.ankr.com/eth", "https://ethereum.publicnode.com"],
  },
  10: {
    chainId: 10,
    rpcUrl: "https://mainnet.optimism.io",
    fallbackUrls: ["https://rpc.ankr.com/optimism"],
  },
  137: {
    chainId: 137,
    rpcUrl: "https://polygon-rpc.com",
    fallbackUrls: ["https://rpc.ankr.com/polygon"],
  },
  42161: {
    chainId: 42161,
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    fallbackUrls: ["https://rpc.ankr.com/arbitrum"],
  },
  8453: {
    chainId: 8453,
    rpcUrl: "https://mainnet.base.org",
    fallbackUrls: ["https://base.llamarpc.com"],
  },
  // Testnets
  11155111: {
    chainId: 11155111,
    rpcUrl: "https://rpc.sepolia.org",
    fallbackUrls: ["https://ethereum-sepolia.publicnode.com"],
  },
};

/** Check if a chain ID is a testnet */
export function isTestnet(chainId: number): boolean {
  const testnets = [11155111, 5, 80001, 421613, 84531];
  return testnets.includes(chainId);
}

/** Get chain name from ID */
export function getChainName(chainId: number): string {
  const names: Record<number, string> = {
    1: "Ethereum Mainnet",
    10: "Optimism",
    137: "Polygon",
    42161: "Arbitrum One",
    8453: "Base",
    11155111: "Sepolia",
    5: "Goerli",
    80001: "Mumbai",
    421613: "Arbitrum Goerli",
    84531: "Base Goerli",
  };
  return names[chainId] ?? `Chain ${chainId}`;
}
