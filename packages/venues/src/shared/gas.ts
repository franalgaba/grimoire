/**
 * Shared gas estimation utility used across venue adapters.
 */

import type { Address, BuiltTransaction, VenueAdapterContext } from "@grimoirelabs/core";

/**
 * Estimate gas for a transaction if the provider supports it.
 * Returns undefined if the provider lacks gas estimation or if estimation fails.
 */
export async function estimateGasIfSupported(
  ctx: VenueAdapterContext,
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
