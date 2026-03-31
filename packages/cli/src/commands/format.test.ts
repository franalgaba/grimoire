import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFormatCliArgs, runFormatCommand } from "./format.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

async function createTempSpell(content: string, fileName = "spell.spell"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "grimoire-format-test-"));
  tempDirs.push(dir);
  const filePath = join(dir, fileName);
  await writeFile(filePath, content, "utf8");
  return filePath;
}

describe("format command argument parsing", () => {
  test("parses check mode", () => {
    const parsed = parseFormatCliArgs(["foo.spell", "--check", "--diff"]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || "help" in parsed) return;
    expect(parsed.args.mode).toBe("check");
    expect(parsed.args.diff).toBe(true);
  });

  test("rejects --write with --check", () => {
    const parsed = parseFormatCliArgs(["foo.spell", "--write", "--check"]);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.code).toBe("ERR_FORMAT_USAGE");
  });
});

describe("runFormatCommand", () => {
  test("stdout mode returns formatted content", async () => {
    const spellPath = await createTempSpell(
      `spell Demo {\nversion:"1.0.0"\non manual:{\npass\n}\n}\n`
    );

    const run = await runFormatCommand({
      mode: "stdout",
      paths: [spellPath],
      diff: false,
      json: false,
    });

    expect(run.exitCode).toBe(0);
    expect(run.result.summary.changed).toBe(1);
    expect(run.stdout).toContain('version: "1.0.0"');
  });

  test("check mode exits 1 for non-canonical input", async () => {
    const spellPath = await createTempSpell(
      `spell Demo {\nversion:"1.0.0"\non manual:{\npass\n}\n}\n`
    );

    const run = await runFormatCommand({
      mode: "check",
      paths: [spellPath],
      diff: false,
      json: false,
    });

    expect(run.exitCode).toBe(1);
    expect(run.result.summary.changed).toBe(1);
  });

  test("write mode updates files", async () => {
    const spellPath = await createTempSpell(
      `spell Demo {\nversion:"1.0.0"\non manual:{\npass\n}\n}\n`
    );

    const run = await runFormatCommand({
      mode: "write",
      paths: [spellPath],
      diff: false,
      json: false,
    });

    expect(run.exitCode).toBe(0);

    const updated = await readFile(spellPath, "utf8");
    expect(updated).toContain('version: "1.0.0"');
    expect(updated).toContain("  on manual: {");
  });

  test("returns parse errors with exit code 2", async () => {
    const spellPath = await createTempSpell(`spell Broken {\nversion:\n`);

    const run = await runFormatCommand({
      mode: "check",
      paths: [spellPath],
      diff: false,
      json: false,
    });

    expect(run.exitCode).toBe(2);
    expect(run.result.summary.failed).toBe(1);
    expect(run.result.files[0]?.error?.code).toBe("ERR_FORMAT_PARSE");
  });

  test("treats empty files as parse errors (not IO errors)", async () => {
    const spellPath = await createTempSpell("");

    const run = await runFormatCommand({
      mode: "check",
      paths: [spellPath],
      diff: false,
      json: false,
    });

    expect(run.exitCode).toBe(2);
    expect(run.result.summary.failed).toBe(1);
    expect(run.result.files[0]?.error?.code).toBe("ERR_FORMAT_PARSE");
  });
});
