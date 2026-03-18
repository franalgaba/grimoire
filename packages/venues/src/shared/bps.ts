/**
 * Shared basis-point (BPS) utilities used across venue adapters.
 */

export const BPS_DENOMINATOR = 10_000n;

export function applyBps(amount: bigint, bps: number): bigint {
  return (amount * BigInt(bps)) / BPS_DENOMINATOR;
}
