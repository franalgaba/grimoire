import { describe, expect, test } from "bun:test";
import type { SpellIR } from "@grimoirelabs/core";
import { buildSimulateCrossChainInput } from "./simulate.js";

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

describe("buildSimulateCrossChainInput", () => {
  test("resolves selectedTrigger before cross-chain execution", () => {
    const input = buildSimulateCrossChainInput({
      io: {
        log: () => {},
        exit: ((code?: number) => {
          throw new Error(`exit(${code ?? 0})`);
        }) as typeof process.exit,
      },
      terminate: (code: number) => {
        throw new Error(`terminate(${code})`);
      },
      sourceSpellPath: "source.spell",
      sourceSpell: createMockSpell("source"),
      sourceChainId: 1,
      params: { foo: "bar" },
      options: {
        destinationSpell: "destination.spell",
        destinationChain: "10",
        handoffTimeoutSec: "60",
        triggerId: "trg_source",
      },
      noState: true,
    });

    expect(input.selectedTrigger).toEqual({ id: "trg_source" });
  });
});
