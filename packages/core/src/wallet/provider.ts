/**
 * RPC Provider management
 *
 * Handles connection to blockchain nodes with:
 * - Automatic fallback to backup URLs
 * - Retry with exponential backoff
 * - Gas price estimation
 */

import { http, type Abi, type PublicClient, createPublicClient } from "viem";
import { type Chain, arbitrum, base, mainnet, optimism, polygon, sepolia } from "viem/chains";
import type { Address } from "../types/primitives.js";
import type { GasEstimate, ProviderConfig } from "./types.js";

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

/** Default provider configurations */
const DEFAULT_CONFIGS: Record<number, ProviderConfig> = {
  1: {
    chainId: 1,
    rpcUrl: "https://eth.llamarpc.com",
    fallbackUrls: ["https://rpc.ankr.com/eth", "https://ethereum.publicnode.com"],
    timeout: 30000,
    retries: 3,
  },
  10: {
    chainId: 10,
    rpcUrl: "https://mainnet.optimism.io",
    fallbackUrls: ["https://rpc.ankr.com/optimism"],
    timeout: 30000,
    retries: 3,
  },
  137: {
    chainId: 137,
    rpcUrl: "https://polygon-rpc.com",
    fallbackUrls: ["https://rpc.ankr.com/polygon"],
    timeout: 30000,
    retries: 3,
  },
  42161: {
    chainId: 42161,
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    fallbackUrls: ["https://rpc.ankr.com/arbitrum"],
    timeout: 30000,
    retries: 3,
  },
  8453: {
    chainId: 8453,
    rpcUrl: "https://mainnet.base.org",
    fallbackUrls: ["https://base.llamarpc.com"],
    timeout: 30000,
    retries: 3,
  },
  999: {
    chainId: 999,
    rpcUrl: "https://rpc.hyperliquid.xyz/evm",
    timeout: 30000,
    retries: 3,
  },
  11155111: {
    chainId: 11155111,
    rpcUrl: "https://rpc.sepolia.org",
    fallbackUrls: ["https://ethereum-sepolia.publicnode.com"],
    timeout: 30000,
    retries: 3,
  },
};

/**
 * Provider wrapper with fallback and retry support
 */
export class Provider {
  private client: PublicClient;
  private config: ProviderConfig;
  private currentUrlIndex = 0;

  constructor(config: ProviderConfig) {
    this.config = {
      ...config,
      timeout: config.timeout ?? 30000,
      retries: config.retries ?? 3,
    };

    const chain = VIEM_CHAINS[config.chainId];
    if (!chain) {
      throw new Error(`Unsupported chain ID: ${config.chainId}`);
    }

    this.client = createPublicClient({
      chain,
      transport: http(config.rpcUrl, {
        timeout: this.config.timeout,
        retryCount: this.config.retries,
      }),
    });
  }

  /**
   * Get the chain ID
   */
  get chainId(): number {
    return this.config.chainId;
  }

  /**
   * Get the current RPC URL
   */
  get rpcUrl(): string {
    const urls = [this.config.rpcUrl, ...(this.config.fallbackUrls ?? [])];
    return urls[this.currentUrlIndex] ?? this.config.rpcUrl;
  }

  /**
   * Get underlying viem client
   */
  getClient(): PublicClient {
    return this.client;
  }

  /**
   * Get the current block number
   */
  async getBlockNumber(): Promise<bigint> {
    return await this.withRetry(() => this.client.getBlockNumber());
  }

  /**
   * Get the balance of an address
   */
  async getBalance(address: Address): Promise<bigint> {
    return await this.withRetry(() =>
      this.client.getBalance({ address: address as `0x${string}` })
    );
  }

  /**
   * Get the nonce for an address
   */
  async getNonce(address: Address): Promise<number> {
    return await this.withRetry(() =>
      this.client.getTransactionCount({ address: address as `0x${string}` })
    );
  }

  /**
   * Estimate gas for a transaction
   */
  async estimateGas(tx: {
    to: Address;
    data?: string;
    value?: bigint;
    from?: Address;
  }): Promise<bigint> {
    return await this.withRetry(() =>
      this.client.estimateGas({
        to: tx.to as `0x${string}`,
        data: tx.data as `0x${string}` | undefined,
        value: tx.value,
        account: tx.from as `0x${string}` | undefined,
      })
    );
  }

  /**
   * Get current gas prices (EIP-1559)
   */
  async getGasPrices(): Promise<{
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
  }> {
    const block = (await this.withRetry(() => this.client.getBlock({ blockTag: "latest" }))) as {
      baseFeePerGas?: bigint;
    };

    const baseFee = block.baseFeePerGas ?? 0n;
    // Default priority fee of 1.5 gwei, or use oracle if available
    const priorityFee = 1500000000n; // 1.5 gwei

    return {
      maxFeePerGas: baseFee * 2n + priorityFee,
      maxPriorityFeePerGas: priorityFee,
    };
  }

  /**
   * Get full gas estimate for a transaction
   */
  async getGasEstimate(tx: {
    to: Address;
    data?: string;
    value?: bigint;
    from?: Address;
  }): Promise<GasEstimate> {
    const [gasLimit, gasPrices] = await Promise.all([this.estimateGas(tx), this.getGasPrices()]);

    // Add 20% buffer to gas limit
    const bufferedGasLimit = (gasLimit * 120n) / 100n;

    return {
      gasLimit: bufferedGasLimit,
      maxFeePerGas: gasPrices.maxFeePerGas,
      maxPriorityFeePerGas: gasPrices.maxPriorityFeePerGas,
      estimatedCost: bufferedGasLimit * gasPrices.maxFeePerGas,
    };
  }

  /**
   * Read contract data
   */
  async readContract<T>(params: {
    address: Address;
    abi: Abi;
    functionName: string;
    args?: readonly unknown[];
  }): Promise<T> {
    return await this.withRetry(
      () =>
        this.client.readContract({
          address: params.address as `0x${string}`,
          abi: params.abi,
          functionName: params.functionName,
          args: params.args,
        }) as Promise<T>
    );
  }

  /**
   * Wait for a transaction receipt
   */
  async waitForTransaction(hash: string, confirmations = 1): Promise<unknown> {
    return await this.withRetry(() =>
      this.client.waitForTransactionReceipt({
        hash: hash as `0x${string}`,
        confirmations,
      })
    );
  }

  /**
   * Execute with retry and fallback
   */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    const urls = [this.config.rpcUrl, ...(this.config.fallbackUrls ?? [])];
    let lastError: Error | null = null;

    for (let urlIndex = 0; urlIndex < urls.length; urlIndex++) {
      for (let attempt = 0; attempt < (this.config.retries ?? 3); attempt++) {
        try {
          return await fn();
        } catch (error) {
          lastError = error as Error;

          // If this is a rate limit or connection error, try next URL
          if (this.shouldSwitchProvider(error)) {
            break;
          }

          // Exponential backoff
          if (attempt < (this.config.retries ?? 3) - 1) {
            await this.sleep(2 ** attempt * 1000);
          }
        }
      }

      // Try next URL
      if (urlIndex < urls.length - 1) {
        this.switchToUrl(urlIndex + 1);
      }
    }

    throw lastError ?? new Error("All retry attempts failed");
  }

  /**
   * Check if we should switch to a different provider
   */
  private shouldSwitchProvider(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes("rate limit") ||
        message.includes("too many requests") ||
        message.includes("connection refused") ||
        message.includes("econnrefused") ||
        message.includes("timeout")
      );
    }
    return false;
  }

  /**
   * Switch to a different RPC URL
   */
  private switchToUrl(index: number): void {
    const urls = [this.config.rpcUrl, ...(this.config.fallbackUrls ?? [])];
    if (index >= urls.length) return;

    this.currentUrlIndex = index;
    const chain = VIEM_CHAINS[this.config.chainId];

    this.client = createPublicClient({
      chain,
      transport: http(urls[index], {
        timeout: this.config.timeout,
        retryCount: this.config.retries,
      }),
    });
  }

  /**
   * Sleep for a duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create a provider for a specific chain
 */
export function createProvider(chainId: number, rpcUrl?: string): Provider {
  const defaultConfig = DEFAULT_CONFIGS[chainId];

  if (!defaultConfig && !rpcUrl) {
    throw new Error(`No default configuration for chain ${chainId}. Please provide an RPC URL.`);
  }

  const config: ProviderConfig = {
    chainId,
    rpcUrl: rpcUrl ?? defaultConfig?.rpcUrl ?? "",
    fallbackUrls: defaultConfig?.fallbackUrls,
    timeout: defaultConfig?.timeout ?? 30000,
    retries: defaultConfig?.retries ?? 3,
  };

  return new Provider(config);
}

/**
 * Format wei to human-readable string
 */
export function formatWei(wei: bigint, decimals = 18): string {
  const divisor = 10n ** BigInt(decimals);
  const integerPart = wei / divisor;
  const fractionalPart = wei % divisor;

  if (fractionalPart === 0n) {
    return integerPart.toString();
  }

  const fractionalStr = fractionalPart.toString().padStart(decimals, "0");
  const trimmed = fractionalStr.replace(/0+$/, "");

  return `${integerPart}.${trimmed}`;
}

/**
 * Format gas cost to USD (rough estimate)
 */
export function formatGasCostUsd(gasUsed: bigint, gasPrice: bigint, ethPriceUsd = 2000): string {
  const costWei = gasUsed * gasPrice;
  const costEth = Number(costWei) / 1e18;
  const costUsd = costEth * ethPriceUsd;

  return `$${costUsd.toFixed(2)}`;
}
