import type { VenueAdapter } from "@grimoirelabs/core";

export {
  type AlchemyQueryProviderConfig,
  createAlchemyQueryProvider,
  extractAlchemyKey,
} from "./query-provider.js";

import { aaveV3Adapter, createAaveV3Adapter } from "./aave-v3.js";
import { acrossAdapter, createAcrossAdapter } from "./across.js";
import { createHyperliquidAdapter, hyperliquidAdapter } from "./hyperliquid.js";
import {
  createMorphoBlueAdapter,
  getMorphoBlueMarketId,
  MORPHO_BLUE_DEFAULT_MARKETS,
  morphoBlueAdapter,
} from "./morpho-blue.js";
import { createPendleAdapter, pendleAdapter } from "./pendle.js";
import { createPolymarketAdapter, polymarketAdapter } from "./polymarket.js";
import { createUniswapV3Adapter, defaultUniswapV3Routers, uniswapV3Adapter } from "./uniswap-v3.js";
import {
  createUniswapV4Adapter,
  DEFAULT_ROUTERS as defaultUniswapV4Routers,
  uniswapV4Adapter,
} from "./uniswap-v4.js";

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
  polymarketAdapter,
  createPolymarketAdapter,
};
