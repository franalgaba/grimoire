import { addressToBytes32, getIntegratorDataSuffix, getQuote } from "@across-protocol/app-sdk";
import { spokePoolAbiV3_5 } from "@across-protocol/app-sdk/dist/abis/SpokePool/v3_5.js";
import type { Address, VenueAdapter } from "@grimoirelabs/core";
import { zeroAddress } from "viem";
import { toBigInt, toBigIntIfPossible } from "../shared/bigint.js";
import { applyBps } from "../shared/bps.js";
import { assertSupportedConstraints, validateGasConstraints } from "../shared/constraints.js";
import { buildApprovalIfNeeded } from "../shared/erc20.js";
import { estimateGasIfSupported } from "../shared/gas.js";
import { resolveBridgedTokenAddress, resolveTokenAddress } from "../shared/token-registry.js";

export interface AcrossAdapterConfig {
  integratorId?: `0x${string}`;
  assets?: Record<string, Record<number, Address>>;
  supportedChains?: number[];
  apiUrl?: string;
  getQuote?: typeof getQuote;
  slippageBps?: number;
}

const DEFAULT_INTEGRATOR_ID = "0x0000" as const;
const DEFAULT_SUPPORTED_CHAINS = [1, 10, 137, 8453, 42161];

export function createAcrossAdapter(config: AcrossAdapterConfig = {}): VenueAdapter {
  const getQuoteImpl = config.getQuote ?? getQuote;
  const integratorId = config.integratorId ?? DEFAULT_INTEGRATOR_ID;
  const assets = config.assets ?? {};
  const supportedChains = config.supportedChains ?? DEFAULT_SUPPORTED_CHAINS;

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

  const resolveHandoffStatus: NonNullable<VenueAdapter["resolveHandoffStatus"]> = async (input) => {
    return await resolveAcrossHandoffStatus(input, config.apiUrl);
  };

  return {
    meta,
    async buildAction(action, ctx) {
      assertSupportedConstraints(meta, action);

      if (action.type !== "bridge") {
        throw new Error(`Across adapter only supports bridge actions (got ${action.type})`);
      }

      const amount = toBigInt(action.amount, "Across adapter requires a numeric amount");
      const originChainId = ctx.chainId;
      if (typeof action.toChain !== "number") {
        throw new Error("Across adapter requires numeric toChain");
      }
      const destinationChainId = action.toChain;
      const inputToken = resolveAssetAddress(action.asset, originChainId, assets);
      const outputToken = resolveAssetAddress(
        action.asset,
        destinationChainId,
        assets,
        inputToken,
        originChainId
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

      validateGasConstraints({
        gasLimit: gasEstimate?.gasLimit,
        constraints: action.constraints,
        venueName: "Across adapter",
      });

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
    bridgeLifecycle: {
      resolveHandoffStatus,
    },
    resolveHandoffStatus,
  };
}

export const acrossAdapter = createAcrossAdapter({
  integratorId: DEFAULT_INTEGRATOR_ID,
  assets: {
    USDC: {
      1337: "0x6d1e7cde53a9467b783991afd8af56d4a99b3a56" as Address,
    },
  },
  supportedChains: [...DEFAULT_SUPPORTED_CHAINS, 1337],
});

function resolveAssetAddress(
  asset: string,
  chainId: number,
  assets: Record<string, Record<number, Address>>,
  fallback?: Address,
  originChainId?: number
): Address {
  // 1. Direct address passthrough
  if (asset.startsWith("0x") && asset.length === 42) {
    return asset as Address;
  }

  // 2. Config overrides (test chains, user overrides)
  const configAddr = assets[asset]?.[chainId];
  if (configAddr) {
    return configAddr;
  }

  // 3. Token registry (SHARED_TOKENS + Uniswap list)
  try {
    return resolveTokenAddress(asset, chainId);
  } catch {
    // Not in registry — try bridge index
  }

  // 4. Bridge index (cross-chain equivalents from bridgeInfo)
  if (originChainId !== undefined) {
    const bridged = resolveBridgedTokenAddress(asset, originChainId, chainId);
    if (bridged) {
      return bridged;
    }
  }

  // 5. Explicit fallback (input token address used for output token)
  if (fallback) {
    return fallback;
  }

  throw new Error(`No Across asset mapping for ${asset} on chain ${chainId}`);
}

async function resolveAcrossHandoffStatus(
  input: Parameters<NonNullable<VenueAdapter["resolveHandoffStatus"]>>[0],
  apiUrl?: string
): Promise<{
  status: "pending" | "settled" | "failed" | "expired";
  settledAmount?: bigint;
  reference?: string;
  reason?: string;
}> {
  const reference = input.reference ?? input.originTxHash;
  if (!reference) {
    return { status: "pending" };
  }

  const base = apiUrl?.replace(/\/$/, "") ?? "https://app.across.to/api";
  const candidates = input.originTxHash
    ? [`${base}/deposits/status?txHash=${encodeURIComponent(input.originTxHash)}`]
    : [`${base}/deposits/status?depositId=${encodeURIComponent(reference)}`];

  for (const url of candidates) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        continue;
      }
      const payload = (await response.json()) as Record<string, unknown>;
      const statusText = String(
        payload.status ?? payload.fillStatus ?? payload.state ?? payload.depositStatus ?? "pending"
      ).toLowerCase();
      if (
        statusText === "settled" ||
        statusText === "filled" ||
        statusText === "completed" ||
        statusText === "executed"
      ) {
        const settledAmount = toBigIntIfPossible(
          payload.settledAmount ?? payload.outputAmount ?? payload.amountFilled ?? payload.amount
        );
        return {
          status: "settled",
          settledAmount,
          reference:
            (typeof payload.depositId === "string" && payload.depositId) ||
            (typeof payload.id === "string" && payload.id) ||
            reference,
        };
      }
      if (statusText === "failed" || statusText === "cancelled" || statusText === "error") {
        return {
          status: "failed",
          reference,
          reason:
            (typeof payload.reason === "string" && payload.reason) ||
            (typeof payload.error === "string" && payload.error) ||
            "Across bridge reported failure",
        };
      }
      if (statusText === "expired") {
        return {
          status: "expired",
          reference,
          reason:
            (typeof payload.reason === "string" && payload.reason) ||
            "Across bridge deposit expired",
        };
      }
      return { status: "pending", reference };
    } catch {
      /* status check failed — try next candidate URL */
    }
  }

  return { status: "pending", reference };
}
