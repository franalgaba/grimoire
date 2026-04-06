import type {
  Action,
  Address,
  MetricRequest,
  VenueAdapter,
  VenueAdapterContext,
} from "@grimoirelabs/core";
import { getChainAddresses } from "@morpho-org/blue-sdk";
import { blueAbi, MetaMorphoAction } from "@morpho-org/blue-sdk-viem";
import { encodeFunctionData } from "viem";
import {
  assertSupportedConstraints,
  assertSupportedMetricSurface,
} from "../../shared/constraints.js";
import { buildApprovalIfNeeded } from "../../shared/erc20.js";
import {
  normalizeApyToBps,
  parseMetricSelector,
  readMetricSelectorString,
} from "../../shared/metric-selector.js";
import { resolveTokenAddress } from "../../shared/token-registry.js";
import { buildMorphoMetadata, toBigInt } from "./helpers.js";
import {
  getMorphoBlueMarketId,
  MORPHO_BLUE_DEFAULT_MARKETS,
  type MorphoBlueAdapterConfig,
  resolveExplicitMarketId,
  resolveMarket,
} from "./markets.js";
import { preflightBorrowReadiness } from "./preflight.js";

const MORPHO_GRAPHQL_ENDPOINT = "https://blue-api.morpho.org/graphql" as const;

export function createMorphoBlueAdapter(config: MorphoBlueAdapterConfig): VenueAdapter {
  const meta: VenueAdapter["meta"] = {
    name: "morpho_blue",
    supportedChains: [1, 8453],
    actions: [
      "lend",
      "withdraw",
      "borrow",
      "repay",
      "supply_collateral",
      "withdraw_collateral",
      "vault_deposit",
      "vault_withdraw",
    ],
    supportedConstraints: [],
    supportsQuote: false,
    supportsSimulation: false,
    supportsPreviewCommit: true,
    metricSurfaces: ["apy", "vault_apy", "vault_net_apy"],
    dataEndpoints: ["info", "addresses", "vaults", "markets"],
    description: "Morpho Blue adapter",
  };

  return {
    meta,
    async readMetric(request: MetricRequest, ctx: VenueAdapterContext): Promise<number> {
      assertSupportedMetricSurface(meta, request);

      if (request.surface === "vault_apy" || request.surface === "vault_net_apy") {
        const vaultSelector = resolveMetricVaultSelector(request.selector);
        return await fetchMorphoVaultApyBps({
          chainId: ctx.chainId,
          asset: request.asset,
          selector: vaultSelector,
          useNetApy: request.surface === "vault_net_apy",
        });
      }

      const scopedMarkets = config.markets.filter(
        (market) => market.chainId === undefined || market.chainId === ctx.chainId
      );
      const marketId = resolveMetricMarketId(request.selector, scopedMarkets);
      return await fetchMorphoApyBps({
        chainId: ctx.chainId,
        asset: request.asset,
        marketId,
      });
    },
    async buildAction(action, ctx) {
      assertSupportedConstraints(meta, action);

      // Handle vault_deposit / vault_withdraw (ERC4626 MetaMorpho vaults)
      if (action.type === "vault_deposit" || action.type === "vault_withdraw") {
        return buildVaultAction(
          action as Extract<Action, { type: "vault_deposit" | "vault_withdraw" }>,
          ctx
        );
      }

      if (!isMorphoAction(action)) {
        throw new Error(`Unsupported Morpho Blue action: ${action.type}`);
      }

      const addresses = getChainAddresses(ctx.chainId);
      const explicitMarketId = resolveExplicitMarketId(action, ctx);
      const market = resolveMarket(config.markets, action, ctx.chainId, {
        explicitMarketId,
        isCrossChain: ctx.crossChain?.enabled === true,
      });
      const amount = toBigInt(action.amount);

      const marketParams = {
        loanToken: market.loanToken,
        collateralToken: market.collateralToken,
        oracle: market.oracle,
        irm: market.irm,
        lltv: market.lltv,
      };

      if (action.type === "borrow") {
        await preflightBorrowReadiness({
          ctx,
          market,
          marketParams,
          amount,
          mode: ctx.mode,
        });
      }

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
        case "supply_collateral":
          data = encodeFunctionData({
            abi: blueAbi,
            functionName: "supplyCollateral",
            args: [marketParams, amount, ctx.walletAddress, "0x"],
          });
          break;
        case "withdraw_collateral":
          data = encodeFunctionData({
            abi: blueAbi,
            functionName: "withdrawCollateral",
            args: [marketParams, amount, ctx.walletAddress, ctx.walletAddress],
          });
          break;
        default:
          throw new Error("Unsupported Morpho Blue action");
      }

      const needsApproval =
        action.type === "lend" || action.type === "repay" || action.type === "supply_collateral";
      const approvalToken =
        action.type === "supply_collateral" ? market.collateralToken : market.loanToken;
      const approvalTxs = needsApproval
        ? await buildApprovalIfNeeded({
            ctx,
            token: approvalToken,
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

export const morphoBlueAdapter = createMorphoBlueAdapter({ markets: MORPHO_BLUE_DEFAULT_MARKETS });

async function buildVaultAction(
  action: Extract<Action, { type: "vault_deposit" | "vault_withdraw" }>,
  ctx: Parameters<NonNullable<VenueAdapter["buildAction"]>>[1]
) {
  if (!("vault" in action) || typeof action.vault !== "string" || !action.vault.startsWith("0x")) {
    throw new Error("vault_deposit/vault_withdraw requires an explicit vault address");
  }

  const vaultAddress = action.vault as Address;
  const amount = toBigInt(action.amount);
  const ZERO = "0x0000000000000000000000000000000000000000" as Address;
  const receiver = ctx.vault && ctx.vault !== ZERO ? ctx.vault : ctx.walletAddress;

  if (action.type === "vault_deposit") {
    const assetAddress = resolveTokenAddress(action.asset, ctx.chainId, {
      treatEthAsWrapped: true,
    });

    const approvalTxs = await buildApprovalIfNeeded({
      ctx,
      token: assetAddress,
      spender: vaultAddress,
      amount,
      action,
      description: `Approve ${action.asset} for MetaMorpho vault`,
    });

    const data = MetaMorphoAction.deposit(amount, receiver);

    return [
      ...approvalTxs,
      {
        tx: {
          to: vaultAddress,
          data,
          value: 0n,
        },
        description: `MetaMorpho vault_deposit ${action.asset} into ${vaultAddress}`,
        action,
        metadata: {
          quote: { expectedIn: amount },
          route: {
            vaultAddress,
            asset: action.asset,
            receiver,
          },
        },
      },
    ];
  }

  // vault_withdraw
  const data = MetaMorphoAction.withdraw(amount, receiver, ctx.walletAddress as Address);

  return [
    {
      tx: {
        to: vaultAddress,
        data,
        value: 0n,
      },
      description: `MetaMorpho vault_withdraw ${action.asset} from ${vaultAddress}`,
      action,
      metadata: {
        quote: { expectedOut: amount },
        route: {
          vaultAddress,
          asset: action.asset,
          receiver,
          owner: ctx.walletAddress,
        },
      },
    },
  ];
}

function resolveMetricMarketId(
  selector: string | undefined,
  markets: MorphoBlueAdapterConfig["markets"]
): string | undefined {
  if (!selector) {
    return undefined;
  }
  if (selector.startsWith("0x")) {
    return selector.toLowerCase();
  }

  const byConfigId = markets.find((market) => market.id === selector);
  if (!byConfigId) {
    throw new Error(`Morpho Blue market selector '${selector}' not found in configured markets`);
  }
  return getMorphoBlueMarketId(byConfigId).toLowerCase();
}

function resolveMetricVaultSelector(selector: string | undefined): string {
  if (!selector) {
    throw new Error(
      "Morpho Blue vault APY metrics require explicit vault selector (vault address/name/symbol)"
    );
  }
  if (selector.startsWith("0x")) {
    return selector.toLowerCase();
  }

  const parsed = parseMetricSelector(selector);
  if (Object.keys(parsed).length === 0) {
    return selector.toLowerCase();
  }

  const candidate = readMetricSelectorString(
    parsed,
    ["vault", "vault_address", "address", "id", "name", "symbol"],
    { label: "vault", required: true }
  );
  if (!candidate) {
    throw new Error(
      "Morpho Blue vault APY metrics require explicit vault selector (vault address/name/symbol)"
    );
  }
  return candidate.toLowerCase();
}

type MorphoMarketsResponse = {
  markets?: {
    items?: Array<{
      marketId?: string;
      chain?: { id?: number };
      loanAsset?: { symbol?: string };
      state?: { supplyApy?: number; supplyAssetsUsd?: number };
    }>;
  };
};

type MorphoVaultsResponse = {
  vaults?: {
    items?: Array<{
      address?: string;
      name?: string;
      symbol?: string;
      chain?: { id?: number };
      asset?: { symbol?: string };
      state?: { apy?: number; netApy?: number; totalAssetsUsd?: number };
    }>;
  };
};

async function fetchMorphoApyBps(input: {
  chainId: number;
  asset?: string;
  marketId?: string;
}): Promise<number> {
  const query = `
    query ($first: Int!, $where: MarketFilters) {
      markets(first: $first, where: $where) {
        items {
          marketId
          chain { id }
          loanAsset { symbol }
          state { supplyApy supplyAssetsUsd }
        }
      }
    }
  `;

  const where = input.marketId
    ? { uniqueKey_in: [input.marketId] }
    : { chainId_in: [input.chainId] };
  const payload = await fetchMorphoMarkets(query, { first: 200, where });
  const items = payload.markets?.items ?? [];
  const candidate = pickMorphoMarketCandidate(items, input);
  if (!candidate?.state || candidate.state.supplyApy === undefined) {
    if (input.marketId) {
      throw new Error(
        `Morpho Blue APY metric unavailable for market_id '${input.marketId}' on chain ${input.chainId}`
      );
    }
    throw new Error(`Morpho Blue APY metric unavailable for asset '${input.asset ?? "unknown"}'`);
  }
  return normalizeApyToBps(candidate.state.supplyApy);
}

function pickMorphoMarketCandidate(
  items: Array<{
    marketId?: string;
    chain?: { id?: number };
    loanAsset?: { symbol?: string };
    state?: { supplyApy?: number; supplyAssetsUsd?: number };
  }>,
  input: {
    chainId: number;
    asset?: string;
    marketId?: string;
  }
): {
  marketId?: string;
  chain?: { id?: number };
  loanAsset?: { symbol?: string };
  state?: { supplyApy?: number; supplyAssetsUsd?: number };
} | null {
  if (input.marketId) {
    const match = items.find((item) => item.marketId?.toLowerCase() === input.marketId);
    return match ?? null;
  }

  if (!input.asset) {
    throw new Error("Morpho Blue APY metric requires an asset when market_id is omitted");
  }

  const needle = input.asset.toUpperCase();
  const chainMatches = items.filter((item) => item.chain?.id === input.chainId);
  const assetMatches = chainMatches.filter(
    (item) => item.loanAsset?.symbol?.toUpperCase() === needle
  );
  if (assetMatches.length === 0) {
    return null;
  }

  assetMatches.sort((a, b) => (b.state?.supplyAssetsUsd ?? 0) - (a.state?.supplyAssetsUsd ?? 0));
  return assetMatches[0] ?? null;
}

async function fetchMorphoVaultApyBps(input: {
  chainId: number;
  asset?: string;
  selector: string;
  useNetApy: boolean;
}): Promise<number> {
  const query = `
    query ($first: Int!, $where: VaultFilters) {
      vaults(first: $first, where: $where) {
        items {
          address
          name
          symbol
          chain { id }
          asset { symbol }
          state { apy netApy totalAssetsUsd }
        }
      }
    }
  `;

  const where: Record<string, unknown> = { chainId_in: [input.chainId] };
  if (input.asset) {
    where.assetSymbol_in = [input.asset.toUpperCase()];
  }

  const payload = await fetchMorphoVaults(query, { first: 200, where });
  const items = payload.vaults?.items ?? [];
  const candidate = pickMorphoVaultCandidate(items, input);
  const apy = input.useNetApy ? candidate?.state?.netApy : candidate?.state?.apy;

  if (apy === undefined) {
    const metric = input.useNetApy ? "vault_net_apy" : "vault_apy";
    throw new Error(
      `Morpho Blue ${metric} metric unavailable for vault selector '${input.selector}' on chain ${input.chainId}`
    );
  }

  return normalizeApyToBps(apy);
}

function pickMorphoVaultCandidate(
  items: Array<{
    address?: string;
    name?: string;
    symbol?: string;
    chain?: { id?: number };
    asset?: { symbol?: string };
    state?: { apy?: number; netApy?: number; totalAssetsUsd?: number };
  }>,
  input: {
    chainId: number;
    asset?: string;
    selector: string;
  }
): {
  address?: string;
  name?: string;
  symbol?: string;
  chain?: { id?: number };
  asset?: { symbol?: string };
  state?: { apy?: number; netApy?: number; totalAssetsUsd?: number };
} | null {
  const chainMatches = items.filter((item) => item.chain?.id === input.chainId);
  const needle = input.selector.toLowerCase();
  const match = chainMatches.find(
    (item) =>
      item.address?.toLowerCase() === needle ||
      item.name?.toLowerCase() === needle ||
      item.symbol?.toLowerCase() === needle
  );
  return match ?? null;
}

async function fetchMorphoMarkets(
  query: string,
  variables: Record<string, unknown>
): Promise<MorphoMarketsResponse> {
  const response = await fetch(MORPHO_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    throw new Error(`Morpho API error: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as {
    data?: MorphoMarketsResponse;
    errors?: Array<{ message?: string }>;
  };
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message ?? "Unknown error").join("; "));
  }
  return payload.data ?? {};
}

async function fetchMorphoVaults(
  query: string,
  variables: Record<string, unknown>
): Promise<MorphoVaultsResponse> {
  const response = await fetch(MORPHO_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    throw new Error(`Morpho API error: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as {
    data?: MorphoVaultsResponse;
    errors?: Array<{ message?: string }>;
  };
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message ?? "Unknown error").join("; "));
  }
  return payload.data ?? {};
}

export function isMorphoAction(action: Action): action is Extract<
  Action,
  {
    type: "lend" | "withdraw" | "borrow" | "repay" | "supply_collateral" | "withdraw_collateral";
  }
> {
  return [
    "lend",
    "withdraw",
    "borrow",
    "repay",
    "supply_collateral",
    "withdraw_collateral",
  ].includes(action.type);
}
