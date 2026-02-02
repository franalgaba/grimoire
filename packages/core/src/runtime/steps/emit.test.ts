/**
 * Emit step tests
 */

import { describe, expect, test } from "bun:test";
import type { SpellIR } from "../../types/ir.js";
import type { Address } from "../../types/primitives.js";
import type { EmitStep } from "../../types/steps.js";
import { InMemoryLedger, createContext } from "../context.js";
import { executeEmitStep } from "./emit.js";

function createSpell(overrides?: Partial<SpellIR>): SpellIR {
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
    ...overrides,
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

  test("resolves asset symbols in emit data", async () => {
    const ctx = createContext({
      spell: createSpell({
        assets: [
          { symbol: "ETH", chain: 1, address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" },
          { symbol: "USDC", chain: 1, address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
        ],
      }),
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
      params: { value: 5 },
    });
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);

    const step: EmitStep = {
      kind: "emit",
      id: "emit",
      event: "swap_done",
      data: {
        asset_in: { kind: "binding", name: "ETH" },
        asset_out: { kind: "binding", name: "USDC" },
        amount: { kind: "literal", value: 42, type: "int" },
      },
      dependsOn: [],
    };

    const result = await executeEmitStep(step, ctx, ledger);
    expect(result.success).toBe(true);
    expect(result.output).toEqual({
      event: "swap_done",
      data: { asset_in: "ETH", asset_out: "USDC", amount: 42 },
    });
  });

  test("resolves limits in emit data via property access", async () => {
    const ctx = createContext({
      spell: createSpell({
        params: [
          { name: "value", type: "number", default: 1 },
          { name: "limit_min_equity", type: "number", default: 100 },
        ],
      }),
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
      params: { value: 5, limit_min_equity: 100 },
    });
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);

    const step: EmitStep = {
      kind: "emit",
      id: "emit",
      event: "low_equity",
      data: {
        minimum: {
          kind: "property_access",
          object: { kind: "binding", name: "limits" },
          property: "min_equity",
        },
      },
      dependsOn: [],
    };

    const result = await executeEmitStep(step, ctx, ledger);
    expect(result.success).toBe(true);
    expect(result.output).toEqual({
      event: "low_equity",
      data: { minimum: 100 },
    });
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
