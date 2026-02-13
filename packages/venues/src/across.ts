import { addressToBytes32, getIntegratorDataSuffix, getQuote } from "@across-protocol/app-sdk";
import { spokePoolAbiV3_5 } from "@across-protocol/app-sdk/dist/abis/SpokePool/v3_5.js";
import type { Address, BuiltTransaction, VenueAdapter } from "@grimoirelabs/core";
import { zeroAddress } from "viem";
import { assertSupportedConstraints } from "./constraints.js";
import { buildApprovalIfNeeded } from "./erc20.js";
import { resolveTokenAddress } from "./token-registry.js";

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
  const meta: VenueAdapter["meta"] = {
    name: "across",
    supportedChains,
    actions: ["bridge"],
    supportedConstraints: [
      "max_slippage",
      "min_output",
      "require_quote",
      "require_simulation",
      "max_gas",
    ],
    supportsQuote: true,
    supportsSimulation: true,
    supportsPreviewCommit: true,
    dataEndpoints: ["quote", "deposit_simulation"],
    description: "Across Protocol bridge adapter",
  };

  return {
    meta,
    async buildAction(action, ctx) {
      assertSupportedConstraints(meta, action);

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
      const minDeposit = quote.limits.minDeposit;
      if (amount < minDeposit) {
        throw new Error(
          `Across bridge amount ${amount.toString()} is below minimum ${minDeposit.toString()} for this route`
        );
      }

      const client = ctx.provider.getClient?.();
      if (action.constraints?.requireQuote === true && !quote) {
        throw new Error("Across adapter could not resolve quote while require_quote is enabled");
      }
      if (!client?.simulateContract) {
        throw new Error("Across adapter requires a provider with simulateContract support");
      }
      if (action.constraints?.requireSimulation === true && !client.simulateContract) {
        throw new Error(
          "Across adapter requires simulation support while require_simulation is enabled"
        );
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
      const value = txRequest.value ?? 0n;
      const gasEstimate = await estimateGasIfSupported(ctx, { to, data, value });
      const estimatedGas = gasEstimate?.gasLimit;

      if (action.constraints?.maxGas !== undefined) {
        if (estimatedGas === undefined) {
          throw new Error("Across adapter could not estimate gas while max_gas is enabled");
        }
        if (estimatedGas > action.constraints.maxGas) {
          throw new Error(
            `Across bridge gas estimate ${estimatedGas.toString()} exceeds max_gas ${action.constraints.maxGas.toString()}`
          );
        }
      }

      const warnings: string[] = [];
      if (quote.isAmountTooLow) {
        warnings.push("Bridge amount is below recommended minimum for this route");
      }

      const bridgeTx = {
        tx: {
          to,
          data,
          value,
        },
        description: `Across bridge ${action.asset} ${originChainId} → ${destinationChainId}`,
        gasEstimate,
        action,
        metadata: {
          quote: {
            expectedIn: quote.deposit.inputAmount,
            expectedOut: quote.deposit.outputAmount,
            minOut: deposit.outputAmount,
            slippageBps,
          },
          route: {
            originChainId,
            destinationChainId,
            inputToken,
            outputToken,
            spokePoolAddress: deposit.spokePoolAddress,
            quoteTimestamp: deposit.quoteTimestamp,
            fillDeadline: deposit.fillDeadline,
            estimatedFillTimeSec: quote.estimatedFillTimeSec,
            minDeposit: quote.limits.minDeposit,
            maxDeposit: quote.limits.maxDeposit,
            maxDepositInstant: quote.limits.maxDepositInstant,
          },
          fees: {
            lpFee: quote.fees.lpFee,
            relayerGasFee: quote.fees.relayerGasFee,
            relayerCapitalFee: quote.fees.relayerCapitalFee,
            totalRelayFee: quote.fees.totalRelayFee,
          },
          warnings,
        },
      };

      return [...approvalTxs, bridgeTx];
    },
  };
}

const DEFAULT_ASSETS: Record<string, Record<number, Address>> = {
  USDC: {
    1: resolveTokenAddress("USDC", 1),
    8453: resolveTokenAddress("USDC", 8453),
    10: resolveTokenAddress("USDC", 10),
    42161: resolveTokenAddress("USDC", 42161),
    1337: "0x6d1e7cde53a9467b783991afd8af56d4a99b3a56" as Address,
  },
  WETH: {
    1: resolveTokenAddress("WETH", 1),
    8453: resolveTokenAddress("WETH", 8453),
    10: resolveTokenAddress("WETH", 10),
    42161: resolveTokenAddress("WETH", 42161),
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

async function estimateGasIfSupported(
  ctx: Parameters<NonNullable<VenueAdapter["buildAction"]>>[1],
  tx: { to: Address; data?: string; value?: bigint }
): Promise<BuiltTransaction["gasEstimate"] | undefined> {
  if (typeof ctx.provider.getGasEstimate !== "function") {
    return undefined;
  }
  try {
    return await ctx.provider.getGasEstimate({
      ...tx,
      from: ctx.walletAddress,
    });
  } catch {
    return undefined;
  }
}
