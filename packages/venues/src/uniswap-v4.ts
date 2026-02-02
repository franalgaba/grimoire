import type { Action, Address, BuiltTransaction, VenueAdapterContext } from "@grimoire/core";
import type { VenueAdapter } from "@grimoire/core";
import tokenList from "@uniswap/default-token-list";
import { type Abi, encodeAbiParameters, encodeFunctionData, parseAbi } from "viem";

// ─── Constants ────────────────────────────────────────────────────────────────

const NATIVE_ETH = "0x0000000000000000000000000000000000000000" as Address;
const ZERO_HOOKS = "0x0000000000000000000000000000000000000000" as Address;
/** Universal Router maps this to msg.sender */
const MSG_SENDER = "0x0000000000000000000000000000000000000001" as Address;
const MAX_UINT160 = (1n << 160n) - 1n;
const MAX_UINT256 = (1n << 256n) - 1n;

/** Universal Router v2 addresses (V4-capable) */
export const DEFAULT_ROUTERS: Record<number, Address> = {
  1: "0x66a9893cc07d91d95644aedd05d03f95e1dba8af" as Address,
  10: "0x851116d9223fabed8e56c0e6b8ad0c31d98b3507" as Address,
  137: "0x1095692a6237d83c6a72f3f5efedb9a670c49223" as Address,
  8453: "0x6ff5693b99212da76ad316178a184ab56d299b43" as Address,
  42161: "0xa51afafe0263b40edaef0df8781ea9aa03e381a3" as Address,
};

/** V4 Quoter addresses */
const DEFAULT_QUOTERS: Record<number, Address> = {
  1: "0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203" as Address,
  8453: "0x0d5e0f971ed27fbff6c2837bf31316121532048d" as Address,
};

/** Permit2 (canonical across all chains) */
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address;

// ─── Universal Router Commands ────────────────────────────────────────────────

const Commands = {
  V4_SWAP: 0x10,
  SWEEP: 0x04,
} as const;

/** V4 Action byte values */
const Actions = {
  SWAP_EXACT_IN_SINGLE: 0x06,
  SWAP_EXACT_OUT_SINGLE: 0x08,
  SETTLE_ALL: 0x0c,
  TAKE_ALL: 0x0f,
} as const;

// ─── ABIs ─────────────────────────────────────────────────────────────────────

const UNIVERSAL_ROUTER_ABI = parseAbi([
  "function execute(bytes commands, bytes[] inputs, uint256 deadline) payable",
]);

const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

const PERMIT2_ABI = parseAbi([
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
  "function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
]);

/** JSON ABI for Quoter (nested struct requires explicit tuple definitions) */
const QUOTER_ABI = [
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

const POOL_KEY_COMPONENTS = [
  { type: "address" as const, name: "currency0" as const },
  { type: "address" as const, name: "currency1" as const },
  { type: "uint24" as const, name: "fee" as const },
  { type: "int24" as const, name: "tickSpacing" as const },
  { type: "address" as const, name: "hooks" as const },
];

const EXACT_INPUT_SINGLE_TYPE = [
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

const EXACT_OUTPUT_SINGLE_TYPE = [
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

// ─── Adapter ──────────────────────────────────────────────────────────────────

export interface UniswapV4AdapterConfig {
  routers?: Record<number, Address>;
  quoters?: Record<number, Address>;
  defaultFee?: number;
  defaultTickSpacing?: number;
  deadlineSeconds?: number;
  slippageBps?: number;
}

interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

export function createUniswapV4Adapter(config: UniswapV4AdapterConfig = {}): VenueAdapter {
  const routers = config.routers ?? DEFAULT_ROUTERS;
  const quoters = config.quoters ?? DEFAULT_QUOTERS;

  return {
    meta: {
      name: "uniswap_v4",
      supportedChains: Object.keys(routers).map((id) => Number.parseInt(id, 10)),
      actions: ["swap"],
      description: "Uniswap V4 swap adapter (Universal Router v2)",
    },

    async buildAction(action, ctx) {
      if (action.type !== "swap") {
        throw new Error(`Uniswap V4 adapter only supports swap actions (got ${action.type})`);
      }

      const router = routers[ctx.chainId];
      if (!router) {
        throw new Error(`No Universal Router configured for chain ${ctx.chainId}`);
      }

      const isNativeEthIn = action.assetIn?.toUpperCase() === "ETH";
      const isNativeEthOut = action.assetOut?.toUpperCase() === "ETH";

      // Resolve currency addresses (ETH = address(0) in V4)
      const currencyIn = isNativeEthIn
        ? NATIVE_ETH
        : resolveTokenAddress(action.assetIn, ctx.chainId);
      const currencyOut = isNativeEthOut
        ? NATIVE_ETH
        : resolveTokenAddress(action.assetOut, ctx.chainId);

      // Build PoolKey (currencies must be numerically sorted)
      const fee = config.defaultFee ?? 3000;
      const tickSpacing = config.defaultTickSpacing ?? 60;
      const [currency0, currency1] = sortCurrencies(currencyIn, currencyOut);
      const zeroForOne = currency0.toLowerCase() === currencyIn.toLowerCase();

      const poolKey: PoolKey = {
        currency0,
        currency1,
        fee,
        tickSpacing,
        hooks: ZERO_HOOKS,
      };

      const amount = toBigInt(action.amount);
      const isExactOut = action.mode === "exact_out";
      const slippageBps = action.constraints?.maxSlippageBps ?? config.slippageBps ?? 50;

      // Quote expected output/input via on-chain Quoter
      const quoter = quoters[ctx.chainId];
      let expectedAmount = amount; // fallback if no quoter

      if (quoter) {
        try {
          const quoteParams = {
            poolKey,
            zeroForOne,
            exactAmount: amount,
            hookData: "0x" as `0x${string}`,
          };

          if (isExactOut) {
            const result = await ctx.provider.readContract<readonly [bigint, bigint]>({
              address: quoter,
              abi: QUOTER_ABI as unknown as Abi,
              functionName: "quoteExactOutputSingle",
              args: [quoteParams],
            });
            expectedAmount = result[0]; // amountIn needed
          } else {
            const result = await ctx.provider.readContract<readonly [bigint, bigint]>({
              address: quoter,
              abi: QUOTER_ABI as unknown as Abi,
              functionName: "quoteExactInputSingle",
              args: [quoteParams],
            });
            expectedAmount = result[0]; // amountOut expected
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(
            `Failed to quote ${action.assetIn}/${action.assetOut} on V4 ` +
              `(fee=${fee}, tickSpacing=${tickSpacing}): ${msg}`
          );
        }
      }

      // Calculate amounts with slippage
      let amountOutMinimum: bigint;
      let settleAmount: bigint;

      if (isExactOut) {
        amountOutMinimum = amount;
        settleAmount = expectedAmount + (expectedAmount * BigInt(slippageBps)) / 10000n;
      } else {
        amountOutMinimum = expectedAmount - (expectedAmount * BigInt(slippageBps)) / 10000n;
        settleAmount = amount;
      }

      // Build the V4_SWAP encoded actions
      const v4Input = encodeV4SwapInput({
        poolKey,
        zeroForOne,
        amount,
        amountOutMinimum,
        settleAmount,
        isExactOut,
        currencyIn,
        currencyOut,
      });

      // Build Universal Router commands + inputs
      const deadline = Math.floor(Date.now() / 1000) + (config.deadlineSeconds ?? 1200);
      let commands: `0x${string}`;
      let inputs: `0x${string}`[];
      let txValue: bigint;

      if (isExactOut && isNativeEthIn) {
        // exact_out with native ETH: add SWEEP to refund excess
        commands =
          `0x${Commands.V4_SWAP.toString(16).padStart(2, "0")}${Commands.SWEEP.toString(16).padStart(2, "0")}` as `0x${string}`;
        const sweepInput = encodeAbiParameters(
          [{ type: "address" }, { type: "address" }, { type: "uint256" }],
          [NATIVE_ETH, MSG_SENDER, 0n]
        );
        inputs = [v4Input, sweepInput];
        txValue = settleAmount;
      } else {
        // Single V4_SWAP command
        commands = `0x${Commands.V4_SWAP.toString(16).padStart(2, "0")}` as `0x${string}`;
        inputs = [v4Input];
        txValue = isNativeEthIn ? settleAmount : 0n;
      }

      const calldata = encodeFunctionData({
        abi: UNIVERSAL_ROUTER_ABI,
        functionName: "execute",
        args: [commands, inputs, BigInt(deadline)],
      });

      // Build pre-swap transactions (Permit2 approvals for ERC20 input)
      const preTxs: BuiltTransaction[] = [];

      if (!isNativeEthIn) {
        const approvalTxs = await buildPermit2Approvals({
          ctx,
          token: currencyIn,
          router,
          amount: settleAmount,
          action,
        });
        preTxs.push(...approvalTxs);
      }

      // Build description
      const shortAddr = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;
      const descLines = [
        `Uniswap V4 swap ${action.assetIn} → ${action.assetOut}`,
        `  currencyIn:  ${action.assetIn} (${shortAddr(currencyIn)})`,
        `  currencyOut: ${action.assetOut} (${shortAddr(currencyOut)})`,
        `  amount:      ${amount.toString()} wei`,
        `  expected:    ~${expectedAmount.toString()} wei`,
        `  min output:  ${amountOutMinimum.toString()} wei (${slippageBps / 100}% slippage)`,
        `  fee tier:    ${fee / 10_000}%`,
        `  tickSpacing: ${tickSpacing}`,
        `  router:      ${shortAddr(router)}`,
      ].join("\n");

      return [
        ...preTxs,
        {
          tx: {
            to: router,
            data: calldata as `0x${string}`,
            value: txValue,
          },
          description: descLines,
          action,
        },
      ];
    },
  };
}

export const uniswapV4Adapter = createUniswapV4Adapter();

// ─── V4 Swap Encoding ────────────────────────────────────────────────────────

function encodeV4SwapInput(params: {
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

// ─── Permit2 Approval Flow ──────────────────────────────────────────────────

async function buildPermit2Approvals(params: {
  ctx: VenueAdapterContext;
  token: Address;
  router: Address;
  amount: bigint;
  action: Action;
}): Promise<BuiltTransaction[]> {
  const txs: BuiltTransaction[] = [];
  const { ctx, token, router, amount, action } = params;
  const client = ctx.provider.getClient?.();
  const assetLabel = action.type === "swap" ? action.assetIn : "token";

  // Step 1: ERC20 approve → Permit2
  let needsErc20Approval = true;
  if (client?.readContract) {
    try {
      const allowance = (await client.readContract({
        address: token,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [ctx.walletAddress, PERMIT2],
      })) as bigint;
      needsErc20Approval = allowance < amount;
    } catch {
      /* can't check — assume needed */
    }
  }

  if (needsErc20Approval) {
    txs.push({
      tx: {
        to: token,
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "approve",
          args: [PERMIT2, MAX_UINT256],
        }),
        value: 0n,
      },
      description: `Approve ${assetLabel} for Permit2`,
      action,
    });
  }

  // Step 2: Permit2 approve → Universal Router
  let needsPermit2Approval = true;
  if (client?.readContract) {
    try {
      const result = (await client.readContract({
        address: PERMIT2,
        abi: PERMIT2_ABI,
        functionName: "allowance",
        args: [ctx.walletAddress, token, router],
      })) as unknown as readonly [bigint, number, number]; // [amount, expiration, nonce]
      const permit2Amount = result[0];
      const expiration = Number(result[1]);
      const now = Math.floor(Date.now() / 1000);
      needsPermit2Approval = permit2Amount < amount || expiration <= now;
    } catch {
      /* can't check — assume needed */
    }
  }

  if (needsPermit2Approval) {
    const futureExpiration = Math.floor(Date.now() / 1000) + 86400 * 30; // 30 days
    txs.push({
      tx: {
        to: PERMIT2,
        data: encodeFunctionData({
          abi: PERMIT2_ABI,
          functionName: "approve",
          args: [token, router, MAX_UINT160, futureExpiration],
        }),
        value: 0n,
      },
      description: `Approve Universal Router on Permit2 for ${assetLabel}`,
      action,
    });
  }

  return txs;
}

// ─── Token Resolution ─────────────────────────────────────────────────────────

/** WETH addresses per chain */
const WETH_BY_CHAIN: Record<number, Address> = {
  1: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address,
  10: "0x4200000000000000000000000000000000000006" as Address,
  137: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619" as Address,
  8453: "0x4200000000000000000000000000000000000006" as Address,
  42161: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1" as Address,
};

/** Build a symbol+chain index from the Uniswap default token list */
const tokenIndex = new Map<string, { address: string; decimals: number }>();
for (const t of tokenList.tokens) {
  tokenIndex.set(`${t.symbol.toUpperCase()}:${t.chainId}`, {
    address: t.address,
    decimals: t.decimals,
  });
}

function resolveTokenAddress(asset: string, chainId: number): Address {
  if (asset.startsWith("0x") && asset.length === 42) {
    return asset as Address;
  }

  const symbol = asset.toUpperCase();

  // WETH → ERC20 wrapped ether (not native ETH)
  if (symbol === "WETH") {
    const weth = WETH_BY_CHAIN[chainId];
    if (!weth) throw new Error(`No WETH address for chain ${chainId}`);
    return weth;
  }

  const entry = tokenIndex.get(`${symbol}:${chainId}`);
  if (entry) return entry.address as Address;

  throw new Error(`Unknown asset: ${asset} on chain ${chainId}. Provide address directly.`);
}

function sortCurrencies(a: Address, b: Address): [Address, Address] {
  const aNum = BigInt(a);
  const bNum = BigInt(b);
  return aNum < bNum ? [a, b] : [b, a];
}

function toBigInt(amount: unknown): bigint {
  if (typeof amount === "bigint") return amount;
  if (typeof amount === "number") return BigInt(Math.floor(amount));
  if (typeof amount === "string") return BigInt(amount);
  if (isLiteralAmount(amount)) return BigInt(amount.value);
  throw new Error("Unsupported amount type for swap");
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
