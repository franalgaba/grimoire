import type { Address } from "@grimoirelabs/core";
import type { Abi } from "viem";
import { parseAbi } from "viem";

// ─── Constants ────────────────────────────────────────────────────────────────

export const NATIVE_ETH = "0x0000000000000000000000000000000000000000" as Address;
export const ZERO_HOOKS = "0x0000000000000000000000000000000000000000" as Address;
/** Universal Router maps this to msg.sender */
export const MSG_SENDER = "0x0000000000000000000000000000000000000001" as Address;
export const MAX_UINT160 = (1n << 160n) - 1n;
export const MAX_UINT256 = (1n << 256n) - 1n;

/** Universal Router v2 addresses (V4-capable) */
export const DEFAULT_ROUTERS: Record<number, Address> = {
  1: "0x66a9893cc07d91d95644aedd05d03f95e1dba8af" as Address,
  10: "0x851116d9223fabed8e56c0e6b8ad0c31d98b3507" as Address,
  137: "0x1095692a6237d83c6a72f3f5efedb9a670c49223" as Address,
  8453: "0x6ff5693b99212da76ad316178a184ab56d299b43" as Address,
  42161: "0xa51afafe0263b40edaef0df8781ea9aa03e381a3" as Address,
};

/** V4 Quoter addresses */
export const DEFAULT_QUOTERS: Record<number, Address> = {
  1: "0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203" as Address,
  8453: "0x0d5e0f971ed27fbff6c2837bf31316121532048d" as Address,
};

/** Permit2 (canonical across all chains) */
export const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address;

// ─── Universal Router Commands ────────────────────────────────────────────────

export const Commands = {
  V4_SWAP: 0x10,
  SWEEP: 0x04,
} as const;

/** V4 Action byte values */
export const Actions = {
  SWAP_EXACT_IN_SINGLE: 0x06,
  SWAP_EXACT_OUT_SINGLE: 0x08,
  SETTLE_ALL: 0x0c,
  TAKE_ALL: 0x0f,
} as const;

// ─── ABIs ─────────────────────────────────────────────────────────────────────

export const UNIVERSAL_ROUTER_ABI = parseAbi([
  "function execute(bytes commands, bytes[] inputs, uint256 deadline) payable",
]);

export const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

export const PERMIT2_ABI = parseAbi([
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
  "function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
]);

/** JSON ABI for Quoter (nested struct requires explicit tuple definitions) */
export const QUOTER_ABI: Abi = [
  {
    type: "function" as const,
    name: "quoteExactInputSingle" as const,
    inputs: [
      {
        type: "tuple" as const,
        name: "params" as const,
        components: [
          {
            type: "tuple" as const,
            name: "poolKey" as const,
            components: [
              { type: "address" as const, name: "currency0" as const },
              { type: "address" as const, name: "currency1" as const },
              { type: "uint24" as const, name: "fee" as const },
              { type: "int24" as const, name: "tickSpacing" as const },
              { type: "address" as const, name: "hooks" as const },
            ],
          },
          { type: "bool" as const, name: "zeroForOne" as const },
          { type: "uint128" as const, name: "exactAmount" as const },
          { type: "bytes" as const, name: "hookData" as const },
        ],
      },
    ],
    outputs: [
      { type: "uint256" as const, name: "amountOut" as const },
      { type: "uint256" as const, name: "gasEstimate" as const },
    ],
    stateMutability: "nonpayable" as const,
  },
  {
    type: "function" as const,
    name: "quoteExactOutputSingle" as const,
    inputs: [
      {
        type: "tuple" as const,
        name: "params" as const,
        components: [
          {
            type: "tuple" as const,
            name: "poolKey" as const,
            components: [
              { type: "address" as const, name: "currency0" as const },
              { type: "address" as const, name: "currency1" as const },
              { type: "uint24" as const, name: "fee" as const },
              { type: "int24" as const, name: "tickSpacing" as const },
              { type: "address" as const, name: "hooks" as const },
            ],
          },
          { type: "bool" as const, name: "zeroForOne" as const },
          { type: "uint128" as const, name: "exactAmount" as const },
          { type: "bytes" as const, name: "hookData" as const },
        ],
      },
    ],
    outputs: [
      { type: "uint256" as const, name: "amountIn" as const },
      { type: "uint256" as const, name: "gasEstimate" as const },
    ],
    stateMutability: "nonpayable" as const,
  },
];

// ─── ABI Encoding Types ──────────────────────────────────────────────────────

export const POOL_KEY_COMPONENTS = [
  { type: "address" as const, name: "currency0" as const },
  { type: "address" as const, name: "currency1" as const },
  { type: "uint24" as const, name: "fee" as const },
  { type: "int24" as const, name: "tickSpacing" as const },
  { type: "address" as const, name: "hooks" as const },
];

export const EXACT_INPUT_SINGLE_TYPE = [
  {
    type: "tuple" as const,
    components: [
      { type: "tuple" as const, name: "poolKey" as const, components: POOL_KEY_COMPONENTS },
      { type: "bool" as const, name: "zeroForOne" as const },
      { type: "uint128" as const, name: "amountIn" as const },
      { type: "uint128" as const, name: "amountOutMinimum" as const },
      { type: "bytes" as const, name: "hookData" as const },
    ],
  },
];

export const EXACT_OUTPUT_SINGLE_TYPE = [
  {
    type: "tuple" as const,
    components: [
      { type: "tuple" as const, name: "poolKey" as const, components: POOL_KEY_COMPONENTS },
      { type: "bool" as const, name: "zeroForOne" as const },
      { type: "uint128" as const, name: "amountOut" as const },
      { type: "uint128" as const, name: "amountInMaximum" as const },
      { type: "bytes" as const, name: "hookData" as const },
    ],
  },
];

// ─── Shared Types ────────────────────────────────────────────────────────────

export interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}
