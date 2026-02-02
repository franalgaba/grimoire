/**
 * Private key management
 *
 * Supports loading keys from:
 * - Environment variables
 * - Raw hex strings (for testing)
 * - BIP-39 mnemonics
 * - Encrypted keystore JSON files
 */

import { readFileSync } from "node:fs";
import { Wallet as EthersWallet } from "ethers";
import {
  http,
  type Account,
  type Chain,
  type Transport,
  type WalletClient,
  createWalletClient,
  publicActions,
} from "viem";
import {
  mnemonicToAccount,
  privateKeyToAccount,
  generatePrivateKey as viemGeneratePrivateKey,
} from "viem/accounts";
import { arbitrum, base, mainnet, optimism, polygon, sepolia } from "viem/chains";
import type { Address } from "../types/primitives.js";
import type { KeyConfig, TransactionReceipt, TransactionRequest, Wallet } from "./types.js";

/** Error thrown when key loading fails */
export class KeyLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyLoadError";
  }
}

/** HyperEVM chain definition */
const hyperEVM: Chain = {
  id: 999,
  name: "HyperEVM",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.hyperliquid.xyz/evm"] },
  },
};

/** Map chain IDs to viem chain objects */
const VIEM_CHAINS: Record<number, Chain> = {
  1: mainnet,
  10: optimism,
  137: polygon,
  42161: arbitrum,
  8453: base,
  999: hyperEVM,
  11155111: sepolia,
};

type WalletClientWithPublicActions = WalletClient<Transport, Chain, Account> &
  ReturnType<typeof publicActions>;

type WalletSendTransactionRequest = Parameters<WalletClientWithPublicActions["sendTransaction"]>[0];

/**
 * Load a private key from the specified source
 */
export function loadPrivateKey(config: KeyConfig): `0x${string}` {
  switch (config.type) {
    case "raw":
      return validatePrivateKey(config.source);

    case "env": {
      const value = process.env[config.source];
      if (!value) {
        throw new KeyLoadError(`Environment variable ${config.source} is not set`);
      }
      return validatePrivateKey(value);
    }

    case "mnemonic": {
      // For mnemonic, the source is the mnemonic phrase
      // Check if it's an env var reference
      let mnemonic = config.source;
      if (!mnemonic.includes(" ")) {
        // Likely an env var name
        const envValue = process.env[config.source];
        if (envValue) {
          mnemonic = envValue;
        }
      }

      if (!isValidMnemonic(mnemonic)) {
        throw new KeyLoadError("Invalid mnemonic phrase");
      }

      const path = (config.derivationPath ?? "m/44'/60'/0'/0/0") as `m/44'/60'/${string}`;
      const _account = mnemonicToAccount(mnemonic, { path });
      // Note: viem doesn't expose the private key directly from mnemonic account
      // We need to derive it differently for raw access
      throw new KeyLoadError(
        "Mnemonic support requires direct account usage. Use createWalletFromMnemonic instead."
      );
    }

    case "keystore":
      return loadPrivateKeyFromKeystore(config);

    default:
      throw new KeyLoadError(`Unknown key source type: ${config.type}`);
  }
}

/**
 * Validate and normalize a private key
 */
function validatePrivateKey(key: string): `0x${string}` {
  // Remove whitespace
  let normalized = key.trim();

  // Add 0x prefix if missing
  if (!normalized.startsWith("0x")) {
    normalized = `0x${normalized}`;
  }

  // Check length (32 bytes = 64 hex chars + 0x prefix)
  if (normalized.length !== 66) {
    throw new KeyLoadError(
      `Invalid private key length: expected 66 characters, got ${normalized.length}`
    );
  }

  // Check if valid hex
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new KeyLoadError("Invalid private key: must be 32 bytes of hex");
  }

  return normalized as `0x${string}`;
}

/**
 * Load a private key from a keystore JSON source
 */
function loadPrivateKeyFromKeystore(config: KeyConfig): `0x${string}` {
  if (!config.password) {
    throw new KeyLoadError("Keystore password is required");
  }

  const keystoreJson = resolveKeystoreSource(config.source);

  try {
    const wallet = EthersWallet.fromEncryptedJsonSync(keystoreJson, config.password);
    return validatePrivateKey(wallet.privateKey);
  } catch (error) {
    throw new KeyLoadError(`Failed to decrypt keystore: ${(error as Error).message}`);
  }
}

/**
 * Resolve keystore JSON from file path, env var, or raw JSON string
 */
function resolveKeystoreSource(source: string): string {
  const trimmed = source.trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const envValue = process.env[source];
  if (envValue) {
    return envValue;
  }

  try {
    return readFileSync(source, "utf-8");
  } catch (error) {
    throw new KeyLoadError(
      `Unable to read keystore JSON from '${source}': ${(error as Error).message}`
    );
  }
}

/**
 * Check if a string is a valid BIP-39 mnemonic
 */
function isValidMnemonic(phrase: string): boolean {
  const words = phrase.trim().split(/\s+/);
  // BIP-39 mnemonics are 12, 15, 18, 21, or 24 words
  return [12, 15, 18, 21, 24].includes(words.length);
}

/**
 * Create a wallet from a private key
 */
export function createWallet(privateKey: `0x${string}`, chainId: number, rpcUrl: string): Wallet {
  const account = privateKeyToAccount(privateKey);
  const chain = VIEM_CHAINS[chainId];

  if (!chain) {
    throw new KeyLoadError(`Unsupported chain ID: ${chainId}`);
  }

  const client = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  }).extend(publicActions);

  return new ViemWallet(client, account, chainId);
}

/**
 * Create a wallet from a mnemonic phrase
 */
export function createWalletFromMnemonic(
  mnemonic: string,
  chainId: number,
  rpcUrl: string,
  derivationPath?: string
): Wallet {
  const path = (derivationPath ?? "m/44'/60'/0'/0/0") as `m/44'/60'/${string}`;
  const account = mnemonicToAccount(mnemonic, { path });
  const chain = VIEM_CHAINS[chainId];

  if (!chain) {
    throw new KeyLoadError(`Unsupported chain ID: ${chainId}`);
  }

  const client = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  }).extend(publicActions);

  return new ViemWallet(client, account, chainId);
}

/**
 * Create a wallet from configuration
 */
export function createWalletFromConfig(config: KeyConfig, chainId: number, rpcUrl: string): Wallet {
  if (config.type === "mnemonic") {
    let mnemonic = config.source;
    // Check if it's an env var reference
    if (!mnemonic.includes(" ")) {
      const envValue = process.env[config.source];
      if (envValue) {
        mnemonic = envValue;
      }
    }
    return createWalletFromMnemonic(mnemonic, chainId, rpcUrl, config.derivationPath);
  }

  const privateKey = loadPrivateKey(config);
  return createWallet(privateKey, chainId, rpcUrl);
}

/**
 * Wallet implementation using viem
 */
class ViemWallet implements Wallet {
  private client: WalletClientWithPublicActions;
  private account: Account;
  readonly chainId: number;

  constructor(client: WalletClientWithPublicActions, account: Account, chainId: number) {
    this.client = client;
    this.account = account;
    this.chainId = chainId;
  }

  get address(): Address {
    return this.account.address as Address;
  }

  async signTransaction(tx: TransactionRequest): Promise<string> {
    const request = this.toViemRequest(tx) as unknown as Parameters<
      NonNullable<Account["signTransaction"]>
    >[0];
    if (!this.account.signTransaction) {
      throw new Error("Account does not support signTransaction");
    }
    return await this.account.signTransaction(request);
  }

  async signMessage(message: string): Promise<string> {
    return await this.client.signMessage({
      account: this.account,
      message,
    });
  }

  async sendTransaction(tx: TransactionRequest): Promise<TransactionReceipt> {
    const request = this.toViemRequest(tx);

    // Send the transaction
    const hash = await this.client.sendTransaction(request);

    // Wait for confirmation
    const receipt = await this.client.waitForTransactionReceipt({
      hash,
      confirmations: 1,
    });

    return {
      hash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      gasUsed: receipt.gasUsed,
      effectiveGasPrice: receipt.effectiveGasPrice,
      status: receipt.status === "success" ? "success" : "reverted",
      contractAddress: receipt.contractAddress as Address | undefined,
      logs: receipt.logs.map((log) => ({
        address: log.address as Address,
        topics: log.topics,
        data: log.data,
        logIndex: log.logIndex,
      })),
    };
  }

  private toViemRequest(tx: TransactionRequest): WalletSendTransactionRequest {
    return {
      to: tx.to,
      value: tx.value,
      data: tx.data as `0x${string}` | undefined,
      gas: tx.gasLimit,
      maxFeePerGas: tx.maxFeePerGas,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
      nonce: tx.nonce,
    } as WalletSendTransactionRequest;
  }
}

/**
 * Generate a new random private key
 */
export function generatePrivateKey(): `0x${string}` {
  return viemGeneratePrivateKey();
}

/**
 * Encrypt a private key into a keystore JSON string
 */
export async function createKeystore(privateKey: `0x${string}`, password: string): Promise<string> {
  if (!password) {
    throw new KeyLoadError("Keystore password must not be empty");
  }
  const wallet = new EthersWallet(privateKey);
  return await wallet.encrypt(password);
}

/**
 * Get wallet address from a key config without creating full wallet
 */
export function getAddressFromConfig(config: KeyConfig): Address {
  if (config.type === "mnemonic") {
    let mnemonic = config.source;
    if (!mnemonic.includes(" ")) {
      const envValue = process.env[config.source];
      if (envValue) {
        mnemonic = envValue;
      }
    }
    const path = (config.derivationPath ?? "m/44'/60'/0'/0/0") as `m/44'/60'/${string}`;
    const account = mnemonicToAccount(mnemonic, { path });
    return account.address as Address;
  }

  const privateKey = loadPrivateKey(config);
  const account = privateKeyToAccount(privateKey);
  return account.address as Address;
}
