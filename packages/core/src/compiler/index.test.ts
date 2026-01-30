/**
 * Compiler index tests
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compile, compileFile, parseSpell, parseSpellFile } from "./index.js";

const spellSource = `spell TestSpell

  version: "1.0.0"

  on manual:
    x = 1
`;

describe("Compiler index", () => {
  test("parseSpell returns SpellSource", () => {
    const result = parseSpell(spellSource);
    expect(result.success).toBe(true);
    expect(result.source?.spell).toBe("TestSpell");
  });

  test("parseSpell returns error on invalid", () => {
    const result = parseSpell("spell");
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("compile returns IR", () => {
    const result = compile(spellSource);
    expect(result.success).toBe(true);
    expect(result.ir?.meta.name).toBe("TestSpell");
  });

  test("parseSpellFile and compileFile read from disk", async () => {
    const dir = mkdtempSync(join(tmpdir(), "grimoire-compiler-"));
    const filePath = join(dir, "spell.spell");
    writeFileSync(filePath, spellSource, "utf-8");

    try {
      const parsed = await parseSpellFile(filePath);
      expect(parsed.success).toBe(true);

      const compiled = await compileFile(filePath);
      expect(compiled.success).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("compiles atomic block to TryStep IR", () => {
    const source = `spell AtomicTest

  version: "1.0.0"

  on manual:
    atomic:
      x = 1
      y = 2
`;
    const result = compile(source);
    expect(result.success).toBe(true);

    const tryStep = result.ir?.steps.find((s) => s.kind === "try");
    expect(tryStep).toBeDefined();
    if (tryStep?.kind === "try") {
      expect(tryStep.trySteps.length).toBe(2);
      expect(tryStep.catchBlocks.length).toBe(1);
      expect(tryStep.catchBlocks[0].errorType).toBe("*");
      expect(tryStep.catchBlocks[0].action).toBe("rollback");
    }
  });

  test("handles file read errors", async () => {
    const missingPath = join(tmpdir(), "missing.spell");

    const parsed = await parseSpellFile(missingPath);
    expect(parsed.success).toBe(false);

    const compiled = await compileFile(missingPath);
    expect(compiled.success).toBe(false);
  });
});
