/**
 * Conditional step tests
 */

import { describe, expect, test } from "bun:test";
import type { SpellIR } from "../../types/ir.js";
import type { Address } from "../../types/primitives.js";
import type { ConditionalStep } from "../../types/steps.js";
import { InMemoryLedger, createContext } from "../context.js";
import { executeConditionalStep } from "./conditional.js";

function createSpell(): SpellIR {
  return {
    id: "spell",
    version: "1.0.0",
    meta: { name: "spell", created: Date.now(), hash: "hash" },
    aliases: [],
    assets: [],
    skills: [],
    advisors: [],
    params: [{ name: "flag", type: "bool", default: true }],
    state: { persistent: {}, ephemeral: {} },
    steps: [],
    guards: [],
    triggers: [{ type: "manual" }],
  };
}

describe("Conditional Step", () => {
  test("selects then branch", async () => {
    const ctx = createContext({
      spell: createSpell(),
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
      params: { flag: true },
    });
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);

    const step: ConditionalStep = {
      kind: "conditional",
      id: "cond",
      condition: { kind: "param", name: "flag" },
      thenSteps: ["step_then"],
      elseSteps: ["step_else"],
      dependsOn: [],
    };

    const result = await executeConditionalStep(step, ctx, ledger);
    expect(result.success).toBe(true);
    expect(result.branchSteps).toEqual(["step_then"]);
  });

  test("selects else branch", async () => {
    const spell = createSpell();
    spell.params = [{ name: "flag", type: "bool", default: false }];

    const ctx = createContext({
      spell,
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
    });
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);

    const step: ConditionalStep = {
      kind: "conditional",
      id: "cond",
      condition: { kind: "param", name: "flag" },
      thenSteps: ["step_then"],
      elseSteps: ["step_else"],
      dependsOn: [],
    };

    const result = await executeConditionalStep(step, ctx, ledger);
    expect(result.success).toBe(true);
    expect(result.branchSteps).toEqual(["step_else"]);
  });
});
