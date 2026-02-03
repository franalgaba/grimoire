import type { Action, Address, VenueAdapter } from "@grimoirelabs/core";
import { getChainAddresses } from "@morpho-org/blue-sdk";
import { blueAbi } from "@morpho-org/blue-sdk-viem";
import { encodeFunctionData } from "viem";
import { buildApprovalIfNeeded } from "./erc20.js";

export interface MorphoBlueMarketConfig {
  id: string;
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
  return {
    meta: {
      name: "morpho_blue",
      supportedChains: [1, 8453],
      actions: ["lend", "withdraw", "borrow", "repay"],
      description: "Morpho Blue adapter",
    },
    async buildAction(action, ctx) {
      if (!isMorphoAction(action)) {
        throw new Error(`Unsupported Morpho Blue action: ${action.type}`);
      }

      const addresses = getChainAddresses(ctx.chainId);
      const market = resolveMarket(config.markets, action, ctx.chainId);
      const amount = toBigInt(action.amount);

      const marketParams = {
        loanToken: market.loanToken,
        collateralToken: market.collateralToken,
        oracle: market.oracle,
        irm: market.irm,
        lltv: market.lltv,
      };

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
        default:
          throw new Error("Unsupported Morpho Blue action");
      }

      const needsApproval = action.type === "lend" || action.type === "repay";
      const approvalTxs = needsApproval
        ? await buildApprovalIfNeeded({
            ctx,
            token: market.loanToken,
            spender: addresses.morpho as Address,
            amount,
            action,
            description: `Approve ${action.asset} for Morpho Blue`,
          })
        : [];

      return [
        ...approvalTxs,
        {
          tx: {
            to: addresses.morpho as Address,
            data,
            value: 0n,
          },
          description: `Morpho Blue ${action.type} ${action.asset}`,
          action,
        },
      ];
    },
  };
}

// Well-known Morpho Blue markets on Base (chain 8453).
// Fetched from the Morpho Blue API: https://blue-api.morpho.org/graphql
const DEFAULT_BASE_MARKETS: MorphoBlueMarketConfig[] = [
  {
    // cbBTC/USDC — largest USDC market on Base (~$1.26B supply)
    id: "cbbtc-usdc-86",
    loanToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address,
    collateralToken: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf" as Address,
    oracle: "0x663BECd10daE6C4A3Dcd89F1d76c1174199639B9" as Address,
    irm: "0x46415998764C29aB2a25CbeA6254146D50D22687" as Address,
    lltv: 860000000000000000n,
  },
  {
    // WETH/USDC — second largest (~$48.7M supply)
    id: "weth-usdc-86",
    loanToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address,
    collateralToken: "0x4200000000000000000000000000000000000006" as Address,
    oracle: "0xFEa2D58cEfCb9fcb597723c6bAE66fFE4193aFE4" as Address,
    irm: "0x46415998764C29aB2a25CbeA6254146D50D22687" as Address,
    lltv: 860000000000000000n,
  },
];

export const morphoBlueAdapter = createMorphoBlueAdapter({ markets: DEFAULT_BASE_MARKETS });

function isMorphoAction(
  action: Action
): action is Extract<Action, { type: "lend" | "withdraw" | "borrow" | "repay" }> {
  return ["lend", "withdraw", "borrow", "repay"].includes(action.type);
}

function resolveMarket(
  markets: MorphoBlueMarketConfig[],
  action: Action,
  chainId: number
): MorphoBlueMarketConfig {
  const loanToken = resolveAssetAddress("asset" in action ? action.asset : undefined, chainId);
  const collateral =
    "collateral" in action && action.collateral
      ? resolveAssetAddress(action.collateral, chainId)
      : undefined;

  const matches = markets.filter((market) => market.loanToken === loanToken);
  if (collateral) {
    const match = matches.find((market) => market.collateralToken === collateral);
    if (match) return match;
  }

  if (matches.length > 0) {
    const first = matches[0];
    if (first) return first;
  }

  throw new Error(
    `Morpho Blue market not configured for asset ${
      "asset" in action ? action.asset : "unknown"
    } on chain ${chainId}`
  );
}

function resolveAssetAddress(asset?: string, chainId?: number): Address {
  if (!asset) {
    throw new Error("Asset is required for Morpho Blue action");
  }
  if (asset.startsWith("0x") && asset.length === 42) {
    return asset as Address;
  }

  const KNOWN_TOKENS: Record<number, Record<string, Address>> = {
    1: {
      USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
      WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address,
    },
    8453: {
      USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address,
      WETH: "0x4200000000000000000000000000000000000006" as Address,
    },
  };

  const chainTokens = KNOWN_TOKENS[chainId ?? 1] ?? KNOWN_TOKENS[1];
  const address = chainTokens?.[asset.toUpperCase()];
  if (!address) {
    throw new Error(`Unknown asset: ${asset} on chain ${chainId ?? 1}. Provide address directly.`);
  }

  return address;
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
