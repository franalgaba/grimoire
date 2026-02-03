import type { Action } from "../types/actions.js";
import { createVenueRegistry } from "../venues/index.js";
import type { OffchainExecutionResult, VenueAdapter, VenueRegistry } from "../venues/types.js";
import { type Provider, formatGasCostUsd, formatWei } from "./provider.js";
import { type BuiltTransaction, TransactionBuilder } from "./tx-builder.js";
import type { TransactionReceipt, TransactionRequest, Wallet } from "./types.js";
import { getChainName, getNativeCurrencySymbol, isTestnet } from "./types.js";

/** Execution mode */
export type ExecutionMode = "simulate" | "dry-run" | "execute";

/** Execution options */
export interface ExecutorOptions {
  /** The wallet to use for signing */
  wallet: Wallet;
  /** The provider for blockchain interaction */
  provider: Provider;
  /** Execution mode */
  mode: ExecutionMode;
  /** Callback for confirmation prompts */
  confirmCallback?: (message: string) => Promise<boolean>;
  /** Callback for progress updates */
  progressCallback?: (message: string) => void;
  /** Skip confirmation for testnets */
  skipTestnetConfirmation?: boolean;
  /** Gas price multiplier (default: 1.0) */
  gasMultiplier?: number;
  /** Number of confirmations to wait for */
  confirmations?: number;
  /** Venue adapters */
  adapters?: VenueAdapter[];
}

/** Result of a single transaction execution */
export interface TransactionResult {
  /** Whether the transaction succeeded */
  success: boolean;
  /** Transaction hash (if executed) */
  hash?: string;
  /** Transaction receipt (if confirmed) */
  receipt?: TransactionReceipt;
  /** Gas used */
  gasUsed?: bigint;
  /** Error message (if failed) */
  error?: string;
  /** The built transaction */
  builtTx: BuiltTransaction;
}

/** Result of executing all transactions */
export interface ExecutionResult {
  /** Whether all transactions succeeded */
  success: boolean;
  /** Results for each transaction */
  transactions: TransactionResult[];
  /** Total gas used */
  totalGasUsed: bigint;
  /** Total cost in wei */
  totalCost: bigint;
  /** Execution mode used */
  mode: ExecutionMode;
  /** Error message (if failed) */
  error?: string;
}

/**
 * Transaction executor class
 */
export class Executor {
  private wallet: Wallet;
  private provider: Provider;
  private txBuilder: TransactionBuilder;
  private options: ExecutorOptions;
  private adapterRegistry: VenueRegistry;

  constructor(options: ExecutorOptions) {
    this.wallet = options.wallet;
    this.provider = options.provider;
    this.options = options;
    this.txBuilder = new TransactionBuilder(options.provider, options.wallet.address);
    this.adapterRegistry = createVenueRegistry(options.adapters ?? []);
  }

  /**
   * Execute a list of actions
   */
  async executeActions(actions: Action[]): Promise<ExecutionResult> {
    const results: TransactionResult[] = [];
    let totalGasUsed = 0n;
    let totalCost = 0n;

    // Build all transactions first
    const builtTxs: BuiltTransaction[] = [];
    for (const action of actions) {
      try {
        const builtTx = await this.buildAction(action);
        builtTxs.push(...builtTx);
      } catch (error) {
        return {
          success: false,
          transactions: results,
          totalGasUsed,
          totalCost,
          mode: this.options.mode,
          error: `Failed to build transaction: ${(error as Error).message}`,
        };
      }
    }

    // In simulate mode, just return the built transactions
    if (this.options.mode === "simulate") {
      return {
        success: true,
        transactions: builtTxs.map((builtTx) => ({
          success: true,
          builtTx,
        })),
        totalGasUsed: builtTxs.reduce((sum, tx) => sum + (tx.gasEstimate?.gasLimit ?? 0n), 0n),
        totalCost: builtTxs.reduce((sum, tx) => sum + (tx.gasEstimate?.estimatedCost ?? 0n), 0n),
        mode: "simulate",
      };
    }

    // Show summary and get confirmation
    if (this.options.mode === "execute") {
      const shouldProceed = await this.confirmExecution(builtTxs);
      if (!shouldProceed) {
        return {
          success: false,
          transactions: [],
          totalGasUsed: 0n,
          totalCost: 0n,
          mode: "execute",
          error: "Execution cancelled by user",
        };
      }
    }

    // Execute transactions
    for (let i = 0; i < builtTxs.length; i++) {
      const builtTx = builtTxs[i];
      this.progress(`Executing step ${i + 1}/${builtTxs.length}: ${builtTx.description}`);

      if (this.options.mode === "dry-run") {
        // Dry-run: don't actually send
        results.push({
          success: true,
          builtTx,
        });
        continue;
      }

      const offchainResult = await this.tryExecuteOffchainAction(builtTx.action);
      if (offchainResult) {
        const result = offchainResult.success
          ? {
              success: true,
              hash: offchainResult.id,
              builtTx,
            }
          : {
              success: false,
              error: offchainResult.error,
              builtTx,
            };

        results.push(result);

        if (!result.success) {
          return {
            success: false,
            transactions: results,
            totalGasUsed,
            totalCost,
            mode: this.options.mode,
            error: `Offchain action ${i + 1} failed: ${result.error}`,
          };
        }

        continue;
      }

      try {
        // Apply gas multiplier
        const tx = this.applyGasMultiplier(builtTx.tx);

        // Send the transaction
        const receipt = await this.wallet.sendTransaction(tx);

        const gasUsed = receipt.gasUsed;
        const cost = gasUsed * receipt.effectiveGasPrice;
        totalGasUsed += gasUsed;
        totalCost += cost;

        if (receipt.status === "reverted") {
          results.push({
            success: false,
            hash: receipt.hash,
            receipt,
            gasUsed,
            error: "Transaction reverted",
            builtTx,
          });

          return {
            success: false,
            transactions: results,
            totalGasUsed,
            totalCost,
            mode: "execute",
            error: `Transaction ${i + 1} reverted`,
          };
        }

        this.progress(`✓ Confirmed: ${receipt.hash}`);

        results.push({
          success: true,
          hash: receipt.hash,
          receipt,
          gasUsed,
          builtTx,
        });
      } catch (error) {
        results.push({
          success: false,
          error: (error as Error).message,
          builtTx,
        });

        return {
          success: false,
          transactions: results,
          totalGasUsed,
          totalCost,
          mode: "execute",
          error: `Transaction ${i + 1} failed: ${(error as Error).message}`,
        };
      }
    }

    return {
      success: true,
      transactions: results,
      totalGasUsed,
      totalCost,
      mode: this.options.mode,
    };
  }

  /**
   * Execute a single action
   */
  async executeAction(action: Action): Promise<TransactionResult> {
    const result = await this.executeActions([action]);
    return (
      result.transactions[result.transactions.length - 1] ?? {
        success: false,
        error: result.error ?? "No transaction result",
        builtTx: { tx: {} as TransactionRequest, description: "", action },
      }
    );
  }

  private async buildAction(action: Action): Promise<BuiltTransaction[]> {
    if ("venue" in action && action.venue) {
      const adapter = this.adapterRegistry.get(action.venue);
      if (adapter?.meta.supportedChains.includes(this.provider.chainId)) {
        if (adapter.meta.executionType === "offchain") {
          if (adapter.buildAction) {
            return this.normalizeBuildResult(
              await adapter.buildAction(action, {
                provider: this.provider,
                walletAddress: this.wallet.address,
                chainId: this.provider.chainId,
                mode: this.options.mode,
              })
            );
          }

          return [
            {
              tx: {},
              description: `Offchain action via ${adapter.meta.name}`,
              action,
            } as BuiltTransaction,
          ];
        }

        if (!adapter.buildAction) {
          throw new Error(`Adapter '${adapter.meta.name}' does not support EVM actions`);
        }

        return this.normalizeBuildResult(
          await adapter.buildAction(action, {
            provider: this.provider,
            walletAddress: this.wallet.address,
            chainId: this.provider.chainId,
            mode: this.options.mode,
          })
        );
      }
    }

    return [await this.txBuilder.buildAction(action)];
  }

  private normalizeBuildResult(result: BuiltTransaction | BuiltTransaction[]): BuiltTransaction[] {
    return Array.isArray(result) ? result : [result];
  }

  /**
   * Get execution summary without executing
   */
  async getExecutionSummary(actions: Action[]): Promise<{
    transactions: BuiltTransaction[];
    totalGasEstimate: bigint;
    totalCostEstimate: bigint;
  }> {
    const builtTxs: BuiltTransaction[] = [];

    for (const action of actions) {
      const builtTx = await this.buildAction(action);
      builtTxs.push(...builtTx);
    }

    return {
      transactions: builtTxs,
      totalGasEstimate: builtTxs.reduce((sum, tx) => sum + (tx.gasEstimate?.gasLimit ?? 0n), 0n),
      totalCostEstimate: builtTxs.reduce(
        (sum, tx) => sum + (tx.gasEstimate?.estimatedCost ?? 0n),
        0n
      ),
    };
  }

  /**
   * Confirm execution with user
   */
  private async confirmExecution(builtTxs: BuiltTransaction[]): Promise<boolean> {
    const chainId = this.provider.chainId;
    const chainName = getChainName(chainId);
    const isTest = isTestnet(chainId);

    // Skip confirmation for testnets if configured
    if (isTest && this.options.skipTestnetConfirmation) {
      return true;
    }

    const totalGas = builtTxs.reduce((sum, tx) => sum + (tx.gasEstimate?.gasLimit ?? 0n), 0n);
    const totalCost = builtTxs.reduce((sum, tx) => sum + (tx.gasEstimate?.estimatedCost ?? 0n), 0n);

    const message = this.buildConfirmationMessage(builtTxs, chainName, isTest, totalGas, totalCost);

    if (this.options.confirmCallback) {
      return await this.options.confirmCallback(message);
    }

    // If no callback provided, default to true for testnets, false for mainnet
    return isTest;
  }

  /**
   * Build confirmation message
   */
  private buildConfirmationMessage(
    builtTxs: BuiltTransaction[],
    chainName: string,
    isTest: boolean,
    totalGas: bigint,
    totalCost: bigint
  ): string {
    const lines: string[] = [
      "",
      `Network: ${chainName}${isTest ? " (testnet)" : ""}`,
      `Wallet: ${this.wallet.address}`,
      "",
      "Transactions to execute:",
    ];

    for (let i = 0; i < builtTxs.length; i++) {
      const tx = builtTxs[i];
      const gasStr = tx.gasEstimate ? ` (gas: ${tx.gasEstimate.gasLimit.toString()})` : "";
      lines.push(`  ${i + 1}. ${tx.description}${gasStr}`);
    }

    lines.push("");
    lines.push(`Total estimated gas: ${totalGas.toString()}`);
    if (totalGas > 0n) {
      lines.push(
        `Total estimated cost: ${formatWei(totalCost)} ${getNativeCurrencySymbol(this.provider.chainId)} (~${formatGasCostUsd(totalGas, totalCost / totalGas)})`
      );
    } else {
      lines.push("Total estimated cost: unknown (no gas estimate)");
    }
    lines.push("");

    if (!isTest) {
      lines.push("⚠️  WARNING: This is MAINNET. Real funds will be used.");
      lines.push("");
    }

    lines.push("Proceed with execution?");

    return lines.join("\n");
  }

  /**
   * Apply gas multiplier to transaction
   */
  private applyGasMultiplier(tx: TransactionRequest): TransactionRequest {
    const multiplier = this.options.gasMultiplier ?? 1.0;

    if (multiplier === 1.0) {
      return tx;
    }

    const multiply = (value: bigint | undefined): bigint | undefined => {
      if (value === undefined) return undefined;
      return BigInt(Math.ceil(Number(value) * multiplier));
    };

    return {
      ...tx,
      gasLimit: multiply(tx.gasLimit),
      maxFeePerGas: multiply(tx.maxFeePerGas),
      maxPriorityFeePerGas: multiply(tx.maxPriorityFeePerGas),
      gasPrice: multiply(tx.gasPrice),
    };
  }

  /**
   * Send progress update
   */
  private progress(message: string): void {
    if (this.options.progressCallback) {
      this.options.progressCallback(message);
    }
  }

  private async tryExecuteOffchainAction(
    action: Action
  ): Promise<(OffchainExecutionResult & { success: boolean; error?: string }) | null> {
    if (!("venue" in action) || !action.venue) {
      return null;
    }

    const adapter = this.adapterRegistry.get(action.venue);
    if (!adapter || adapter.meta.executionType !== "offchain") {
      return null;
    }

    if (!adapter.executeAction) {
      return {
        success: false,
        id: "",
        error: `Adapter '${adapter.meta.name}' does not support offchain execution`,
      };
    }

    try {
      const result = await adapter.executeAction(action, {
        provider: this.provider,
        walletAddress: this.wallet.address,
        chainId: this.provider.chainId,
        mode: this.options.mode,
      });

      return { ...result, success: true };
    } catch (error) {
      return {
        success: false,
        id: "",
        error: (error as Error).message,
      };
    }
  }
}

/**
 * Create an executor
 */
export function createExecutor(options: ExecutorOptions): Executor {
  return new Executor(options);
}
