import type { Address } from "@grimoirelabs/core";
import { encodeAbiParameters } from "viem";
import { BPS_DENOMINATOR } from "../../shared/bps.js";
import {
  Actions,
  EXACT_INPUT_SINGLE_TYPE,
  EXACT_OUTPUT_SINGLE_TYPE,
  type PoolKey,
} from "./constants.js";

// ─── V4 Swap Encoding ────────────────────────────────────────────────────────

export function computeSlippageBpsFromMinOut(expectedOut: bigint, minOut: bigint): number {
  if (expectedOut <= 0n) {
    throw new Error("Cannot compute slippage from zero expected output");
  }
  if (minOut > expectedOut) {
    throw new Error("min_output exceeds expected output");
  }
  const diff = expectedOut - minOut;
  const bps = (diff * BPS_DENOMINATOR) / expectedOut;
  return Number(bps);
}

export function computeSlippageBpsFromMaxIn(expectedIn: bigint, maxIn: bigint): number {
  if (expectedIn <= 0n) {
    throw new Error("Cannot compute slippage from zero expected input");
  }
  if (maxIn < expectedIn) {
    throw new Error("max_input is below expected input");
  }
  const diff = maxIn - expectedIn;
  const bps = (diff * BPS_DENOMINATOR) / expectedIn;
  return Number(bps);
}

export function encodeV4SwapInput(params: {
  poolKey: PoolKey;
  zeroForOne: boolean;
  amount: bigint;
  amountOutMinimum: bigint;
  settleAmount: bigint;
  isExactOut: boolean;
  currencyIn: Address;
  currencyOut: Address;
}): `0x${string}` {
  let actions: `0x${string}`;
  let swapParams: `0x${string}`;

  if (params.isExactOut) {
    // SWAP_EXACT_OUT_SINGLE (0x08) + SETTLE_ALL (0x0c) + TAKE_ALL (0x0f)
    actions =
      `0x${Actions.SWAP_EXACT_OUT_SINGLE.toString(16).padStart(2, "0")}${Actions.SETTLE_ALL.toString(16).padStart(2, "0")}${Actions.TAKE_ALL.toString(16).padStart(2, "0")}` as `0x${string}`;

    swapParams = encodeAbiParameters(EXACT_OUTPUT_SINGLE_TYPE, [
      {
        poolKey: params.poolKey,
        zeroForOne: params.zeroForOne,
        amountOut: params.amount,
        amountInMaximum: params.settleAmount,
        hookData: "0x",
      },
    ]);
  } else {
    // SWAP_EXACT_IN_SINGLE (0x06) + SETTLE_ALL (0x0c) + TAKE_ALL (0x0f)
    actions =
      `0x${Actions.SWAP_EXACT_IN_SINGLE.toString(16).padStart(2, "0")}${Actions.SETTLE_ALL.toString(16).padStart(2, "0")}${Actions.TAKE_ALL.toString(16).padStart(2, "0")}` as `0x${string}`;

    swapParams = encodeAbiParameters(EXACT_INPUT_SINGLE_TYPE, [
      {
        poolKey: params.poolKey,
        zeroForOne: params.zeroForOne,
        amountIn: params.amount,
        amountOutMinimum: params.amountOutMinimum,
        hookData: "0x",
      },
    ]);
  }

  // SETTLE_ALL: (currency, maxAmount) — pays what is owed for input
  const settleParams = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [params.currencyIn, params.settleAmount]
  );

  // TAKE_ALL: (currency, minAmount) — receives output tokens
  const takeParams = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [params.currencyOut, params.amountOutMinimum]
  );

  // V4_SWAP input: abi.encode(bytes actions, bytes[] params)
  return encodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes[]" }],
    [actions, [swapParams, settleParams, takeParams]]
  );
}
