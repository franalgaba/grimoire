/**
 * Action step tests
 */

import { describe, expect, test } from "bun:test";
import type { SpellIR } from "../../types/ir.js";
import type { Address } from "../../types/primitives.js";
import type { ActionStep } from "../../types/steps.js";
import type { Executor } from "../../wallet/executor.js";
import { InMemoryLedger, createContext } from "../context.js";
import { executeActionStep } from "./action.js";

function createSpell(): SpellIR {
  return {
    id: "spell",
    version: "1.0.0",
    meta: {
      name: "spell",
      created: Date.now(),
      hash: "hash",
    },
    aliases: [{ alias: "aave", chain: 1, address: "0x0000000000000000000000000000000000000001" }],
    assets: [
      {
        symbol: "USDC",
        chain: 1,
        address: "0x0000000000000000000000000000000000000002",
        decimals: 6,
      },
    ],
    skills: [],
    advisors: [],
    params: [],
    state: { persistent: {}, ephemeral: {} },
    steps: [],
    guards: [],
    triggers: [{ type: "manual" }],
  };
}

describe("Action Step", () => {
  test("simulates action and records ledger", async () => {
    const step: ActionStep = {
      kind: "action",
      id: "action_1",
      action: {
        type: "transfer",
        asset: "USDC",
        amount: { kind: "literal", value: 100, type: "int" },
        to: "0x0000000000000000000000000000000000000003",
      },
      constraints: {},
      dependsOn: [],
      onFailure: "revert",
    };

    const ctx = createContext({
      spell: createSpell(),
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
    });
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);

    const result = await executeActionStep(step, ctx, ledger, { mode: "simulate" });

    expect(result.success).toBe(true);
    expect(ctx.metrics.actionsExecuted).toBe(1);

    const simulated = ledger.getEntries().find((entry) => entry.event.type === "action_simulated");
    expect(simulated).toBeDefined();
  });

  test("resolves bridge chain from params", async () => {
    const step: ActionStep = {
      kind: "action",
      id: "action_bridge",
      action: {
        type: "bridge",
        venue: "across",
        asset: "USDC",
        amount: { kind: "literal", value: 10, type: "int" },
        toChain: { kind: "param", name: "destination_chain" },
      },
      constraints: {},
      dependsOn: [],
      onFailure: "revert",
    };

    const spell = {
      ...createSpell(),
      params: [{ name: "destination_chain", type: "number" as const, default: 10 }],
    };

    const ctx = createContext({
      spell,
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
      params: { destination_chain: 10 },
    });
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);

    const result = await executeActionStep(step, ctx, ledger, { mode: "simulate" });
    expect(result.success).toBe(true);

    const simulated = ledger.getEntries().find((entry) => entry.event.type === "action_simulated");
    if (!simulated || simulated.event.type !== "action_simulated") {
      throw new Error("Missing simulated action event");
    }

    expect(simulated.event.action.type).toBe("bridge");
    if (simulated.event.action.type === "bridge") {
      expect(simulated.event.action.toChain).toBe(10);
    }
  });

  test("executes action through executor", async () => {
    const step: ActionStep = {
      kind: "action",
      id: "action_2",
      action: {
        type: "transfer",
        asset: "USDC",
        amount: { kind: "literal", value: "50", type: "string" },
        to: "0x0000000000000000000000000000000000000003",
      },
      constraints: {},
      dependsOn: [],
      outputBinding: "tx",
      onFailure: "revert",
    };

    const ctx = createContext({
      spell: createSpell(),
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
    });
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);

    const executor = {
      executeAction: async () => ({
        success: true,
        hash: "0xabc",
        receipt: {
          hash: "0xabc",
          blockNumber: 1n,
          blockHash: "0xdef",
          gasUsed: 21000n,
          effectiveGasPrice: 100n,
          status: "success",
          logs: [],
        },
        gasUsed: 21000n,
        builtTx: { tx: {}, description: "", action: step.action },
      }),
    } as unknown as Executor;

    const result = await executeActionStep(step, ctx, ledger, {
      mode: "execute",
      executor,
    });

    expect(result.success).toBe(true);
    expect(ctx.bindings.get("tx")).toBeDefined();
    expect(ctx.metrics.gasUsed).toBe(21000n);
  });

  test("fails when executor missing", async () => {
    const step: ActionStep = {
      kind: "action",
      id: "action_3",
      action: {
        type: "transfer",
        asset: "USDC",
        amount: { kind: "literal", value: 10, type: "int" },
        to: "0x0000000000000000000000000000000000000003",
      },
      constraints: {},
      dependsOn: [],
      onFailure: "revert",
    };

    const ctx = createContext({
      spell: createSpell(),
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
    });
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);

    const result = await executeActionStep(step, ctx, ledger, { mode: "execute" });
    expect(result.success).toBe(false);
  });
});
