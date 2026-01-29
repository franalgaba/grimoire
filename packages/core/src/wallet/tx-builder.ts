/**
 * Transaction builder
 *
 * Builds transactions from spell actions, supporting:
 * - ERC20 operations (transfer, approve)
 * - Swap operations
 * - Lending operations (deposit, withdraw)
 */

import { encodeFunctionData, parseAbi } from "viem";
import type { Action } from "../types/actions.js";
import type { Address } from "../types/primitives.js";
import type { Provider } from "./provider.js";
import type { GasEstimate, TransactionRequest } from "./types.js";

/** Standard ERC20 ABI */
const ERC20_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

/** Built transaction with metadata */
export interface BuiltTransaction {
  /** The transaction request */
  tx: TransactionRequest;
  /** Human-readable description */
  description: string;
  /** Gas estimate */
  gasEstimate?: GasEstimate;
  /** Action this transaction executes */
  action: Action;
}

/**
 * Transaction builder class
 */
export class TransactionBuilder {
  private provider: Provider;
  private fromAddress: Address;

  constructor(provider: Provider, fromAddress: Address) {
    this.provider = provider;
    this.fromAddress = fromAddress;
  }

  /**
   * Build a transaction from an action
   */
  async buildAction(action: Action): Promise<BuiltTransaction> {
    switch (action.type) {
      case "transfer":
        return this.buildTransfer(action);
      case "approve":
        return this.buildApprove(action);
      case "swap":
        return this.buildSwap(action);
      case "lend":
        return this.buildLend(action);
      case "withdraw":
        return this.buildWithdraw(action);
      default:
        throw new Error(`Unsupported action type: ${action.type}`);
    }
  }

  /**
   * Build an ERC20 transfer transaction
   */
  async buildTransfer(action: Action): Promise<BuiltTransaction> {
    if (action.type !== "transfer") {
      throw new Error("Invalid action type for transfer");
    }

    const tokenAddress = this.resolveAssetAddress(action.asset);
    const toAddress = action.to as Address;
    const amount = BigInt(action.amount?.toString() ?? "0");

    const data = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [toAddress as `0x${string}`, amount],
    });

    const tx: TransactionRequest = {
      to: tokenAddress,
      data,
      value: 0n,
    };

    const gasEstimate = await this.provider.getGasEstimate({
      ...tx,
      from: this.fromAddress,
    });

    return {
      tx: {
        ...tx,
        gasLimit: gasEstimate.gasLimit,
        maxFeePerGas: gasEstimate.maxFeePerGas,
        maxPriorityFeePerGas: gasEstimate.maxPriorityFeePerGas,
      },
      description: `Transfer ${formatAmount(amount)} ${action.asset} to ${shortenAddress(toAddress)}`,
      gasEstimate,
      action,
    };
  }

  /**
   * Build an ERC20 approve transaction
   */
  async buildApprove(action: Action): Promise<BuiltTransaction> {
    if (action.type !== "approve") {
      throw new Error("Invalid action type for approve");
    }

    const tokenAddress = this.resolveAssetAddress(action.asset);
    const spenderAddress = action.spender as Address;
    const amount = BigInt(action.amount?.toString() ?? "0");

    const data = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "approve",
      args: [spenderAddress as `0x${string}`, amount],
    });

    const tx: TransactionRequest = {
      to: tokenAddress,
      data,
      value: 0n,
    };

    const gasEstimate = await this.provider.getGasEstimate({
      ...tx,
      from: this.fromAddress,
    });

    return {
      tx: {
        ...tx,
        gasLimit: gasEstimate.gasLimit,
        maxFeePerGas: gasEstimate.maxFeePerGas,
        maxPriorityFeePerGas: gasEstimate.maxPriorityFeePerGas,
      },
      description: `Approve ${formatAmount(amount)} ${action.asset} for ${shortenAddress(spenderAddress)}`,
      gasEstimate,
      action,
    };
  }

  /**
   * Build a swap transaction (placeholder - requires venue adapter)
   */
  async buildSwap(action: Action): Promise<BuiltTransaction> {
    if (action.type !== "swap") {
      throw new Error("Invalid action type for swap");
    }

    // TODO: Implement with venue adapters in Phase 2
    throw new Error(
      `Swap transactions require venue adapters. Venue: ${action.venue}, ` +
        `${action.assetIn} → ${action.assetOut}`
    );
  }

  /**
   * Build a lending deposit transaction (placeholder - requires venue adapter)
   */
  async buildLend(action: Action): Promise<BuiltTransaction> {
    if (action.type !== "lend") {
      throw new Error("Invalid action type for lend");
    }

    // TODO: Implement with venue adapters in Phase 2
    throw new Error(
      `Lend transactions require venue adapters. Venue: ${action.venue}, ` +
        `Asset: ${action.asset}`
    );
  }

  /**
   * Build a withdrawal transaction (placeholder - requires venue adapter)
   */
  async buildWithdraw(action: Action): Promise<BuiltTransaction> {
    if (action.type !== "withdraw") {
      throw new Error("Invalid action type for withdraw");
    }

    // TODO: Implement with venue adapters in Phase 2
    throw new Error(
      `Withdraw transactions require venue adapters. Venue: ${action.venue}, ` +
        `Asset: ${action.asset}`
    );
  }

  /**
   * Build a raw transaction
   */
  async buildRaw(
    to: Address,
    data: string,
    value = 0n,
    description = "Raw transaction"
  ): Promise<BuiltTransaction> {
    const tx: TransactionRequest = {
      to,
      data,
      value,
    };

    const gasEstimate = await this.provider.getGasEstimate({
      ...tx,
      from: this.fromAddress,
    });

    const action: Action = {
      type: "transfer",
      asset: "ETH",
      amount: { kind: "literal", value: 0n, type: "int" },
      to,
    };

    return {
      tx: {
        ...tx,
        gasLimit: gasEstimate.gasLimit,
        maxFeePerGas: gasEstimate.maxFeePerGas,
        maxPriorityFeePerGas: gasEstimate.maxPriorityFeePerGas,
      },
      description,
      gasEstimate,
      action,
    };
  }

  /**
   * Check ERC20 allowance
   */
  async checkAllowance(tokenAddress: Address, spenderAddress: Address): Promise<bigint> {
    return await this.provider.readContract<bigint>({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [this.fromAddress, spenderAddress],
    });
  }

  /**
   * Check ERC20 balance
   */
  async checkBalance(tokenAddress: Address): Promise<bigint> {
    return await this.provider.readContract<bigint>({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [this.fromAddress],
    });
  }

  /**
   * Get token decimals
   */
  async getTokenDecimals(tokenAddress: Address): Promise<number> {
    return await this.provider.readContract<number>({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "decimals",
    });
  }

  /**
   * Get token symbol
   */
  async getTokenSymbol(tokenAddress: Address): Promise<string> {
    return await this.provider.readContract<string>({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "symbol",
    });
  }

  /**
   * Resolve asset symbol to address
   * TODO: Implement proper asset registry
   */
  private resolveAssetAddress(asset: string | undefined): Address {
    if (!asset) {
      throw new Error("Asset is required");
    }

    // If it's already an address, return it
    if (asset.startsWith("0x") && asset.length === 42) {
      return asset as Address;
    }

    // Known token addresses (mainnet)
    const KNOWN_TOKENS: Record<string, Address> = {
      USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
      USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7" as Address,
      DAI: "0x6B175474E89094C44Da98b954EescdeCB5cB92c0" as Address,
      WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address,
      WBTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" as Address,
    };

    const address = KNOWN_TOKENS[asset.toUpperCase()];
    if (!address) {
      throw new Error(`Unknown asset: ${asset}. Provide address directly.`);
    }

    return address;
  }
}

/**
 * Shorten an address for display
 */
function shortenAddress(address: Address): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Format an amount for display
 */
function formatAmount(amount: bigint, decimals = 18): string {
  const divisor = 10n ** BigInt(decimals);
  const integerPart = amount / divisor;
  const fractionalPart = amount % divisor;

  if (fractionalPart === 0n) {
    return integerPart.toString();
  }

  const fractionalStr = fractionalPart.toString().padStart(decimals, "0");
  const trimmed = fractionalStr.slice(0, 4).replace(/0+$/, "") || "0";

  return `${integerPart}.${trimmed}`;
}

/**
 * Create a transaction builder
 */
export function createTransactionBuilder(
  provider: Provider,
  fromAddress: Address
): TransactionBuilder {
  return new TransactionBuilder(provider, fromAddress);
}
