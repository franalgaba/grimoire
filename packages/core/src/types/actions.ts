/**
 * Action types for DeFi operations
 */

import type { Expression } from "./expressions.js";
import type { Address, AssetId, BasisPoints, ChainId } from "./primitives.js";

/** Constraints for actions */
export interface ActionConstraints {
  maxSlippageBps?: BasisPoints;
  maxPriceImpactBps?: BasisPoints;
  deadline?: number; // seconds from now
  minOutput?: Expression;
  maxInput?: Expression;
  minLiquidity?: Expression;
  requireQuote?: Expression;
  requireSimulation?: Expression;
  maxGas?: Expression;
}

export interface ActionConstraintsResolved {
  maxSlippageBps?: BasisPoints;
  maxPriceImpactBps?: BasisPoints;
  deadline?: number;
  minOutput?: bigint;
  maxInput?: bigint;
  minLiquidity?: bigint;
  requireQuote?: boolean;
  requireSimulation?: boolean;
  maxGas?: bigint;
}

export type ActionAmount = Expression | bigint;
export type ActionChainId = Expression | ChainId;
export type CustomActionValue =
  | Expression
  | string
  | number
  | boolean
  | bigint
  | null
  | CustomActionValue[]
  | { [key: string]: CustomActionValue };

type ActionBase =
  | SwapAction
  | LendAction
  | WithdrawAction
  | BorrowAction
  | RepayAction
  | SupplyCollateralAction
  | WithdrawCollateralAction
  | StakeAction
  | UnstakeAction
  | BridgeAction
  | ClaimAction
  | TransferAction
  | ApproveAction
  | AddLiquidityAction
  | AddLiquidityDualAction
  | RemoveLiquidityAction
  | RemoveLiquidityDualAction
  | MintPyAction
  | RedeemPyAction
  | MintSyAction
  | RedeemSyAction
  | TransferLiquidityAction
  | RollOverPtAction
  | ExitMarketAction
  | ConvertLpToPtAction
  | PendleSwapAction
  | CustomAction;

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
  marketId?: string;
}

/** Withdraw from protocol */
export interface WithdrawAction {
  type: "withdraw";
  venue: string;
  asset: AssetId;
  amount: ActionAmount | "max";
  marketId?: string;
}

/** Borrow from protocol */
export interface BorrowAction {
  type: "borrow";
  venue: string;
  asset: AssetId;
  amount: ActionAmount;
  collateral?: AssetId;
  marketId?: string;
}

/** Repay debt */
export interface RepayAction {
  type: "repay";
  venue: string;
  asset: AssetId;
  amount: ActionAmount | "max";
  marketId?: string;
}

/** Supply collateral to protocol */
export interface SupplyCollateralAction {
  type: "supply_collateral";
  venue: string;
  asset: AssetId;
  amount: ActionAmount;
  marketId?: string;
}

/** Withdraw collateral from protocol */
export interface WithdrawCollateralAction {
  type: "withdraw_collateral";
  venue: string;
  asset: AssetId;
  amount: ActionAmount;
  marketId?: string;
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
  to: Address | Expression;
}

/** Approve token spending */
export interface ApproveAction {
  type: "approve";
  asset: AssetId;
  amount: ActionAmount;
  spender: Address;
}

export interface PendleInputAmount {
  asset: AssetId;
  amount: ActionAmount;
}

export interface PendleActionOptions {
  enableAggregator?: boolean;
  aggregators?: string[];
  needScale?: boolean;
  redeemRewards?: boolean;
  additionalData?: string;
  useLimitOrder?: boolean;
}

interface PendleSingleInputActionBase extends PendleActionOptions {
  venue: string;
  asset: AssetId;
  amount: ActionAmount;
  assetOut?: AssetId;
  outputs?: AssetId[];
}

interface PendleMultiInputActionBase extends PendleActionOptions {
  venue: string;
  inputs: PendleInputAmount[];
  outputs: AssetId[];
}

export interface AddLiquidityAction extends PendleSingleInputActionBase {
  type: "add_liquidity";
  keepYt?: boolean;
}

export interface AddLiquidityDualAction extends PendleMultiInputActionBase {
  type: "add_liquidity_dual";
  keepYt?: boolean;
}

export interface RemoveLiquidityAction extends PendleSingleInputActionBase {
  type: "remove_liquidity";
}

export interface RemoveLiquidityDualAction extends PendleMultiInputActionBase {
  type: "remove_liquidity_dual";
}

export interface MintPyAction extends PendleSingleInputActionBase {
  type: "mint_py";
}

export interface RedeemPyAction extends PendleSingleInputActionBase {
  type: "redeem_py";
}

export interface MintSyAction extends PendleSingleInputActionBase {
  type: "mint_sy";
}

export interface RedeemSyAction extends PendleSingleInputActionBase {
  type: "redeem_sy";
}

export interface TransferLiquidityAction extends PendleMultiInputActionBase {
  type: "transfer_liquidity";
  keepYt?: boolean;
}

export interface RollOverPtAction extends PendleSingleInputActionBase {
  type: "roll_over_pt";
}

export interface ExitMarketAction extends PendleMultiInputActionBase {
  type: "exit_market";
}

export interface ConvertLpToPtAction extends PendleSingleInputActionBase {
  type: "convert_lp_to_pt";
}

export interface PendleSwapAction extends PendleMultiInputActionBase {
  type: "pendle_swap";
}

/** Generic custom action routed to venue adapters */
export interface CustomAction {
  type: "custom";
  venue: string;
  op: string;
  args: Record<string, CustomActionValue>;
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
