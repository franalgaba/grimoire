/**
 * Execution context tests
 */

import { describe, expect, test } from "bun:test";
import type { SpellIR } from "../types/ir.js";
import type { Address } from "../types/primitives.js";
import {
  addGasUsed,
  createContext,
  getBinding,
  getPersistentStateObject,
  incrementActions,
  incrementAdvisoryCalls,
  incrementErrors,
  incrementRetries,
  markStepExecuted,
  popFrame,
  pushFrame,
  setBinding,
  setEphemeralState,
  setPersistentState,
} from "./context.js";

function createMinimalSpell(overrides?: Partial<SpellIR>): SpellIR {
  return {
    id: "spell",
    version: "1.0.0",
    meta: {
      name: "spell",
      created: Date.now(),
      hash: "hash",
    },
    aliases: [],
    assets: [],
    skills: [],
    advisors: [],
    params: [{ name: "amount", type: "number", default: 5 }],
    state: {
      persistent: { counter: { key: "counter", initialValue: 1 } },
      ephemeral: { temp: { key: "temp", initialValue: 2 } },
    },
    steps: [],
    guards: [],
    triggers: [{ type: "manual" }],
    ...overrides,
  };
}

describe("Execution Context", () => {
  test("manages bindings and state", () => {
    const ctx = createContext({
      spell: createMinimalSpell(),
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
      params: { amount: 10 },
      persistentState: { counter: 3 },
    });

    expect(ctx.bindings.get("amount")).toBe(10);
    expect(ctx.state.persistent.get("counter")).toBe(3);
    expect(ctx.state.ephemeral.get("temp")).toBe(2);

    setBinding(ctx, "foo", 123);
    expect(getBinding(ctx, "foo")).toBe(123);

    setPersistentState(ctx, "counter", 9);
    setEphemeralState(ctx, "temp", 4);

    const persistent = getPersistentStateObject(ctx);
    expect(persistent.counter).toBe(9);
  });

  test("binds asset symbols as strings", () => {
    const ctx = createContext({
      spell: createMinimalSpell({
        assets: [
          { symbol: "ETH", chain: 1, address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" },
          { symbol: "USDC", chain: 1, address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
        ],
      }),
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
    });

    expect(ctx.bindings.get("ETH")).toBe("ETH");
    expect(ctx.bindings.get("USDC")).toBe("USDC");
  });

  test("binds assets array for loop iteration", () => {
    const ctx = createContext({
      spell: createMinimalSpell({
        assets: [
          { symbol: "USDC", chain: 1, address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
          { symbol: "DAI", chain: 1, address: "0x6B175474E89094C44Da98b954EedeAC495271d0F" },
        ],
      }),
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
    });

    const assets = ctx.bindings.get("assets");
    expect(Array.isArray(assets)).toBe(true);
    expect(assets).toEqual(["USDC", "DAI"]);
  });

  test("binds limits object from limit_ params", () => {
    const ctx = createContext({
      spell: createMinimalSpell({
        params: [
          { name: "limit_max_allocation", type: "number", default: 0.5 },
          { name: "limit_min_amount", type: "number", default: 100 },
          { name: "threshold", type: "number", default: 0.1 },
        ],
      }),
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
    });

    const limits = ctx.bindings.get("limits") as Record<string, unknown>;
    expect(limits).toBeDefined();
    expect(limits.max_allocation).toBe(0.5);
    expect(limits.min_amount).toBe(100);
    // Non-limit params should not appear in limits object
    expect(limits.threshold).toBeUndefined();
  });

  test("limits object uses runtime params over defaults", () => {
    const ctx = createContext({
      spell: createMinimalSpell({
        params: [{ name: "limit_max_allocation", type: "number", default: 0.5 }],
      }),
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
      params: { limit_max_allocation: 0.8 },
    });

    const limits = ctx.bindings.get("limits") as Record<string, unknown>;
    expect(limits.max_allocation).toBe(0.8);
  });

  test("no limits binding when no limit_ params exist", () => {
    const ctx = createContext({
      spell: createMinimalSpell(),
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
    });

    expect(ctx.bindings.get("limits")).toBeUndefined();
  });

  test("tracks metrics", () => {
    const ctx = createContext({
      spell: createMinimalSpell(),
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
    });

    markStepExecuted(ctx, "step_1");
    incrementActions(ctx);
    addGasUsed(ctx, 100n);
    incrementErrors(ctx);
    incrementRetries(ctx);
    incrementAdvisoryCalls(ctx);

    pushFrame(ctx, "step_1", 1, "then");
    const frame = popFrame(ctx);

    expect(frame?.stepId).toBe("step_1");
    expect(ctx.metrics.stepsExecuted).toBe(1);
    expect(ctx.metrics.actionsExecuted).toBe(1);
    expect(ctx.metrics.gasUsed).toBe(100n);
    expect(ctx.metrics.errors).toBe(1);
    expect(ctx.metrics.retries).toBe(1);
    expect(ctx.metrics.advisoryCalls).toBe(1);
  });
});
