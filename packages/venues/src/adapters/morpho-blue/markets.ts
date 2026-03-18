import type { Action, Address, VenueAdapter } from "@grimoirelabs/core";
import { MarketUtils } from "@morpho-org/blue-sdk";
import { resolveTokenAddress } from "../../shared/token-registry.js";

export interface MorphoBlueMarketConfig {
  id: string;
  chainId?: number;
  loanToken: Address;
  collateralToken: Address;
  oracle: Address;
  irm: Address;
  lltv: bigint;
}

export interface MorphoBlueAdapterConfig {
  markets: MorphoBlueMarketConfig[];
}

// Well-known Morpho Blue markets on Base (chain 8453).
// Fetched from the Morpho Blue API: https://blue-api.morpho.org/graphql
export const MORPHO_BLUE_DEFAULT_MARKETS: MorphoBlueMarketConfig[] = [
  {
    // cbBTC/USDC — largest USDC market on Base (~$1.26B supply)
    id: "cbbtc-usdc-86",
    chainId: 8453,
    loanToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address,
    collateralToken: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf" as Address,
    oracle: "0x663BECd10daE6C4A3Dcd89F1d76c1174199639B9" as Address,
    irm: "0x46415998764C29aB2a25CbeA6254146D50D22687" as Address,
    lltv: 860000000000000000n,
  },
  {
    // WETH/USDC — second largest (~$48.7M supply)
    id: "weth-usdc-86",
    chainId: 8453,
    loanToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address,
    collateralToken: "0x4200000000000000000000000000000000000006" as Address,
    oracle: "0xFEa2D58cEfCb9fcb597723c6bAE66fFE4193aFE4" as Address,
    irm: "0x46415998764C29aB2a25CbeA6254146D50D22687" as Address,
    lltv: 860000000000000000n,
  },
];

export function getMorphoBlueMarketId(market: {
  loanToken: Address;
  collateralToken: Address;
  oracle: Address;
  irm: Address;
  lltv: bigint;
}): `0x${string}` {
  return MarketUtils.getMarketId(market) as `0x${string}`;
}

export function resolveMarket(
  markets: MorphoBlueMarketConfig[],
  action: Action,
  chainId: number,
  options: {
    explicitMarketId?: string;
    isCrossChain: boolean;
    onWarning?: (message: string) => void;
  }
): MorphoBlueMarketConfig {
  const scopedMarkets = markets.filter(
    (market) => market.chainId === undefined || market.chainId === chainId
  );

  if (options.explicitMarketId) {
    const byId = scopedMarkets.find((market) => market.id === options.explicitMarketId);
    if (!byId) {
      throw new Error(
        `Morpho Blue market_id '${options.explicitMarketId}' not configured. Candidates: ${scopedMarkets.map((m) => m.id).join(", ")}`
      );
    }
    return byId;
  }

  if (action.type === "supply_collateral" || action.type === "withdraw_collateral") {
    const collateralToken = resolveAssetAddress(action.asset, chainId);
    const matches = scopedMarkets.filter((market) => market.collateralToken === collateralToken);

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
      `Morpho Blue market not configured for collateral asset ${action.asset} on chain ${chainId}`
    );
  }

  const loanToken = resolveAssetAddress("asset" in action ? action.asset : undefined, chainId);
  const collateral =
    "collateral" in action && action.collateral
      ? resolveAssetAddress(action.collateral, chainId)
      : undefined;

  const matches = scopedMarkets.filter((market) => market.loanToken === loanToken);
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

export function resolveExplicitMarketId(
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
