/**
 * Integration tests for full compilation pipeline
 */

import { describe, expect, test } from "bun:test";
import type { WaitStep } from "../../types/steps.js";
import { compile } from "../index.js";
import { parse } from "./parser.js";
import { transform } from "./transformer.js";

import { compileGrimoire, parseGrimoire } from "./index.js";

describe("Module exports", () => {
  test("parseGrimoire returns SpellSource", () => {
    const source = `spell Test

  version: "1.0.0"

  on manual:
    x = 1
`;
    const result = parseGrimoire(source);
    expect(result.spell).toBe("Test");
    expect(result.version).toBe("1.0.0");
  });

  test("compileGrimoire returns CompilationResult", () => {
    const source = `spell Test

  version: "1.0.0"

  on manual:
    x = 1
`;
    const result = compileGrimoire(source);
    expect(result.success).toBe(true);
    expect(result.ir).toBeDefined();
  });

  test("compileGrimoire returns errors for invalid source", () => {
    const source = "spell";
    const result = compileGrimoire(source);
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("compileGrimoire catches parse exceptions", () => {
    // This should trigger an error in parsing
    const result = compileGrimoire("spell @invalid");
    expect(result.success).toBe(false);
    expect(result.errors[0]?.code).toBe("GRIMOIRE_PARSE_ERROR");
  });

  test("compileGrimoire handles IR generation errors", () => {
    // Spell that parses but has invalid expression for IR generation
    const source = `spell Test

  version: "1.0.0"

  on manual:
    x = unknown_function()
`;
    const result = compileGrimoire(source);
    // Should either succeed or fail with IR error
    if (!result.success) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });
});

describe("Integration", () => {
  describe("parse → transform", () => {
    test("transforms simple spell to SpellSource", () => {
      const source = `spell TestSpell

  version: "1.0.0"
  description: "A test spell"

  on manual:
    x = 42
    emit result(value=x)
`;
      const ast = parse(source);
      const spellSource = transform(ast);

      expect(spellSource.spell).toBe("TestSpell");
      expect(spellSource.version).toBe("1.0.0");
      expect(spellSource.description).toBe("A test spell");
      expect(spellSource.trigger).toEqual({ manual: true });
      expect(spellSource.steps).toBeDefined();
      expect(spellSource.steps?.length).toBeGreaterThan(0);
    });

    test("transforms spell with assets", () => {
      const source = `spell AssetSpell

  version: "1.0.0"
  assets: [USDC, USDT]

  on manual:
    pass
`;
      const ast = parse(source);
      const spellSource = transform(ast);

      const assets = spellSource.assets ?? {};
      expect(Object.keys(assets)).toEqual(["USDC", "USDT"]);
    });

    test("transforms spell with params", () => {
      const source = `spell ParamSpell

  version: "1.0.0"
  params:
    amount: 100
    threshold: 0.5

  on manual:
    pass
`;
      const ast = parse(source);
      const spellSource = transform(ast);

      expect(spellSource.params).toBeDefined();
      expect(spellSource.params?.amount).toBe(100);
      expect(spellSource.params?.threshold).toBe(0.5);
    });

    test("transforms spell with venues", () => {
      const source = `spell VenueSpell

  version: "1.0.0"
  venues:
    lending: [@aave_v3, @morpho]
    swap: @uniswap

  on manual:
    pass
`;
      const ast = parse(source);
      const spellSource = transform(ast);

      expect(spellSource.venues).toBeDefined();
      expect(spellSource.venues?.aave_v3).toBeDefined();
      expect(spellSource.venues?.morpho).toBeDefined();
      expect(spellSource.venues?.uniswap).toBeDefined();
    });

    test("transforms hourly trigger", () => {
      const source = `spell HourlySpell

  version: "1.0.0"

  on hourly:
    pass
`;
      const ast = parse(source);
      const spellSource = transform(ast);

      expect(spellSource.trigger).toEqual({ schedule: "0 * * * *" });
    });

    test("transforms daily trigger", () => {
      const source = `spell DailySpell

  version: "1.0.0"

  on daily:
    pass
`;
      const ast = parse(source);
      const spellSource = transform(ast);

      expect(spellSource.trigger).toEqual({ schedule: "0 0 * * *" });
    });
  });

  describe("full compilation", () => {
    test("compiles minimal spell to IR", () => {
      const source = `spell MinimalSpell

  version: "1.0.0"

  on manual:
    x = 42
`;
      const result = compile(source);

      expect(result.success).toBe(true);
      expect(result.ir).toBeDefined();
      expect(result.ir?.id).toBe("MinimalSpell");
      expect(result.ir?.version).toBe("1.0.0");
    });

    test("compiles spell with compute step", () => {
      const source = `spell ComputeSpell

  version: "1.0.0"

  on manual:
    x = 10 + 20
    y = x * 2
`;
      const result = compile(source);

      expect(result.success).toBe(true);
      expect(result.ir?.steps.length).toBe(2);
      expect(result.ir?.steps[0]?.kind).toBe("compute");
    });

    test("compiles spell with conditional", () => {
      const source = `spell ConditionalSpell

  version: "1.0.0"

  on manual:
    if x > 10:
      y = 1
    else:
      y = 0
`;
      const result = compile(source);

      expect(result.success).toBe(true);
      // Should have conditional step and compute steps
      const conditionalStep = result.ir?.steps.find((s) => s.kind === "conditional");
      expect(conditionalStep).toBeDefined();
    });

    test("compiles spell with loop", () => {
      const source = `spell LoopSpell

  version: "1.0.0"

  on manual:
    for item in items:
      x = item
`;
      const result = compile(source);

      expect(result.success).toBe(true);
      const loopStep = result.ir?.steps.find((s) => s.kind === "loop");
      expect(loopStep).toBeDefined();
    });

    test("compiles spell with emit", () => {
      const source = `spell EmitSpell

  version: "1.0.0"

  on manual:
    emit done(value=42)
`;
      const result = compile(source);

      expect(result.success).toBe(true);
      const emitStep = result.ir?.steps.find((s) => s.kind === "emit");
      expect(emitStep).toBeDefined();
    });

    test("compiles spell with wait", () => {
      const source = `spell WaitSpell

  version: "1.0.0"

  on manual:
    wait 60
`;
      const result = compile(source);

      expect(result.success).toBe(true);
      const waitStep = result.ir?.steps.find((s) => s.kind === "wait") as WaitStep | undefined;
      expect(waitStep).toBeDefined();
      expect(waitStep?.duration).toBe(60);
    });

    test("compiles spell with halt", () => {
      const source = `spell HaltSpell

  version: "1.0.0"

  on manual:
    halt "stopped"
`;
      const result = compile(source);

      expect(result.success).toBe(true);
      const haltStep = result.ir?.steps.find((s) => s.kind === "halt");
      expect(haltStep).toBeDefined();
    });
  });

  describe("error handling", () => {
    test("returns error for invalid syntax", () => {
      const source = "spell";
      const result = compile(source);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test("returns error for missing spell body", () => {
      const source = "spell Test";
      const result = compile(source);

      expect(result.success).toBe(false);
    });
  });

  describe("complete spell examples", () => {
    test("compiles yield optimizer spell", () => {
      const source = `spell YieldOptimizer

  version: "1.0.0"
  assets: [USDC, DAI]

  params:
    min_amount: 100

  limits:
    max_per_venue: 50%

  venues:
    lending: [@aave_v3, @compound]

  on hourly:
    x = params.min_amount * 2
    if x > 100:
      emit rebalance(value=x)
`;
      const result = compile(source);

      expect(result.success).toBe(true);
      expect(result.ir).toBeDefined();
      expect(result.ir?.assets.length).toBe(2);
      expect(result.ir?.params.length).toBeGreaterThan(0);
      expect(result.ir?.aliases.length).toBe(2);
    });
  });
});
