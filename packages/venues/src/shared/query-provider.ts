/**
 * Query provider helpers:
 * - createAlchemyQueryProvider: balance + price (Alchemy-backed)
 * - createCompositeQueryProvider: balance + price + adapter-backed metric surfaces
 */

import type {
  Address,
  MetricRequest,
  Provider,
  QueryProvider,
  VenueAdapter,
  VenueAlias,
} from "@grimoirelabs/core";
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

export interface CompositeQueryProviderConfig extends AlchemyQueryProviderConfig {
  adapters?: VenueAdapter[];
  venueAliases?: VenueAlias[];
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
      supportedMetrics: [],
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

/**
 * Create a venue-aware QueryProvider by composing:
 * - Alchemy query functions for balance/price
 * - Venue adapter readMetric() for protocol surfaces (e.g. apy)
 */
export function createCompositeQueryProvider(config: CompositeQueryProviderConfig): QueryProvider {
  const base = createAlchemyQueryProvider(config);
  const adapters = config.adapters ?? [];
  const aliasMap = buildVenueAliasMap(config.venueAliases ?? []);
  const metricAdapters = adapters.filter(hasReadMetric);
  const supportedMetrics = dedupe(
    metricAdapters.flatMap((adapter) => adapter.meta.metricSurfaces ?? [])
  );

  return {
    ...base,
    meta: {
      name: "composite",
      supportedQueries: [
        ...base.meta.supportedQueries,
        ...(metricAdapters.length > 0 ? (["metric"] as const) : []),
      ],
      supportedMetrics,
      description: "Alchemy balance/price + venue adapter metric surfaces",
    },
    async queryMetric(request: MetricRequest): Promise<number> {
      const venueInput = request.venue;
      const canonicalVenue = aliasMap.get(venueInput) ?? venueInput;
      const adapter = metricAdapters.find((candidate) => candidate.meta.name === canonicalVenue);
      if (!adapter?.readMetric) {
        throw new Error(
          `Metric '${request.surface}' not available for venue '${venueInput}' (resolved '${canonicalVenue}')`
        );
      }

      if (
        adapter.meta.metricSurfaces &&
        adapter.meta.metricSurfaces.length > 0 &&
        !adapter.meta.metricSurfaces.includes(request.surface)
      ) {
        throw new Error(
          `Venue '${canonicalVenue}' does not expose metric surface '${request.surface}'`
        );
      }

      return adapter.readMetric(
        {
          ...request,
          venue: canonicalVenue,
        },
        {
          provider: config.provider,
          walletAddress: config.vault,
          chainId: config.chainId,
          vault: config.vault,
        }
      );
    },
  };
}

function hasReadMetric(
  adapter: VenueAdapter
): adapter is VenueAdapter & { readMetric: NonNullable<VenueAdapter["readMetric"]> } {
  return typeof adapter.readMetric === "function";
}

function buildVenueAliasMap(aliases: VenueAlias[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const alias of aliases) {
    map.set(alias.alias, alias.alias);
    if (alias.label && !map.has(alias.label)) {
      map.set(alias.label, alias.alias);
    }
  }
  return map;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
