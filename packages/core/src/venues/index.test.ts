/**
 * Venue registry tests
 */

import { describe, expect, test } from "bun:test";
import { createVenueRegistry } from "./index.js";
import type { VenueAdapter } from "./types.js";

const adapter: VenueAdapter = {
  meta: {
    name: "test",
    supportedChains: [1],
    actions: ["swap"],
    executionType: "offchain",
  },
  async executeAction() {
    return { id: "ok" };
  },
};

describe("Venue Registry", () => {
  test("registers and retrieves adapters", () => {
    const registry = createVenueRegistry();
    registry.register(adapter);

    expect(registry.get("test")).toBe(adapter);
    expect(registry.list()).toHaveLength(1);
  });

  test("registers all adapters", () => {
    const registry = createVenueRegistry();
    registry.registerAll([adapter]);

    expect(registry.list()[0]?.name).toBe("test");
  });
});
