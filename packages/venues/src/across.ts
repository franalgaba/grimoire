import { addressToBytes32, getIntegratorDataSuffix, getQuote } from "@across-protocol/app-sdk";
import { spokePoolAbiV3_5 } from "@across-protocol/app-sdk/dist/abis/SpokePool/v3_5.js";
import type { Address, BuiltTransaction, VenueAdapter } from "@grimoire/core";
import { zeroAddress } from "viem";
import { buildApprovalIfNeeded } from "./erc20.js";

export interface AcrossAdapterConfig {
  integratorId?: `0x${string}`;
  assets: Record<string, Record<number, Address>>;
  apiUrl?: string;
  getQuote?: typeof getQuote;
  slippageBps?: number;
}

const DEFAULT_INTEGRATOR_ID = "0x0000" as const;

export function createAcrossAdapter(
  config: AcrossAdapterConfig = { assets: {}, integratorId: DEFAULT_INTEGRATOR_ID }
): VenueAdapter {
  const getQuoteImpl = config.getQuote ?? getQuote;
  const integratorId = config.integratorId ?? DEFAULT_INTEGRATOR_ID;

  const supportedChains = Array.from(
    new Set(Object.values(config.assets).flatMap((chains) => Object.keys(chains).map(Number)))
  );

  return {
    meta: {
      name: "across",
      supportedChains,
      actions: ["bridge"],
      description: "Across Protocol bridge adapter",
    },
    async buildAction(action, ctx) {
      if (action.type !== "bridge") {
        throw new Error(`Across adapter only supports bridge actions (got ${action.type})`);
      }

      const amount = toBigInt(action.amount);
      const originChainId = ctx.chainId;
      if (typeof action.toChain !== "number") {
        throw new Error("Across adapter requires numeric toChain");
      }
      const destinationChainId = action.toChain;
      const inputToken = resolveAssetAddress(action.asset, originChainId, config.assets);
      const outputToken = resolveAssetAddress(
        action.asset,
        destinationChainId,
        config.assets,
        inputToken
      );

      const quote = await getQuoteImpl({
        route: {
          originChainId,
          destinationChainId,
          inputToken,
          outputToken,
        },
        inputAmount: amount,
        apiUrl: config.apiUrl,
        recipient: ctx.walletAddress,
      });

      const client = ctx.provider.getClient?.();
      if (!client?.simulateContract) {
        throw new Error("Across adapter requires a provider with simulateContract support");
      }

      const slippageBps = action.constraints?.maxSlippageBps ?? config.slippageBps;
      const minOutput =
        action.constraints?.minOutput ??
        (slippageBps !== undefined
          ? applyBps(quote.deposit.outputAmount, 10_000 - slippageBps)
          : quote.deposit.outputAmount);

      const deposit = { ...quote.deposit, outputAmount: minOutput };
      const recipient = deposit.recipient ?? ctx.walletAddress;

      const simulation = await client.simulateContract({
        account: ctx.walletAddress,
        abi: spokePoolAbiV3_5,
        address: deposit.spokePoolAddress,
        functionName: "deposit",
        args: [
          addressToBytes32(ctx.walletAddress),
          addressToBytes32(recipient),
          addressToBytes32(deposit.inputToken),
          addressToBytes32(deposit.outputToken),
          deposit.inputAmount,
          deposit.outputAmount,
          BigInt(deposit.destinationChainId),
          addressToBytes32(deposit.exclusiveRelayer ?? zeroAddress),
          deposit.quoteTimestamp,
          deposit.fillDeadline,
          deposit.exclusivityDeadline,
          deposit.message,
        ],
        value: deposit.isNative ? deposit.inputAmount : 0n,
        dataSuffix: getIntegratorDataSuffix(integratorId),
      });

      const approvalTxs = deposit.isNative
        ? []
        : await buildApprovalIfNeeded({
            ctx,
            token: inputToken,
            spender: deposit.spokePoolAddress,
            amount: deposit.inputAmount,
            action,
            description: `Approve ${action.asset} for Across`,
          });

      const txRequest = simulation.request;
      const to = ("to" in txRequest ? txRequest.to : txRequest.address) as Address;
      const data = ("data" in txRequest ? txRequest.data : "0x") as string;

      const bridgeTx: BuiltTransaction = {
        tx: {
          to,
          data,
          value: txRequest.value ?? 0n,
        },
        description: `Across bridge ${action.asset} ${originChainId} → ${destinationChainId}`,
        action,
      };

      return [...approvalTxs, bridgeTx];
    },
  };
}

const DEFAULT_ASSETS: Record<string, Record<number, Address>> = {
  USDC: {
    1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
    8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address,
    10: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" as Address,
    42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as Address,
    1337: "0x6d1e7cde53a9467b783991afd8af56d4a99b3a56" as Address,
  },
  WETH: {
    1: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address,
    8453: "0x4200000000000000000000000000000000000006" as Address,
    10: "0x4200000000000000000000000000000000000006" as Address,
    42161: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1" as Address,
  },
};

export const acrossAdapter = createAcrossAdapter({
  integratorId: DEFAULT_INTEGRATOR_ID,
  assets: DEFAULT_ASSETS,
});

function resolveAssetAddress(
  asset: string,
  chainId: number,
  assets: Record<string, Record<number, Address>>,
  fallback?: Address
): Address {
  if (asset.startsWith("0x") && asset.length === 42) {
    return asset as Address;
  }

  const assetMap = assets[asset];
  const resolved = assetMap?.[chainId] ?? fallback;
  if (!resolved) {
    throw new Error(`No Across asset mapping for ${asset} on chain ${chainId}`);
  }

  return resolved;
}

function toBigInt(amount: unknown): bigint {
  if (typeof amount === "bigint") {
    return amount;
  }
  if (typeof amount === "number") {
    return BigInt(Math.floor(amount));
  }
  if (typeof amount === "string") {
    return BigInt(amount);
  }
  if (isLiteralAmount(amount)) {
    return typeof amount.value === "bigint" ? amount.value : BigInt(amount.value);
  }

  throw new Error("Across adapter requires a numeric amount");
}

function isLiteralAmount(value: unknown): value is {
  kind: "literal";
  value: string | number | bigint;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    (value as { kind?: unknown }).kind === "literal" &&
    "value" in value
  );
}

function applyBps(amount: bigint, bps: number): bigint {
  return (amount * BigInt(bps)) / 10_000n;
}
