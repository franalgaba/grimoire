import type { Action, Address, VenueAdapter } from "@grimoirelabs/core";
import { getChainAddresses } from "@morpho-org/blue-sdk";
import { blueAbi, MetaMorphoAction } from "@morpho-org/blue-sdk-viem";
import { encodeFunctionData } from "viem";
import { assertSupportedConstraints } from "../../shared/constraints.js";
import { buildApprovalIfNeeded } from "../../shared/erc20.js";
import { resolveTokenAddress } from "../../shared/token-registry.js";
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
    actions: [
      "lend",
      "withdraw",
      "borrow",
      "repay",
      "supply_collateral",
      "withdraw_collateral",
      "vault_deposit",
      "vault_withdraw",
    ],
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

      // Handle vault_deposit / vault_withdraw (ERC4626 MetaMorpho vaults)
      if (action.type === "vault_deposit" || action.type === "vault_withdraw") {
        return buildVaultAction(
          action as Extract<Action, { type: "vault_deposit" | "vault_withdraw" }>,
          ctx
        );
      }

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

async function buildVaultAction(
  action: Extract<Action, { type: "vault_deposit" | "vault_withdraw" }>,
  ctx: Parameters<NonNullable<VenueAdapter["buildAction"]>>[1]
) {
  if (!("vault" in action) || typeof action.vault !== "string" || !action.vault.startsWith("0x")) {
    throw new Error("vault_deposit/vault_withdraw requires an explicit vault address");
  }

  const vaultAddress = action.vault as Address;
  const amount = toBigInt(action.amount);
  const ZERO = "0x0000000000000000000000000000000000000000" as Address;
  const receiver = ctx.vault && ctx.vault !== ZERO ? ctx.vault : ctx.walletAddress;

  if (action.type === "vault_deposit") {
    const assetAddress = resolveTokenAddress(action.asset, ctx.chainId, {
      treatEthAsWrapped: true,
    });

    const approvalTxs = await buildApprovalIfNeeded({
      ctx,
      token: assetAddress,
      spender: vaultAddress,
      amount,
      action,
      description: `Approve ${action.asset} for MetaMorpho vault`,
    });

    const data = MetaMorphoAction.deposit(amount, receiver);

    return [
      ...approvalTxs,
      {
        tx: {
          to: vaultAddress,
          data,
          value: 0n,
        },
        description: `MetaMorpho vault_deposit ${action.asset} into ${vaultAddress}`,
        action,
        metadata: {
          quote: { expectedIn: amount },
          route: {
            vaultAddress,
            asset: action.asset,
            receiver,
          },
        },
      },
    ];
  }

  // vault_withdraw
  const data = MetaMorphoAction.withdraw(amount, receiver, ctx.walletAddress as Address);

  return [
    {
      tx: {
        to: vaultAddress,
        data,
        value: 0n,
      },
      description: `MetaMorpho vault_withdraw ${action.asset} from ${vaultAddress}`,
      action,
      metadata: {
        quote: { expectedOut: amount },
        route: {
          vaultAddress,
          asset: action.asset,
          receiver,
          owner: ctx.walletAddress,
        },
      },
    },
  ];
}

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
