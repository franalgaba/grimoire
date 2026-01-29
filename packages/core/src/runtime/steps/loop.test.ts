/**
 * Loop step tests
 */

import { describe, expect, test } from "bun:test";
import type { SpellIR } from "../../types/ir.js";
import type { Address } from "../../types/primitives.js";
import type { LoopStep } from "../../types/steps.js";
import { InMemoryLedger, createContext } from "../context.js";
import { executeLoopStep } from "./loop.js";

function createSpell(): SpellIR {
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
    params: [],
    state: { persistent: {}, ephemeral: {} },
    steps: [],
    guards: [],
    triggers: [{ type: "manual" }],
  };
}

describe("Loop Step", () => {
  test("executes repeat loop", async () => {
    const ctx = createContext({
      spell: createSpell(),
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
    });
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);

    const step: LoopStep = {
      kind: "loop",
      id: "loop_1",
      loopType: { type: "repeat", count: 2 },
      bodySteps: ["step_a"],
      maxIterations: 5,
      dependsOn: [],
    };

    const result = await executeLoopStep(step, ctx, ledger, async () => ({
      success: true,
      stepId: "step_a",
      output: { ok: true },
    }));

    expect(result.success).toBe(true);
    expect(result.iterations).toBe(2);
    expect(result.results.length).toBe(2);
  });

  test("executes for loop", async () => {
    const ctx = createContext({
      spell: createSpell(),
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
    });
    ctx.bindings.set("items", ["a", "b", "c"]);

    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);
    const step: LoopStep = {
      kind: "loop",
      id: "loop_2",
      loopType: {
        type: "for",
        variable: "item",
        source: { kind: "binding", name: "items" },
      },
      bodySteps: ["step_b"],
      maxIterations: 2,
      outputBinding: "loop_out",
      dependsOn: [],
    };

    const result = await executeLoopStep(step, ctx, ledger, async () => ({
      success: true,
      stepId: "step_b",
      output: { item: ctx.bindings.get("item") },
    }));

    expect(result.success).toBe(true);
    expect(result.iterations).toBe(2);
    expect(ctx.bindings.get("loop_out")).toBeDefined();
  });

  test("executes until loop", async () => {
    const ctx = createContext({
      spell: createSpell(),
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
    });
    ctx.bindings.set("stop", false);

    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);
    const step: LoopStep = {
      kind: "loop",
      id: "loop_3",
      loopType: {
        type: "until",
        condition: { kind: "binding", name: "stop" },
      },
      bodySteps: ["step_c"],
      maxIterations: 3,
      dependsOn: [],
    };

    let counter = 0;

    const result = await executeLoopStep(step, ctx, ledger, async () => {
      counter += 1;
      if (counter >= 2) {
        ctx.bindings.set("stop", true);
      }
      return {
        success: true,
        stepId: "step_c",
        output: { count: counter },
      };
    });

    expect(result.success).toBe(true);
    expect(result.iterations).toBe(2);
  });

  test("fails when for-loop source is not array", async () => {
    const ctx = createContext({
      spell: createSpell(),
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
    });
    ctx.bindings.set("items", 42);

    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);
    const step: LoopStep = {
      kind: "loop",
      id: "loop_4",
      loopType: {
        type: "for",
        variable: "item",
        source: { kind: "binding", name: "items" },
      },
      bodySteps: ["step_d"],
      maxIterations: 3,
      dependsOn: [],
    };

    const result = await executeLoopStep(step, ctx, ledger, async () => ({
      success: true,
      stepId: "step_d",
    }));

    expect(result.success).toBe(false);
  });
});
