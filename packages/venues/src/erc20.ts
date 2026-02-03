import type { Action, Address, BuiltTransaction, VenueAdapterContext } from "@grimoirelabs/core";
import { encodeFunctionData, parseAbi } from "viem";

const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

interface ApprovalRequest {
  ctx: VenueAdapterContext;
  token: Address;
  spender: Address;
  amount: bigint;
  action: Action;
  description: string;
}

export async function buildApprovalIfNeeded(request: ApprovalRequest): Promise<BuiltTransaction[]> {
  if (request.amount <= 0n) {
    return [];
  }

  const needsApproval = await hasInsufficientAllowance(request);
  if (!needsApproval) {
    return [];
  }

  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "approve",
    args: [request.spender, request.amount],
  });

  return [
    {
      tx: {
        to: request.token,
        data,
        value: 0n,
      },
      description: request.description,
      action: request.action,
    },
  ];
}

async function hasInsufficientAllowance(request: ApprovalRequest): Promise<boolean> {
  const client = request.ctx.provider.getClient?.();
  if (!client?.readContract) {
    return true;
  }

  try {
    const allowance = (await client.readContract({
      address: request.token,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [request.ctx.walletAddress, request.spender],
    })) as bigint;

    return allowance < request.amount;
  } catch {
    return true;
  }
}
