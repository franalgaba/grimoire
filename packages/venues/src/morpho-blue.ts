import type { Action, Address, VenueAdapter, VenueBuildMetadata } from "@grimoirelabs/core";
import { getChainAddresses } from "@morpho-org/blue-sdk";
import { blueAbi } from "@morpho-org/blue-sdk-viem";
import { encodeFunctionData } from "viem";
import { assertSupportedConstraints } from "./constraints.js";
import { buildApprovalIfNeeded } from "./erc20.js";
import { resolveTokenAddress } from "./token-registry.js";

export interface MorphoBlueMarketConfig {
  id: string;
  loanToken: Address;
  collateralToken: Address;
  oracle: Address;
  irm: Address;
  lltv: bigint;
}

export interface MorphoBlueAdapterConfig {
  markets: MorphoBlueMarketConfig[];
}

export function createMorphoBlueAdapter(config: MorphoBlueAdapterConfig): VenueAdapter {
  const meta: VenueAdapter["meta"] = {
    name: "morpho_blue",
    supportedChains: [1, 8453],
    actions: ["lend", "withdraw", "borrow", "repay"],
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
        default:
          throw new Error("Unsupported Morpho Blue action");
      }

      const needsApproval = action.type === "lend" || action.type === "repay";
      const approvalTxs = needsApproval
        ? await buildApprovalIfNeeded({
            ctx,
            token: market.loanToken,
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

// Well-known Morpho Blue markets on Base (chain 8453).
// Fetched from the Morpho Blue API: https://blue-api.morpho.org/graphql
const DEFAULT_BASE_MARKETS: MorphoBlueMarketConfig[] = [
  {
    // cbBTC/USDC — largest USDC market on Base (~$1.26B supply)
    id: "cbbtc-usdc-86",
    loanToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address,
    collateralToken: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf" as Address,
    oracle: "0x663BECd10daE6C4A3Dcd89F1d76c1174199639B9" as Address,
    irm: "0x46415998764C29aB2a25CbeA6254146D50D22687" as Address,
    lltv: 860000000000000000n,
  },
  {
    // WETH/USDC — second largest (~$48.7M supply)
    id: "weth-usdc-86",
    loanToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address,
    collateralToken: "0x4200000000000000000000000000000000000006" as Address,
    oracle: "0xFEa2D58cEfCb9fcb597723c6bAE66fFE4193aFE4" as Address,
    irm: "0x46415998764C29aB2a25CbeA6254146D50D22687" as Address,
    lltv: 860000000000000000n,
  },
];

export const morphoBlueAdapter = createMorphoBlueAdapter({ markets: DEFAULT_BASE_MARKETS });

function isMorphoAction(
  action: Action
): action is Extract<Action, { type: "lend" | "withdraw" | "borrow" | "repay" }> {
  return ["lend", "withdraw", "borrow", "repay"].includes(action.type);
}

function resolveMarket(
  markets: MorphoBlueMarketConfig[],
  action: Action,
  chainId: number,
  options: {
    explicitMarketId?: string;
    isCrossChain: boolean;
    onWarning?: (message: string) => void;
  }
): MorphoBlueMarketConfig {
  if (options.explicitMarketId) {
    const byId = markets.find((market) => market.id === options.explicitMarketId);
    if (!byId) {
      throw new Error(
        `Morpho Blue market_id '${options.explicitMarketId}' not configured. Candidates: ${markets.map((m) => m.id).join(", ")}`
      );
    }
    return byId;
  }

  const loanToken = resolveAssetAddress("asset" in action ? action.asset : undefined, chainId);
  const collateral =
    "collateral" in action && action.collateral
      ? resolveAssetAddress(action.collateral, chainId)
      : undefined;

  const matches = markets.filter((market) => market.loanToken === loanToken);
  if (collateral) {
    const match = matches.find((market) => market.collateralToken === collateral);
    if (match) return match;
  }

  if (options.isCrossChain) {
    const candidateIds = matches.map((market) => market.id);
    throw new Error(
      `Morpho Blue cross-chain action '${action.type}' requires explicit market_id. Candidates: ${candidateIds.join(", ") || "none"}`
    );
  }

  if (matches.length > 0) {
    options.onWarning?.(
      `Morpho Blue action '${action.type}' is using implicit market selection. Set explicit market_id to avoid ambiguity.`
    );
    const first = matches[0];
    if (first) return first;
  }

  throw new Error(
    `Morpho Blue market not configured for asset ${
      "asset" in action ? action.asset : "unknown"
    } on chain ${chainId}`
  );
}

function resolveExplicitMarketId(
  action: Action,
  ctx: Parameters<NonNullable<VenueAdapter["buildAction"]>>[1]
): string | undefined {
  if ("marketId" in action && typeof action.marketId === "string" && action.marketId.length > 0) {
    return action.marketId;
  }
  const actionRef = ctx.crossChain?.actionRef;
  if (!actionRef) {
    return undefined;
  }
  return ctx.crossChain?.morphoMarketIds?.[actionRef];
}

function resolveAssetAddress(asset?: string, chainId?: number): Address {
  if (!asset) {
    throw new Error("Asset is required for Morpho Blue action");
  }
  return resolveTokenAddress(asset, chainId ?? 1, {
    treatEthAsWrapped: true,
  });
}

function toBigInt(amount: unknown): bigint {
  if (amount === "max") {
    throw new Error("Morpho adapter requires explicit amount");
  }
  if (typeof amount === "bigint") return amount;
  if (typeof amount === "number") return BigInt(Math.floor(amount));
  if (typeof amount === "string") return BigInt(amount);
  if (isLiteralAmount(amount)) {
    return BigInt(amount.value);
  }
  throw new Error("Unsupported amount type for Morpho action");
}

function isLiteralAmount(
  value: unknown
): value is { kind: "literal"; value: string | number | bigint } {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    (value as { kind?: unknown }).kind === "literal" &&
    "value" in value
  );
}

function buildMorphoMetadata(
  action: Extract<Action, { type: "lend" | "withdraw" | "borrow" | "repay" }>,
  market: MorphoBlueMarketConfig,
  options: {
    chainId: number;
    morphoAddress: Address;
    amount: bigint;
    isApproval?: boolean;
  }
): VenueBuildMetadata {
  const quote =
    action.type === "borrow" || action.type === "withdraw"
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
