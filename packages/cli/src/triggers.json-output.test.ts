import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("CLI trigger discovery output", () => {
  test("triggers --json returns trigger handler ids", async () => {
    const source = `spell CliTriggerDiscovery {
  version: "1.0.0"

  on condition 1 > 0 every 10: {
    emit above(level=1)
  }

  on condition 1 > 0 every 10: {
    emit below(level=2)
  }
}`;

    const dir = await mkdtemp(join(tmpdir(), "grimoire-trigger-json-"));
    tempDirs.push(dir);
    const spellPath = join(dir, "cli-trigger-json.spell");
    await writeFile(spellPath, source, "utf8");

    const proc = Bun.spawn({
      cmd: ["bun", "run", "packages/cli/src/index.ts", "--", "triggers", spellPath, "--json"],
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
    expect(stderr).not.toContain("Failed");

    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(parsed.success).toBe(true);
    const triggers = parsed.triggers as Array<Record<string, unknown>>;
    expect(triggers).toHaveLength(2);
    expect(triggers[0]?.id).toMatch(/^trg_[0-9a-f]{12}$/);
    expect(triggers[1]?.id).toMatch(/^trg_[0-9a-f]{12}$/);
    expect(triggers[0]?.id).not.toBe(triggers[1]?.id);
  });
});
