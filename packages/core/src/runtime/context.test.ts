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

function createMinimalSpell(): SpellIR {
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
