import { describe, expect, test } from "bun:test";
import { createProvider, type SpellIR } from "@grimoirelabs/core";
import { buildCrossChainCastExecuteOptions } from "./cast-cross-chain.js";

function createMockSpell(id: string): SpellIR {
  return {
    id,
    version: "1.0.0",
    meta: {
      name: id,
      created: Date.now(),
      hash: `${id}-hash`,
    },
    aliases: [],
    assets: [],
    skills: [],
    advisors: [],
    params: [],
    state: {
      persistent: {},
      ephemeral: {},
    },
    steps: [],
    guards: [],
    triggers: [],
  };
}

describe("buildCrossChainCastExecuteOptions", () => {
  test("includes selectedTrigger in per-chain execution options", () => {
    const options = buildCrossChainCastExecuteOptions({
      spell: createMockSpell("source"),
      runId: "run-1",
      vault: "0x0000000000000000000000000000000000000000",
      chain: 1,
      params: { foo: "bar" },
      persistentState: {},
      mode: "simulate",
      wallet: undefined,
      provider: createProvider(1, "https://example.test"),
      gasMultiplier: 1.1,
      confirmCallback: async () => true,
      skipTestnetConfirmation: false,
      configuredAdapters: [],
      advisorSkillsDirs: [],
      onAdvisory: undefined,
      eventCallback: undefined,
      warningCallback: () => {},
      selectedTrigger: { label: "manual" },
      trackId: "destination",
      role: "destination",
      morphoMarketIds: {},
    });

    expect(options.selectedTrigger).toEqual({ label: "manual" });
    expect(options.crossChain).toMatchObject({
      trackId: "destination",
      role: "destination",
    });
  });
});
