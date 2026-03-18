import type { Action, Address, VenueBuildMetadata } from "@grimoirelabs/core";
import { toBigInt as sharedToBigInt } from "../../shared/bigint.js";

export { isLiteralAmount } from "../../shared/bigint.js";

import type { MorphoBlueMarketConfig } from "./markets.js";

export function toBigInt(amount: unknown): bigint {
  if (amount === "max") {
    throw new Error("Morpho adapter requires explicit amount");
  }
  return sharedToBigInt(amount, "Unsupported amount type for Morpho action");
}

export function buildMorphoMetadata(
  action: Extract<
    Action,
    {
      type: "lend" | "withdraw" | "borrow" | "repay" | "supply_collateral" | "withdraw_collateral";
    }
  >,
  market: MorphoBlueMarketConfig,
  options: {
    chainId: number;
    morphoAddress: Address;
    amount: bigint;
    isApproval?: boolean;
  }
): VenueBuildMetadata {
  const quote =
    action.type === "borrow" || action.type === "withdraw" || action.type === "withdraw_collateral"
      ? { expectedOut: options.amount }
      : { expectedIn: options.amount };

  return {
    quote: options.isApproval ? undefined : quote,
    route: {
      chainId: options.chainId,
      morphoAddress: options.morphoAddress,
      marketId: market.id,
      loanToken: market.loanToken,
      collateralToken: market.collateralToken,
      oracle: market.oracle,
      irm: market.irm,
      lltv: market.lltv.toString(),
      approval: options.isApproval === true,
      utilization: null,
    },
  };
}
