/**
 * Wait step tests
 */

import { describe, expect, test } from "bun:test";
import type { SpellIR } from "../../types/ir.js";
import type { Address } from "../../types/primitives.js";
import type { WaitStep } from "../../types/steps.js";
import { InMemoryLedger, createContext } from "../context.js";
import { executeWaitStep } from "./wait.js";

function createSpell(): SpellIR {
  return {
    id: "spell",
    version: "1.0.0",
    meta: { name: "spell", created: Date.now(), hash: "hash" },
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

describe("Wait Step", () => {
  test("waits for duration", async () => {
    const ctx = createContext({
      spell: createSpell(),
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
    });
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);

    const step: WaitStep = {
      kind: "wait",
      id: "wait",
      duration: 0,
      dependsOn: [],
    };

    const result = await executeWaitStep(step, ctx, ledger);
    expect(result.success).toBe(true);
  });
});
