import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compile, type SpellIR } from "@grimoirelabs/core";

function assertIR(
  result: ReturnType<typeof compile>
): asserts result is { success: true; ir: SpellIR; errors: never[]; warnings: never[] } {
  if (!result.success || !result.ir) {
    throw new Error(
      `Expected successful compilation: ${result.errors.map((error) => error.message).join(", ")}`
    );
  }
}

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("CLI JSON output", () => {
  test("simulate --json exits cleanly with selected trigger output", async () => {
    const source = `spell CliJsonTrigger {
  version: "1.0.0"

  on condition 1 > 0 every 10: {
    emit threshold(direction="above", level=1)
  }

  on condition 1 > 0 every 10: {
    emit threshold(direction="below", level=2)
  }
}`;

    const compileResult = compile(source);
    assertIR(compileResult);

    const triggerId = compileResult.ir.triggerHandlers?.[1]?.selector.id;
    expect(triggerId).toBeDefined();

    const dir = await mkdtemp(join(tmpdir(), "grimoire-cli-json-"));
    tempDirs.push(dir);
    const spellPath = join(dir, "cli-json.spell");
    await writeFile(spellPath, source, "utf8");

    const proc = Bun.spawn({
      cmd: [
        "bun",
        "run",
        "packages/cli/src/index.ts",
        "--",
        "simulate",
        spellPath,
        "--json",
        "--noState",
        "--trigger-id",
        triggerId as string,
      ],
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("Cannot serialize BigInt");

    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(parsed.success).toBe(true);
    expect((parsed.selectedTrigger as Record<string, unknown> | undefined)?.id).toBe(triggerId);
    expect(parsed.events).toEqual([
      {
        name: "threshold",
        data: {
          direction: "below",
          level: 2,
        },
      },
    ]);
  });
});
