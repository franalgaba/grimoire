/**
 * Compute step tests
 */

import { describe, expect, test } from "bun:test";
import type { SpellIR } from "../../types/ir.js";
import type { Address } from "../../types/primitives.js";
import type { ComputeStep } from "../../types/steps.js";
import { InMemoryLedger, createContext } from "../context.js";
import { executeComputeStep } from "./compute.js";

function createSpell(): SpellIR {
  return {
    id: "spell",
    version: "1.0.0",
    meta: { name: "spell", created: Date.now(), hash: "hash" },
    aliases: [],
    assets: [],
    skills: [],
    advisors: [],
    params: [{ name: "value", type: "number", default: 2 }],
    state: { persistent: {}, ephemeral: {} },
    steps: [],
    guards: [],
    triggers: [{ type: "manual" }],
  };
}

describe("Compute Step", () => {
  test("computes assignments", async () => {
    const ctx = createContext({
      spell: createSpell(),
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
      params: { value: 3 },
    });
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);

    const step: ComputeStep = {
      kind: "compute",
      id: "compute",
      assignments: [
        { variable: "x", expression: { kind: "param", name: "value" } },
        { variable: "y", expression: { kind: "literal", value: 4n, type: "int" } },
      ],
      dependsOn: [],
    };

    const result = await executeComputeStep(step, ctx, ledger);
    expect(result.success).toBe(true);
    expect(ctx.bindings.get("x")).toBe(3);
    expect(ctx.bindings.get("y")).toBe(4n);
  });

  test("handles compute errors", async () => {
    const ctx = createContext({
      spell: createSpell(),
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
    });
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);

    const step: ComputeStep = {
      kind: "compute",
      id: "compute",
      assignments: [{ variable: "x", expression: { kind: "binding", name: "missing" } }],
      dependsOn: [],
    };

    const result = await executeComputeStep(step, ctx, ledger);
    expect(result.success).toBe(false);
  });
});
