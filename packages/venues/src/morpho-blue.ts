import type { Action, Address, VenueAdapter, VenueBuildMetadata } from "@grimoirelabs/core";
import { getChainAddresses, MarketUtils } from "@morpho-org/blue-sdk";
import { blueAbi } from "@morpho-org/blue-sdk-viem";
import { encodeFunctionData, parseAbi } from "viem";
import { assertSupportedConstraints } from "./constraints.js";
import { buildApprovalIfNeeded } from "./erc20.js";
import { resolveTokenAddress } from "./token-registry.js";

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

export function createMorphoBlueAdapter(config: MorphoBlueAdapterConfig): VenueAdapter {
  const meta: VenueAdapter["meta"] = {
    name: "morpho_blue",
    supportedChains: [1, 8453],
    actions: ["lend", "withdraw", "borrow", "repay", "supply_collateral", "withdraw_collateral"],
    supportedConstraints: [],
    supportsQuote: false,
    supportsSimulation: false,
    supportsPreviewCommit: true,
    dataEndpoints: ["info", "addresses", "vaults", "markets"],
    description: "Morpho Blue adapter",
  };

  return {
    meta,
    async buildAction(action, ctx) {
      assertSupportedConstraints(meta, action);

      if (!isMorphoAction(action)) {
        throw new Error(`Unsupported Morpho Blue action: ${action.type}`);
      }

      const addresses = getChainAddresses(ctx.chainId);
      const explicitMarketId = resolveExplicitMarketId(action, ctx);
      const market = resolveMarket(config.markets, action, ctx.chainId, {
        explicitMarketId,
        isCrossChain: ctx.crossChain?.enabled === true,
        onWarning: ctx.onWarning,
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

export const morphoBlueAdapter = createMorphoBlueAdapter({ markets: MORPHO_BLUE_DEFAULT_MARKETS });

export function getMorphoBlueMarketId(market: {
  loanToken: Address;
  collateralToken: Address;
  oracle: Address;
  irm: Address;
  lltv: bigint;
}): `0x${string}` {
  return MarketUtils.getMarketId(market) as `0x${string}`;
}

function isMorphoAction(action: Action): action is Extract<
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

function resolveMarket(
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

function resolveExplicitMarketId(
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

function toBigInt(amount: unknown): bigint {
  if (amount === "max") {
    throw new Error("Morpho adapter requires explicit amount");
  }
  if (typeof amount === "bigint") return amount;
  if (typeof amount === "number") return BigInt(Math.floor(amount));
  if (typeof amount === "string") return BigInt(amount);
  if (isLiteralAmount(amount)) {
    return BigInt(amount.value);
  }
  throw new Error("Unsupported amount type for Morpho action");
}

function isLiteralAmount(
  value: unknown
): value is { kind: "literal"; value: string | number | bigint } {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    (value as { kind?: unknown }).kind === "literal" &&
    "value" in value
  );
}

function buildMorphoMetadata(
  action: Extract<
    Action,
    {
      type: "lend" | "withdraw" | "borrow" | "repay" | "supply_collateral" | "withdraw_collateral";
    }
  >,
  market: MorphoBlueMarketConfig,
  options: {
    chainId: number;
    morphoAddress: Address;
    amount: bigint;
    isApproval?: boolean;
  }
): VenueBuildMetadata {
  const quote =
    action.type === "borrow" || action.type === "withdraw" || action.type === "withdraw_collateral"
      ? { expectedOut: options.amount }
      : { expectedIn: options.amount };

  return {
    quote: options.isApproval ? undefined : quote,
    route: {
      chainId: options.chainId,
      morphoAddress: options.morphoAddress,
      marketId: market.id,
      loanToken: market.loanToken,
      collateralToken: market.collateralToken,
      oracle: market.oracle,
      irm: market.irm,
      lltv: market.lltv.toString(),
      approval: options.isApproval === true,
      utilization: null,
    },
  };
}

const ORACLE_PRICE_ABI = parseAbi(["function price() view returns (uint256)"]);

async function preflightBorrowReadiness(input: {
  ctx: Parameters<NonNullable<VenueAdapter["buildAction"]>>[1];
  market: MorphoBlueMarketConfig;
  marketParams: {
    loanToken: Address;
    collateralToken: Address;
    oracle: Address;
    irm: Address;
    lltv: bigint;
  };
  amount: bigint;
  mode: Parameters<NonNullable<VenueAdapter["buildAction"]>>[1]["mode"];
}): Promise<void> {
  if (input.mode === "execute") {
    return;
  }

  const client = input.ctx.provider.getClient?.();
  if (!client?.readContract) {
    throw new Error(
      buildBorrowPreflightMessage({
        market: input.market,
        reason:
          "unable to verify collateral readiness because provider does not expose readContract",
      })
    );
  }

  const marketId = getMorphoBlueMarketId(input.marketParams);

  const rawPosition = (await client.readContract({
    address: getChainAddresses(input.ctx.chainId).morpho as Address,
    abi: blueAbi,
    functionName: "position",
    args: [marketId, input.ctx.walletAddress],
  })) as readonly [bigint, bigint, bigint];
  const borrowShares = rawPosition[1] ?? 0n;
  const collateral = rawPosition[2] ?? 0n;

  if (collateral <= 0n) {
    throw new Error(
      buildBorrowPreflightMessage({
        market: input.market,
        reason: "wallet has zero collateral in selected market position",
        detail: `position_collateral=0 requested_borrow=${input.amount.toString()}`,
      })
    );
  }

  const rawMarket = (await client.readContract({
    address: getChainAddresses(input.ctx.chainId).morpho as Address,
    abi: blueAbi,
    functionName: "market",
    args: [marketId],
  })) as readonly [bigint, bigint, bigint, bigint, bigint, bigint];

  const totalSupplyAssets = rawMarket[0] ?? 0n;
  const totalBorrowAssets = rawMarket[2] ?? 0n;
  const totalBorrowShares = rawMarket[3] ?? 0n;
  const availableLiquidity =
    totalSupplyAssets > totalBorrowAssets ? totalSupplyAssets - totalBorrowAssets : 0n;

  if (input.amount > availableLiquidity) {
    throw new Error(
      buildBorrowPreflightMessage({
        market: input.market,
        reason: "requested borrow exceeds market available liquidity",
        detail: `requested=${input.amount.toString()} available_liquidity=${availableLiquidity.toString()}`,
      })
    );
  }

  if (input.market.lltv <= 0n) {
    throw new Error(
      buildBorrowPreflightMessage({
        market: input.market,
        reason: "market lltv is zero so borrow headroom is zero",
      })
    );
  }

  const oraclePrice = await readOraclePrice(client, input.market.oracle);
  const maxBorrowableAssets = MarketUtils.getMaxBorrowableAssets(
    {
      collateral,
      borrowShares,
    },
    {
      totalBorrowAssets,
      totalBorrowShares,
      price: oraclePrice,
    },
    {
      lltv: input.market.lltv,
    }
  );

  if (maxBorrowableAssets !== undefined && input.amount > maxBorrowableAssets) {
    throw new Error(
      buildBorrowPreflightMessage({
        market: input.market,
        reason: "insufficient collateral headroom for requested borrow",
        detail: `requested=${input.amount.toString()} max_borrowable=${maxBorrowableAssets.toString()} price=${oraclePrice?.toString() ?? "unavailable"} borrow_capacity_usage_bps=${toBorrowCapacityUsageBps(
          input.amount,
          maxBorrowableAssets
        )}`,
      })
    );
  }
}

async function readOraclePrice(
  client: { readContract?: unknown },
  oracleAddress: Address
): Promise<bigint | undefined> {
  try {
    if (typeof client.readContract !== "function") {
      return undefined;
    }
    const readContract = client.readContract as (
      params: Record<string, unknown>
    ) => Promise<unknown>;
    const price = await readContract({
      address: oracleAddress,
      abi: ORACLE_PRICE_ABI,
      functionName: "price",
    });
    return typeof price === "bigint" ? price : undefined;
  } catch {
    return undefined;
  }
}

function buildBorrowPreflightMessage(input: {
  market: MorphoBlueMarketConfig;
  reason: string;
  detail?: string;
}): string {
  const prefix =
    `Morpho borrow preflight failed for market_id '${input.market.id}' ` +
    `(loan_token=${input.market.loanToken}, collateral_token=${input.market.collateralToken}): ` +
    `${input.reason}.`;
  const detail = input.detail ? ` ${input.detail}.` : "";
  const nextStep = ` Next step: call morpho_blue.supply_collateral(<collateral_asset>, <amount>, "${input.market.id}") before borrow.`;
  return `${prefix}${detail}${nextStep}`;
}

function toBorrowCapacityUsageBps(requested: bigint, maxBorrowable: bigint): string {
  if (maxBorrowable <= 0n) {
    return "INF";
  }
  const usage = (requested * 10_000n) / maxBorrowable;
  return usage.toString();
}
