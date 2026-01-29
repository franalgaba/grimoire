/**
 * Emit step tests
 */

import { describe, expect, test } from "bun:test";
import type { SpellIR } from "../../types/ir.js";
import type { Address } from "../../types/primitives.js";
import type { EmitStep } from "../../types/steps.js";
import { InMemoryLedger, createContext } from "../context.js";
import { executeEmitStep } from "./emit.js";

function createSpell(): SpellIR {
  return {
    id: "spell",
    version: "1.0.0",
    meta: { name: "spell", created: Date.now(), hash: "hash" },
    aliases: [],
    assets: [],
    skills: [],
    advisors: [],
    params: [{ name: "value", type: "number", default: 1 }],
    state: { persistent: {}, ephemeral: {} },
    steps: [],
    guards: [],
    triggers: [{ type: "manual" }],
  };
}

describe("Emit Step", () => {
  test("emits event data", async () => {
    const ctx = createContext({
      spell: createSpell(),
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
      params: { value: 5 },
    });
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);

    const step: EmitStep = {
      kind: "emit",
      id: "emit",
      event: "event",
      data: {
        value: { kind: "param", name: "value" },
        big: { kind: "literal", value: 10n, type: "int" },
      },
      dependsOn: [],
    };

    const result = await executeEmitStep(step, ctx, ledger);
    expect(result.success).toBe(true);

    const completed = ledger.getEntries().find((entry) => entry.event.type === "step_completed");
    expect(completed).toBeDefined();
  });

  test("handles emit errors", async () => {
    const ctx = createContext({
      spell: createSpell(),
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
    });
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);

    const step: EmitStep = {
      kind: "emit",
      id: "emit",
      event: "event",
      data: {
        value: { kind: "binding", name: "missing" },
      },
      dependsOn: [],
    };

    const result = await executeEmitStep(step, ctx, ledger);
    expect(result.success).toBe(false);
  });
});
