import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { triggersCommand } from "./triggers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("triggersCommand", () => {
  test("lists stable trigger selectors for multi-handler spells", async () => {
    const source = `spell TriggerDiscovery {
  version: "1.0.0"

  on condition 1 > 0 every 10: {
    emit above(level=1)
  }

  on event Alert: {
    emit below(level=2)
  }
}`;

    const dir = await mkdtemp(join(tmpdir(), "grimoire-triggers-"));
    tempDirs.push(dir);
    const spellPath = join(dir, "trigger-discovery.spell");
    await writeFile(spellPath, source, "utf8");

    const result = await triggersCommand(spellPath, { suppressOutput: true });

    expect(result.success).toBe(true);
    expect(result.spell.name).toBe("TriggerDiscovery");
    expect(result.triggers).toHaveLength(2);
    expect(result.triggers[0]).toMatchObject({
      index: 0,
      label: "condition",
      source: { line: 4, column: 3 },
      stepCount: 1,
    });
    expect(result.triggers[0]?.id).toMatch(/^trg_[0-9a-f]{12}$/);
    expect(result.triggers[1]).toMatchObject({
      index: 1,
      label: "event(Alert)",
      source: { line: 8, column: 3 },
      stepCount: 1,
      trigger: { type: "event", event: "Alert" },
    });
  });
});
