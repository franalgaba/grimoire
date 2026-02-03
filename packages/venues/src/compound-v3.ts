import type { VenueAdapter } from "@grimoirelabs/core";

export const compoundV3Adapter: VenueAdapter = {
  meta: {
    name: "compound_v3",
    supportedChains: [1, 10, 42161, 8453],
    actions: ["lend", "withdraw", "borrow", "repay"],
    description: "Compound V3 lending adapter",
  },
  async buildAction() {
    throw new Error("Compound V3 adapter not implemented yet");
  },
};
