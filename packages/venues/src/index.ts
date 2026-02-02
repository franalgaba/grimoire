import type { VenueAdapter } from "@grimoire/core";
import { aaveV3Adapter, createAaveV3Adapter } from "./aave-v3.js";
import { acrossAdapter, createAcrossAdapter } from "./across.js";
import { createHyperliquidAdapter, hyperliquidAdapter } from "./hyperliquid.js";
import { createMorphoBlueAdapter, morphoBlueAdapter } from "./morpho-blue.js";
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
  hyperliquidAdapter,
  createHyperliquidAdapter,
};
