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

// Well-known Morpho Blue markets.
// Fetched from the Morpho Blue API: https://blue-api.morpho.org/graphql
export const MORPHO_BLUE_DEFAULT_MARKETS: MorphoBlueMarketConfig[] = [
  // --- Ethereum (chain 1) ---
  {
    // cbBTC/USDC — largest USDC market on Ethereum (~$411M supply)
    id: "cbbtc-usdc-1",
    chainId: 1,
    loanToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address, // USDC
    collateralToken: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf" as Address, // cbBTC
    oracle: "0xA6D6950c9F177F1De7f7757FB33539e3Ec60182a" as Address,
    irm: "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC" as Address,
    lltv: 860000000000000000n,
  },
  {
    // WBTC/USDC — (~$95M supply)
    id: "wbtc-usdc-1",
    chainId: 1,
    loanToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address, // USDC
    collateralToken: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" as Address, // WBTC
    oracle: "0xDddd770BADd886dF3864029e4B377B5F6a2B6b83" as Address,
    irm: "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC" as Address,
    lltv: 860000000000000000n,
  },
  {
    // wstETH/WETH — largest WETH market (~$91M supply)
    id: "wsteth-weth-1",
    chainId: 1,
    loanToken: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address, // WETH
    collateralToken: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0" as Address, // wstETH
    oracle: "0xbD60A6770b27E084E8617335ddE769241B0e71D8" as Address,
    irm: "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC" as Address,
    lltv: 965000000000000000n,
  },
  // --- Base (chain 8453) ---
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
  }
): MorphoBlueMarketConfig {
  const scopedMarkets = markets.filter(
    (market) => market.chainId === undefined || market.chainId === chainId
  );

  const candidateIds = scopedMarkets.map((market) => market.id);

  if (options.explicitMarketId) {
    const byId = scopedMarkets.find((market) => market.id === options.explicitMarketId);
    if (!byId) {
      throw new Error(
        `Morpho Blue market_id '${options.explicitMarketId}' not configured. Candidates: ${scopedMarkets.map((m) => m.id).join(", ")}`
      );
    }
    assertActionMatchesExplicitMarket(action, byId, chainId);
    return byId;
  }

  const crossChainPrefix = options.isCrossChain ? "cross-chain " : "";
  throw new Error(
    `Morpho Blue ${crossChainPrefix}action '${action.type}' requires explicit market_id. Candidates: ${candidateIds.join(", ") || "none"}`
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

function assertActionMatchesExplicitMarket(
  action: Action,
  market: MorphoBlueMarketConfig,
  chainId: number
): void {
  if (action.type === "supply_collateral" || action.type === "withdraw_collateral") {
    const collateralAsset = resolveAssetAddress(action.asset, chainId);
    if (collateralAsset !== market.collateralToken) {
      throw new Error(
        `Morpho Blue action '${action.type}' asset '${action.asset}' does not match collateral token for market_id '${market.id}'.`
      );
    }
    return;
  }

  if ("asset" in action) {
    const loanAsset = resolveAssetAddress(action.asset, chainId);
    if (loanAsset !== market.loanToken) {
      throw new Error(
        `Morpho Blue action '${action.type}' asset '${action.asset}' does not match loan token for market_id '${market.id}'.`
      );
    }
  }

  if (action.type === "borrow" && action.collateral) {
    const collateralAsset = resolveAssetAddress(action.collateral, chainId);
    if (collateralAsset !== market.collateralToken) {
      throw new Error(
        `Morpho Blue action '${action.type}' collateral '${action.collateral}' does not match collateral token for market_id '${market.id}'.`
      );
    }
  }
}

function resolveAssetAddress(asset?: string, chainId?: number): Address {
  if (!asset) {
    throw new Error("Asset is required for Morpho Blue action");
  }
  return resolveTokenAddress(asset, chainId ?? 1, {
    treatEthAsWrapped: true,
  });
}
