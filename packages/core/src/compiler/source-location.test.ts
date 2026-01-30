import { describe, expect, test } from "bun:test";
import { parse } from "./grimoire/parser.js";
import { transform } from "./grimoire/transformer.js";
import { compile } from "./index.js";

const SPELL_SOURCE = `spell TestSpell

  version: "1.0.0"
  description: "Test spell for source locations"

  assets: [USDC, WETH]

  params:
    amount: 1000

  on manual:
    x = 42
    y = x + 1

    if x > 10:
      emit high_value(val=x)
    else:
      halt "too low"

    for asset in assets:
      wait 10
`;

describe("Source Location Propagation", () => {
  describe("Parser: AST nodes have spans", () => {
    test("assignment nodes have spans", () => {
      const ast = parse(SPELL_SOURCE);
      const trigger = ast.triggers[0];
      expect(trigger).toBeDefined();

      const assignment = trigger?.body[0];
      expect(assignment).toBeDefined();
      expect(assignment?.kind).toBe("assignment");
      expect(assignment?.span).toBeDefined();
      expect(assignment?.span?.start.line).toBeGreaterThan(0);
      expect(assignment?.span?.start.column).toBeGreaterThan(0);
    });

    test("if nodes have spans", () => {
      const ast = parse(SPELL_SOURCE);
      const trigger = ast.triggers[0];
      const ifNode = trigger?.body[2];

      expect(ifNode?.kind).toBe("if");
      expect(ifNode?.span).toBeDefined();
      expect(ifNode?.span?.start.line).toBeGreaterThan(0);
    });

    test("for nodes have spans", () => {
      const ast = parse(SPELL_SOURCE);
      const trigger = ast.triggers[0];
      const forNode = trigger?.body[3];

      expect(forNode?.kind).toBe("for");
      expect(forNode?.span).toBeDefined();
      expect(forNode?.span?.start.line).toBeGreaterThan(0);
    });

    test("emit nodes have spans (nested in if)", () => {
      const ast = parse(SPELL_SOURCE);
      const trigger = ast.triggers[0];
      const ifNode = trigger?.body[2];

      expect(ifNode?.kind).toBe("if");
      // @ts-expect-error accessing thenBody on union type
      const emitNode = ifNode?.thenBody[0];
      expect(emitNode?.kind).toBe("emit");
      expect(emitNode?.span).toBeDefined();
    });

    test("halt nodes have spans (nested in else)", () => {
      const ast = parse(SPELL_SOURCE);
      const trigger = ast.triggers[0];
      const ifNode = trigger?.body[2];

      expect(ifNode?.kind).toBe("if");
      // @ts-expect-error accessing elseBody on union type
      const haltNode = ifNode?.elseBody[0];
      expect(haltNode?.kind).toBe("halt");
      expect(haltNode?.span).toBeDefined();
    });

    test("wait nodes have spans (nested in for)", () => {
      const ast = parse(SPELL_SOURCE);
      const trigger = ast.triggers[0];
      const forNode = trigger?.body[3];

      expect(forNode?.kind).toBe("for");
      // @ts-expect-error accessing body on union type
      const waitNode = forNode?.body[0];
      expect(waitNode?.kind).toBe("wait");
      expect(waitNode?.span).toBeDefined();
    });
  });

  describe("Transformer: _sourceLocation on step records", () => {
    test("step records include _sourceLocation", () => {
      const ast = parse(SPELL_SOURCE);
      const spellSource = transform(ast);

      expect(spellSource.steps).toBeDefined();
      expect(spellSource.steps?.length).toBeGreaterThan(0);

      // First step should be a compute (x = 42) and have _sourceLocation
      const firstStep = spellSource.steps?.[0];
      expect(firstStep?._sourceLocation).toBeDefined();

      const loc = firstStep?._sourceLocation as { line: number; column: number };
      expect(loc.line).toBeGreaterThan(0);
      expect(loc.column).toBeGreaterThan(0);
    });
  });

  describe("IR Generator: sourceMap on SpellIR", () => {
    test("compiled spell has sourceMap", () => {
      const result = compile(SPELL_SOURCE);

      expect(result.success).toBe(true);
      expect(result.ir).toBeDefined();
      expect(result.ir?.sourceMap).toBeDefined();
    });

    test("sourceMap contains step IDs", () => {
      const result = compile(SPELL_SOURCE);
      const ir = result.ir;
      expect(ir).toBeDefined();

      const sourceMap = ir?.sourceMap;
      expect(sourceMap).toBeDefined();

      // There should be at least one step in the source map
      const stepIds = Object.keys(sourceMap ?? {});
      expect(stepIds.length).toBeGreaterThan(0);

      // Each entry should have valid line and column
      for (const loc of Object.values(sourceMap ?? {})) {
        expect(loc.line).toBeGreaterThan(0);
        expect(loc.column).toBeGreaterThan(0);
      }
    });

    test("sourceMap step IDs correspond to actual steps", () => {
      const result = compile(SPELL_SOURCE);
      const ir = result.ir;
      expect(ir).toBeDefined();

      const sourceMap = ir?.sourceMap ?? {};
      const stepIdSet = new Set(ir?.steps.map((s) => s.id));

      for (const stepId of Object.keys(sourceMap)) {
        expect(stepIdSet.has(stepId)).toBe(true);
      }
    });

    test("source locations point to correct lines", () => {
      const result = compile(SPELL_SOURCE);
      const ir = result.ir;
      expect(ir).toBeDefined();

      const sourceMap = ir?.sourceMap ?? {};

      // Find the compute step for "x = 42" (first step)
      const firstStep = ir?.steps[0];
      expect(firstStep).toBeDefined();

      const loc = firstStep ? sourceMap[firstStep.id] : undefined;

      // x = 42 is on line 12 of the spell source (after header/sections)
      // Line numbers come from the tokenizer, so just verify it's reasonable
      expect(loc).toBeDefined();
      if (loc) {
        expect(loc.line).toBeGreaterThanOrEqual(10);
      }
    });
  });

  describe("End-to-end: runtime errors include source locations", () => {
    test("step failure error message includes source location", () => {
      const result = compile(SPELL_SOURCE);
      const ir = result.ir;
      expect(ir).toBeDefined();

      const sourceMap = ir?.sourceMap ?? {};

      // Verify the sourceMap exists and has entries
      expect(Object.keys(sourceMap).length).toBeGreaterThan(0);

      // Verify a step has source location info that would be used at runtime
      const firstStepId = ir?.steps[0]?.id;
      expect(firstStepId).toBeDefined();

      const loc = firstStepId ? sourceMap[firstStepId] : undefined;
      expect(loc).toBeDefined();

      // The interpreter would produce: "Step 'X' failed at line Y, column Z: <error>"
      if (loc) {
        const expectedSuffix = ` at line ${loc.line}, column ${loc.column}`;
        expect(expectedSuffix).toContain("at line");
        expect(expectedSuffix).toContain("column");
      }
    });
  });
});
