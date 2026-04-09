import { describe, expect, test } from "bun:test";
import { createProvider, type SpellIR } from "@grimoirelabs/core";
import { buildCrossChainSimulationExecuteOptions } from "./simulate-cross-chain.js";

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

describe("buildCrossChainSimulationExecuteOptions", () => {
  test("includes selectedTrigger in per-chain execution options", () => {
    const options = buildCrossChainSimulationExecuteOptions({
      spell: createMockSpell("source"),
      runId: "run-1",
      vault: "0x0000000000000000000000000000000000000000",
      chain: 1,
      params: { foo: "bar" },
      persistentState: {},
      provider: createProvider(1, "https://example.test"),
      advisorSkillsDirs: [],
      onAdvisory: undefined,
      eventCallback: undefined,
      warningCallback: () => {},
      selectedTrigger: { index: 1 },
      trackId: "source",
      role: "source",
      morphoMarketIds: {},
    });

    expect(options.selectedTrigger).toEqual({ index: 1 });
    expect(options.crossChain).toMatchObject({
      trackId: "source",
      role: "source",
    });
  });
});
