import type { Address, VenueAdapter } from "@grimoirelabs/core";
import { getChainAddresses, MarketUtils } from "@morpho-org/blue-sdk";
import { blueAbi } from "@morpho-org/blue-sdk-viem";
import { parseAbi } from "viem";
import type { MorphoBlueMarketConfig } from "./markets.js";
import { getMorphoBlueMarketId } from "./markets.js";

const ORACLE_PRICE_ABI = parseAbi(["function price() view returns (uint256)"]);

export async function preflightBorrowReadiness(input: {
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
    /* oracle read failed — skip price check */
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

const INFINITE_USAGE = "INF";

function toBorrowCapacityUsageBps(requested: bigint, maxBorrowable: bigint): string {
  if (maxBorrowable <= 0n) {
    return INFINITE_USAGE;
  }
  const usage = (requested * 10_000n) / maxBorrowable;
  return usage.toString();
}
