import type { Action, VenueAdapterMeta, VenueConstraint } from "@grimoirelabs/core";

export function getActiveConstraints(action: Action): VenueConstraint[] {
  const constraints = action.constraints;
  if (!constraints) return [];

  const active: VenueConstraint[] = [];
  if (constraints.maxSlippageBps !== undefined) active.push("max_slippage");
  if (constraints.minOutput !== undefined) active.push("min_output");
  if (constraints.maxInput !== undefined) active.push("max_input");
  if (constraints.deadline !== undefined) active.push("deadline");
  if (constraints.maxPriceImpactBps !== undefined) active.push("max_price_impact");
  if (constraints.minLiquidity !== undefined) active.push("min_liquidity");
  if (constraints.requireQuote !== undefined) active.push("require_quote");
  if (constraints.requireSimulation !== undefined) active.push("require_simulation");
  if (constraints.maxGas !== undefined) active.push("max_gas");
  return active;
}

export function assertSupportedConstraints(meta: VenueAdapterMeta, action: Action): void {
  const supported = new Set(meta.supportedConstraints);
  for (const constraint of getActiveConstraints(action)) {
    if (supported.has(constraint)) continue;
    throw new Error(
      `Adapter '${meta.name}' does not support constraint '${constraint}' for action '${action.type}'`
    );
  }
}
