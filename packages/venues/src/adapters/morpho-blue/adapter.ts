import type { Action, Address, VenueAdapter } from "@grimoirelabs/core";
import { getChainAddresses } from "@morpho-org/blue-sdk";
import { blueAbi } from "@morpho-org/blue-sdk-viem";
import { encodeFunctionData } from "viem";
import { assertSupportedConstraints } from "../../shared/constraints.js";
import { buildApprovalIfNeeded } from "../../shared/erc20.js";
import { buildMorphoMetadata, toBigInt } from "./helpers.js";
import {
  MORPHO_BLUE_DEFAULT_MARKETS,
  type MorphoBlueAdapterConfig,
  resolveExplicitMarketId,
  resolveMarket,
} from "./markets.js";
import { preflightBorrowReadiness } from "./preflight.js";

export function createMorphoBlueAdapter(config: MorphoBlueAdapterConfig): VenueAdapter {
  const meta: VenueAdapter["meta"] = {
    name: "morpho_blue",
    supportedChains: [1, 8453],
    actions: ["lend", "withdraw", "borrow", "repay", "supply_collateral", "withdraw_collateral"],
    supportedConstraints: [],
    supportsQuote: false,
    supportsSimulation: false,
    supportsPreviewCommit: true,
    dataEndpoints: ["info", "addresses", "vaults", "markets"],
    description: "Morpho Blue adapter",
  };

  return {
    meta,
    async buildAction(action, ctx) {
      assertSupportedConstraints(meta, action);

      if (!isMorphoAction(action)) {
        throw new Error(`Unsupported Morpho Blue action: ${action.type}`);
      }

      const addresses = getChainAddresses(ctx.chainId);
      const explicitMarketId = resolveExplicitMarketId(action, ctx);
      const market = resolveMarket(config.markets, action, ctx.chainId, {
        explicitMarketId,
        isCrossChain: ctx.crossChain?.enabled === true,
        onWarning: ctx.onWarning,
      });
      const amount = toBigInt(action.amount);

      const marketParams = {
        loanToken: market.loanToken,
        collateralToken: market.collateralToken,
        oracle: market.oracle,
        irm: market.irm,
        lltv: market.lltv,
      };

      if (action.type === "borrow") {
        await preflightBorrowReadiness({
          ctx,
          market,
          marketParams,
          amount,
          mode: ctx.mode,
        });
      }

      let data: string;

      switch (action.type) {
        case "lend":
          data = encodeFunctionData({
            abi: blueAbi,
            functionName: "supply",
            args: [marketParams, amount, 0n, ctx.walletAddress, "0x"],
          });
          break;
        case "withdraw":
          data = encodeFunctionData({
            abi: blueAbi,
            functionName: "withdraw",
            args: [marketParams, amount, 0n, ctx.walletAddress, ctx.walletAddress],
          });
          break;
        case "borrow":
          data = encodeFunctionData({
            abi: blueAbi,
            functionName: "borrow",
            args: [marketParams, amount, 0n, ctx.walletAddress, ctx.walletAddress],
          });
          break;
        case "repay":
          data = encodeFunctionData({
            abi: blueAbi,
            functionName: "repay",
            args: [marketParams, amount, 0n, ctx.walletAddress, "0x"],
          });
          break;
        case "supply_collateral":
          data = encodeFunctionData({
            abi: blueAbi,
            functionName: "supplyCollateral",
            args: [marketParams, amount, ctx.walletAddress, "0x"],
          });
          break;
        case "withdraw_collateral":
          data = encodeFunctionData({
            abi: blueAbi,
            functionName: "withdrawCollateral",
            args: [marketParams, amount, ctx.walletAddress, ctx.walletAddress],
          });
          break;
        default:
          throw new Error("Unsupported Morpho Blue action");
      }

      const needsApproval =
        action.type === "lend" || action.type === "repay" || action.type === "supply_collateral";
      const approvalToken =
        action.type === "supply_collateral" ? market.collateralToken : market.loanToken;
      const approvalTxs = needsApproval
        ? await buildApprovalIfNeeded({
            ctx,
            token: approvalToken,
            spender: addresses.morpho as Address,
            amount,
            action,
            description: `Approve ${action.asset} for Morpho Blue`,
          })
        : [];

      const metadata = buildMorphoMetadata(action, market, {
        chainId: ctx.chainId,
        morphoAddress: addresses.morpho as Address,
        amount,
      });

      return [
        ...approvalTxs.map((tx) => ({
          ...tx,
          metadata: buildMorphoMetadata(action, market, {
            chainId: ctx.chainId,
            morphoAddress: addresses.morpho as Address,
            amount,
            isApproval: true,
          }),
        })),
        {
          tx: {
            to: addresses.morpho as Address,
            data,
            value: 0n,
          },
          description: `Morpho Blue ${action.type} ${action.asset}`,
          action,
          metadata,
        },
      ];
    },
  };
}

export const morphoBlueAdapter = createMorphoBlueAdapter({ markets: MORPHO_BLUE_DEFAULT_MARKETS });

export function isMorphoAction(action: Action): action is Extract<
  Action,
  {
    type: "lend" | "withdraw" | "borrow" | "repay" | "supply_collateral" | "withdraw_collateral";
  }
> {
  return [
    "lend",
    "withdraw",
    "borrow",
    "repay",
    "supply_collateral",
    "withdraw_collateral",
  ].includes(action.type);
}
