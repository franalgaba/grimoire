/**
 * Action types for DeFi operations
 */

import type { Expression } from "./expressions.js";
import type { Address, AssetId, BasisPoints, ChainId } from "./primitives.js";

/** Constraints for actions */
export interface ActionConstraints {
  maxSlippageBps?: BasisPoints;
  deadline?: number; // seconds from now
  minOutput?: Expression;
  maxInput?: Expression;
  maxGas?: bigint;
}

export interface ActionConstraintsResolved {
  maxSlippageBps?: BasisPoints;
  deadline?: number;
  minOutput?: bigint;
  maxInput?: bigint;
  maxGas?: bigint;
}

export type ActionAmount = Expression | bigint;
export type ActionChainId = Expression | ChainId;

type ActionBase =
  | SwapAction
  | LendAction
  | WithdrawAction
  | BorrowAction
  | RepayAction
  | StakeAction
  | UnstakeAction
  | BridgeAction
  | ClaimAction
  | TransferAction
  | ApproveAction;

/** All action types */
export type Action = ActionBase & { constraints?: ActionConstraintsResolved };

/** Action type discriminator */
export type ActionType = Action["type"];

/** Swap tokens */
export interface SwapAction {
  type: "swap";
  venue: string;
  assetIn: AssetId;
  assetOut: AssetId;
  amount: ActionAmount;
  mode: "exact_in" | "exact_out";
}

/** Lend/Supply to protocol */
export interface LendAction {
  type: "lend";
  venue: string;
  asset: AssetId;
  amount: ActionAmount | "max";
}

/** Withdraw from protocol */
export interface WithdrawAction {
  type: "withdraw";
  venue: string;
  asset: AssetId;
  amount: ActionAmount | "max";
}

/** Borrow from protocol */
export interface BorrowAction {
  type: "borrow";
  venue: string;
  asset: AssetId;
  amount: ActionAmount;
  collateral?: AssetId;
}

/** Repay debt */
export interface RepayAction {
  type: "repay";
  venue: string;
  asset: AssetId;
  amount: ActionAmount | "max";
}

/** Stake tokens */
export interface StakeAction {
  type: "stake";
  venue: string;
  asset: AssetId;
  amount: ActionAmount;
}

/** Unstake tokens */
export interface UnstakeAction {
  type: "unstake";
  venue: string;
  asset: AssetId;
  amount: ActionAmount | "max";
}

/** Bridge to another chain */
export interface BridgeAction {
  type: "bridge";
  venue: string;
  asset: AssetId;
  amount: ActionAmount;
  toChain: ActionChainId;
}

/** Claim rewards */
export interface ClaimAction {
  type: "claim";
  venue: string;
  assets?: AssetId[];
}

/** Transfer tokens */
export interface TransferAction {
  type: "transfer";
  asset: AssetId;
  amount: ActionAmount;
  to: Address;
}

/** Approve token spending */
export interface ApproveAction {
  type: "approve";
  asset: AssetId;
  amount: ActionAmount;
  spender: Address;
}

/** Result of building calldata */
export interface CalldataBundle {
  to: Address;
  data: `0x${string}`;
  value: bigint;
  gasLimit?: bigint;
}

/** Result of simulating an action */
export interface SimulationResult {
  success: boolean;
  input: {
    asset: AssetId;
    amount: bigint;
  };
  output: {
    asset: AssetId;
    amount: bigint;
  };
  gasEstimate: bigint;
  priceImpact?: BasisPoints;
  error?: string;
}

/** Result of executing an action */
export interface ActionResult {
  success: boolean;
  action: Action;
  venue: {
    alias: string;
    chain: ChainId;
    address: Address;
  };
  txHash?: `0x${string}`;
  gasUsed?: bigint;
  input: {
    asset: AssetId;
    amount: bigint;
  };
  output: {
    asset: AssetId;
    amount: bigint;
  };
  error?: string;
}
