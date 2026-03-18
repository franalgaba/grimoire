import type { VenueAdapter } from "@grimoirelabs/core";

export { discoverBuiltinVenues } from "./shared/discovery.js";
export {
  type AlchemyQueryProviderConfig,
  createAlchemyQueryProvider,
  extractAlchemyKey,
} from "./shared/query-provider.js";

import { aaveV3Adapter, createAaveV3Adapter } from "./adapters/aave-v3.js";
import { acrossAdapter, createAcrossAdapter } from "./adapters/across.js";
import { createHyperliquidAdapter, hyperliquidAdapter } from "./adapters/hyperliquid.js";
import {
  createMorphoBlueAdapter,
  getMorphoBlueMarketId,
  isMorphoAction,
  MORPHO_BLUE_DEFAULT_MARKETS,
  morphoBlueAdapter,
} from "./adapters/morpho-blue/index.js";
import {
  createPendleAdapter,
  isSupportedPendleAction,
  pendleAdapter,
} from "./adapters/pendle/index.js";
import { createPolymarketAdapter, polymarketAdapter } from "./adapters/polymarket/index.js";
import {
  createUniswapV3Adapter,
  defaultUniswapV3Routers,
  uniswapV3Adapter,
} from "./adapters/uniswap-v3.js";
import {
  createUniswapV4Adapter,
  DEFAULT_ROUTERS as defaultUniswapV4Routers,
  uniswapV4Adapter,
} from "./adapters/uniswap-v4/index.js";

export const adapters: VenueAdapter[] = [
  aaveV3Adapter,
  uniswapV3Adapter,
  uniswapV4Adapter,
  morphoBlueAdapter,
  hyperliquidAdapter,
  acrossAdapter,
  pendleAdapter,
  polymarketAdapter,
];

export {
  aaveV3Adapter,
  createAaveV3Adapter,
  acrossAdapter,
  createAcrossAdapter,
  uniswapV3Adapter,
  createUniswapV3Adapter,
  defaultUniswapV3Routers,
  uniswapV4Adapter,
  createUniswapV4Adapter,
  defaultUniswapV4Routers,
  morphoBlueAdapter,
  createMorphoBlueAdapter,
  MORPHO_BLUE_DEFAULT_MARKETS,
  getMorphoBlueMarketId,
  hyperliquidAdapter,
  createHyperliquidAdapter,
  pendleAdapter,
  createPendleAdapter,
  isSupportedPendleAction,
  polymarketAdapter,
  createPolymarketAdapter,
  isMorphoAction,
};
