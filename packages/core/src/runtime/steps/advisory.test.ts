/**
 * Advisory step tests
 */

import { describe, expect, test } from "bun:test";
import type { SpellIR } from "../../types/ir.js";
import type { Address } from "../../types/primitives.js";
import type { AdvisoryStep } from "../../types/steps.js";
import { InMemoryLedger, createContext } from "../context.js";
import { executeAdvisoryStep } from "./advisory.js";

function createSpell(): SpellIR {
  return {
    id: "spell",
    version: "1.0.0",
    meta: { name: "spell", created: Date.now(), hash: "hash" },
    aliases: [],
    assets: [],
    skills: [],
    advisors: [{ name: "risk", model: "anthropic:haiku", scope: "read-only" }],
    params: [],
    state: { persistent: {}, ephemeral: {} },
    steps: [],
    guards: [],
    triggers: [{ type: "manual" }],
  };
}

function createContextAndLedger() {
  const ctx = createContext({
    spell: createSpell(),
    vault: "0x0000000000000000000000000000000000000000" as Address,
    chain: 1,
  });
  const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);
  return { ctx, ledger };
}

describe("Advisory Step", () => {
  test("rejects invalid advisory output by default", async () => {
    const { ctx, ledger } = createContextAndLedger();
    const step: AdvisoryStep = {
      kind: "advisory",
      id: "advisory_reject",
      advisor: "risk",
      prompt: "score this",
      outputSchema: { type: "number", min: 0, max: 10 },
      outputBinding: "decision",
      timeout: 5,
      fallback: { kind: "literal", value: 0, type: "int" },
      dependsOn: [],
    };

    const result = await executeAdvisoryStep(step, ctx, ledger, async () => "not-a-number");
    expect(result.success).toBe(false);
    expect(result.error).toContain("violated schema");
  });

  test("supports explicit clamp policy and logs raw/effective outputs", async () => {
    const { ctx, ledger } = createContextAndLedger();
    const step: AdvisoryStep = {
      kind: "advisory",
      id: "advisory_clamp",
      advisor: "risk",
      prompt: "score this",
      context: {
        balance: { kind: "literal", value: 100, type: "int" },
      },
      policyScope: "constraints",
      outputSchema: { type: "number", min: 0, max: 10 },
      outputBinding: "decision",
      violationPolicy: "clamp",
      violationPolicyExplicit: true,
      clampConstraints: ["max_slippage"],
      timeout: 5,
      fallback: { kind: "literal", value: 0, type: "int" },
      dependsOn: [],
    };

    const result = await executeAdvisoryStep(step, ctx, ledger, async () => 100);
    expect(result.success).toBe(true);
    expect(result.rawOutput).toBe(100);
    expect(result.effectiveOutput).toBe(10);
    expect(result.clamped).toBe(true);
    expect(result.advisoryViolations?.length).toBeGreaterThan(0);
    expect(ctx.bindings.get("decision")).toBe(10);

    const completed = ledger
      .getEntries()
      .find((entry) => entry.event.type === "advisory_completed")?.event;
    if (!completed || completed.type !== "advisory_completed") {
      throw new Error("Missing advisory_completed event");
    }

    expect(completed.rawOutput).toBe(100);
    expect(completed.effectiveOutput).toBe(10);
    expect(completed.clamped).toBe(true);
    expect(completed.onViolation).toBe("clamp");
  });
});
