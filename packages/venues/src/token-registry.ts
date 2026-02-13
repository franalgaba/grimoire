import { createRequire } from "node:module";
import type { Address } from "@grimoirelabs/core";

interface TokenRecord {
  symbol: string;
  address: Address;
  decimals: number;
}

const require = createRequire(import.meta.url);
const tokenList = require("@uniswap/default-token-list") as {
  tokens: Array<{ chainId: number; symbol: string; address: string; decimals: number }>;
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

const TOKEN_INDEX = new Map<string, TokenRecord>();

for (const token of tokenList.tokens) {
  const key = makeKey(token.symbol, token.chainId);
  TOKEN_INDEX.set(key, {
    symbol: normalizeSymbol(token.symbol),
    address: token.address as Address,
    decimals: token.decimals,
  });
}

for (const [chainIdText, chainTokens] of Object.entries(SHARED_TOKENS)) {
  const chainId = Number.parseInt(chainIdText, 10);
  for (const [symbol, token] of Object.entries(chainTokens)) {
    TOKEN_INDEX.set(makeKey(symbol, chainId), token);
  }
}

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

function makeKey(symbol: string, chainId: number): string {
  return `${normalizeSymbol(symbol)}:${chainId}`;
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}
