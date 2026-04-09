import { describe, expect, test } from "bun:test";
import type { SpellIR } from "@grimoirelabs/core";
import { buildCastCrossChainInput } from "./cast.js";

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

describe("buildCastCrossChainInput", () => {
  test("resolves selectedTrigger before cross-chain cast execution", () => {
    const input = buildCastCrossChainInput({
      sourceSpellPath: "source.spell",
      sourceSpell: createMockSpell("source"),
      sourceChainId: 1,
      params: { foo: "bar" },
      options: {
        destinationSpell: "destination.spell",
        destinationChain: "10",
        handoffTimeoutSec: "60",
        triggerIndex: "2",
      },
      noState: true,
      mode: "simulate",
      hasKey: false,
      dataPolicy: { replayMode: "off", dataMaxAgeSec: 3600, onStale: "warn" },
      replayResolution: { params: { foo: "bar" }, replayUsed: false },
    });

    expect(input.selectedTrigger).toEqual({ index: 2 });
  });
});
