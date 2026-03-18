import type { Action, Address, BuiltTransaction, VenueAdapterContext } from "@grimoirelabs/core";
import { encodeFunctionData } from "viem";
import { ERC20_ABI, MAX_UINT160, MAX_UINT256, PERMIT2, PERMIT2_ABI } from "./constants.js";

/** 30 days in seconds */
const PERMIT2_EXPIRATION_SECONDS = 86400 * 30;

// ─── Permit2 Approval Flow ──────────────────────────────────────────────────

export async function buildPermit2Approvals(params: {
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
      })) as readonly [bigint, number, number]; // [amount, expiration, nonce]
      const permit2Amount = result[0];
      const expiration = Number(result[1]);
      const now = Math.floor(Date.now() / 1000);
      needsPermit2Approval = permit2Amount < amount || expiration <= now;
    } catch {
      /* can't check — assume needed */
    }
  }

  if (needsPermit2Approval) {
    const futureExpiration = Math.floor(Date.now() / 1000) + PERMIT2_EXPIRATION_SECONDS;
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
