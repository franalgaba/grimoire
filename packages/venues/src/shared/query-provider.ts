/**
 * Alchemy-backed QueryProvider
 *
 * Provides:
 * - queryBalance: on-chain ERC20.balanceOf() via the RPC provider
 * - queryPrice: Alchemy Token Prices API (requires Alchemy API key)
 *
 * The Alchemy API key is extracted automatically from the RPC URL
 * (pattern: https://{network}.g.alchemy.com/v2/{key}), so no extra
 * CLI flags are needed.
 */

import type { Address, Provider, QueryProvider } from "@grimoirelabs/core";
import { resolveTokenAddress } from "./token-registry.js";

const ERC20_BALANCE_ABI: import("viem").Abi = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
];

export interface AlchemyQueryProviderConfig {
  provider: Provider;
  chainId: number;
  vault: Address;
  /** Explicit Alchemy API key — or extracted from rpcUrl */
  alchemyApiKey?: string;
  /** Used to extract API key if alchemyApiKey is not set */
  rpcUrl?: string;
}

/**
 * Extract the Alchemy API key from an Alchemy RPC URL.
 * Matches `https://{network}.g.alchemy.com/v2/{key}`.
 */
export function extractAlchemyKey(rpcUrl?: string): string | undefined {
  if (!rpcUrl) return undefined;
  const match = rpcUrl.match(/g\.alchemy\.com\/v2\/([a-zA-Z0-9_-]+)/);
  return match?.[1];
}

/**
 * Create an Alchemy-backed QueryProvider.
 *
 * - `queryBalance` always works (on-chain via RPC provider)
 * - `queryPrice` requires an Alchemy API key (extracted from rpcUrl or explicit)
 */
export function createAlchemyQueryProvider(config: AlchemyQueryProviderConfig): QueryProvider {
  const { provider, chainId, vault } = config;
  const apiKey = config.alchemyApiKey ?? extractAlchemyKey(config.rpcUrl);

  return {
    meta: {
      name: "alchemy",
      supportedQueries: ["balance", ...(apiKey ? (["price"] as const) : [])],
    },

    async queryBalance(asset: string, address?: string): Promise<bigint> {
      const target = (address ?? vault) as Address;
      if (asset.toUpperCase() === "ETH") {
        return provider.getBalance(target);
      }
      const tokenAddress = resolveTokenAddress(asset, chainId);
      return provider.readContract<bigint>({
        address: tokenAddress,
        abi: ERC20_BALANCE_ABI,
        functionName: "balanceOf",
        args: [target],
      });
    },

    async queryPrice(base: string, quote: string, _source?: string): Promise<number> {
      if (!apiKey) {
        throw new Error("Price queries require an Alchemy API key (use an Alchemy RPC URL)");
      }
      const symbols = base === quote ? [base] : [base, quote];
      const params = symbols.map((s) => `symbols=${encodeURIComponent(s)}`).join("&");
      const url = `https://api.g.alchemy.com/prices/v1/tokens/by-symbol?${params}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        throw new Error(`Alchemy price API error: ${res.status} ${res.statusText}`);
      }
      const json = (await res.json()) as {
        data: Array<{
          symbol: string;
          prices: Array<{ currency: string; value: string }>;
        }>;
      };

      const prices = new Map<string, number>();
      for (const entry of json.data) {
        const usdPrice = entry.prices?.find((p) => p.currency.toUpperCase() === "USD");
        if (usdPrice) prices.set(entry.symbol.toUpperCase(), Number.parseFloat(usdPrice.value));
      }

      const basePrice = prices.get(base.toUpperCase());
      if (!basePrice) throw new Error(`No price data for ${base}`);

      // USD-denominated stablecoins
      const quoteUpper = quote.toUpperCase();
      if (quoteUpper === "USD" || quoteUpper === "USDC" || quoteUpper === "USDT") {
        return basePrice;
      }

      const quotePrice = prices.get(quoteUpper);
      if (!quotePrice) throw new Error(`No price data for ${quote}`);
      return basePrice / quotePrice;
    },
  };
}
