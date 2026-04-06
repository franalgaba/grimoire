import { createRequire } from "node:module";
import type { Address } from "@grimoirelabs/core";

export interface TokenRecord {
  symbol: string;
  address: Address;
  decimals: number;
}

const require = createRequire(import.meta.url);
const tokenList = require("@uniswap/default-token-list") as {
  tokens: Array<{
    chainId: number;
    symbol: string;
    address: string;
    decimals: number;
    extensions?: {
      bridgeInfo?: Record<string, { tokenAddress: string }>;
    };
  }>;
};

const SHARED_TOKENS: Record<number, Record<string, TokenRecord>> = {
  1: {
    USDC: {
      symbol: "USDC",
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
      decimals: 6,
    },
    USDT: {
      symbol: "USDT",
      address: "0xdAC17F958D2ee523a2206206994597C13D831ec7" as Address,
      decimals: 6,
    },
    DAI: {
      symbol: "DAI",
      address: "0x6B175474E89094C44Da98b954EedeAC495271d0F" as Address,
      decimals: 18,
    },
    WETH: {
      symbol: "WETH",
      address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address,
      decimals: 18,
    },
    WSTETH: {
      symbol: "WSTETH",
      address: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0" as Address,
      decimals: 18,
    },
  },
  10: {
    USDC: {
      symbol: "USDC",
      address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" as Address,
      decimals: 6,
    },
    WETH: {
      symbol: "WETH",
      address: "0x4200000000000000000000000000000000000006" as Address,
      decimals: 18,
    },
  },
  137: {
    WETH: {
      symbol: "WETH",
      address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619" as Address,
      decimals: 18,
    },
  },
  42161: {
    USDC: {
      symbol: "USDC",
      address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as Address,
      decimals: 6,
    },
    WETH: {
      symbol: "WETH",
      address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1" as Address,
      decimals: 18,
    },
  },
  8453: {
    USDC: {
      symbol: "USDC",
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address,
      decimals: 6,
    },
    WETH: {
      symbol: "WETH",
      address: "0x4200000000000000000000000000000000000006" as Address,
      decimals: 18,
    },
    CBBTC: {
      symbol: "CBBTC",
      address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf" as Address,
      decimals: 8,
    },
  },
};

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

const TOKEN_INDEX = new Map<string, TokenRecord>();
const BRIDGE_INDEX = new Map<string, Address>();
const REVERSE_INDEX = new Map<string, TokenRecord>();

// Populate from Uniswap default token list
for (const token of tokenList.tokens) {
  const symbol = normalizeSymbol(token.symbol);
  const record: TokenRecord = {
    symbol,
    address: token.address as Address,
    decimals: token.decimals,
  };

  TOKEN_INDEX.set(makeKey(symbol, token.chainId), record);
  REVERSE_INDEX.set(makeReverseKey(token.address, token.chainId), record);

  // Build bridge index from extensions.bridgeInfo
  const bridgeInfo = token.extensions?.bridgeInfo;
  if (bridgeInfo) {
    for (const [toChainIdStr, info] of Object.entries(bridgeInfo)) {
      const toChainId = Number.parseInt(toChainIdStr, 10);
      BRIDGE_INDEX.set(
        makeBridgeKey(symbol, token.chainId, toChainId),
        info.tokenAddress as Address
      );
    }
  }
}

// SHARED_TOKENS overlay — wins over Uniswap list
for (const [chainIdText, chainTokens] of Object.entries(SHARED_TOKENS)) {
  const chainId = Number.parseInt(chainIdText, 10);
  for (const [symbol, token] of Object.entries(chainTokens)) {
    TOKEN_INDEX.set(makeKey(symbol, chainId), token);
    REVERSE_INDEX.set(makeReverseKey(token.address, chainId), token);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ResolveTokenOptions {
  defaultDecimals?: number;
  treatEthAsWrapped?: boolean;
}

export function isAddressLike(asset: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(asset);
}

export function resolveWrappedNativeAddress(chainId: number): Address {
  const wrapped = TOKEN_INDEX.get(makeKey("WETH", chainId));
  if (!wrapped) {
    throw new Error(`No WETH address for chain ${chainId}`);
  }
  return wrapped.address;
}

export function tryResolveToken(symbol: string, chainId: number): TokenRecord | undefined {
  return TOKEN_INDEX.get(makeKey(symbol, chainId));
}

export function resolveToken(
  asset: string,
  chainId: number,
  options: ResolveTokenOptions = {}
): TokenRecord {
  if (isAddressLike(asset)) {
    return {
      symbol: normalizeSymbol(asset),
      address: asset as Address,
      decimals: options.defaultDecimals ?? 18,
    };
  }

  const symbol = normalizeSymbol(asset);
  const treatEthAsWrapped = options.treatEthAsWrapped ?? true;
  if (symbol === "ETH" && treatEthAsWrapped) {
    return {
      symbol: "WETH",
      address: resolveWrappedNativeAddress(chainId),
      decimals: 18,
    };
  }

  const token = tryResolveToken(symbol, chainId);
  if (!token) {
    throw new Error(`Unknown asset: ${asset} on chain ${chainId}. Provide address directly.`);
  }

  return token;
}

export function resolveTokenAddress(
  asset: string,
  chainId: number,
  options: ResolveTokenOptions = {}
): Address {
  return resolveToken(asset, chainId, options).address;
}

export function resolveTokenDecimals(
  asset: string,
  chainId: number,
  options: ResolveTokenOptions = {}
): number {
  return resolveToken(asset, chainId, options).decimals;
}

/**
 * Resolve bridged token address using the Uniswap token list's bridgeInfo.
 * Returns the address of `symbol` on `toChainId` when bridging from `fromChainId`.
 */
export function resolveBridgedTokenAddress(
  symbol: string,
  fromChainId: number,
  toChainId: number
): Address | undefined {
  return BRIDGE_INDEX.get(makeBridgeKey(normalizeSymbol(symbol), fromChainId, toChainId));
}

/**
 * Reverse lookup: find a token record by on-chain address + chainId.
 * Case-insensitive on the address.
 */
export function tryResolveTokenByAddress(
  address: string,
  chainId: number
): TokenRecord | undefined {
  return REVERSE_INDEX.get(makeReverseKey(address, chainId));
}

/**
 * Register a token at runtime. Additive-only: does NOT overwrite existing entries.
 */
export function registerToken(chainId: number, token: TokenRecord): void {
  const key = makeKey(token.symbol, chainId);
  if (!TOKEN_INDEX.has(key)) {
    TOKEN_INDEX.set(key, token);
  }
  const revKey = makeReverseKey(token.address, chainId);
  if (!REVERSE_INDEX.has(revKey)) {
    REVERSE_INDEX.set(revKey, token);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeKey(symbol: string, chainId: number): string {
  return `${normalizeSymbol(symbol)}:${chainId}`;
}

function makeBridgeKey(symbol: string, fromChainId: number, toChainId: number): string {
  return `${symbol}:${fromChainId}:${toChainId}`;
}

function makeReverseKey(address: string, chainId: number): string {
  return `${address.toLowerCase()}:${chainId}`;
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

export function safeResolveTokenDecimals(asset: string, chainId: number, fallback: number): number {
  try {
    return resolveTokenDecimals(asset, chainId, {
      defaultDecimals: fallback,
      treatEthAsWrapped: true,
    });
  } catch {
    return fallback;
  }
}
