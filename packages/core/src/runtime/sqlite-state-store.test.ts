import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LedgerEntry } from "../types/execution.js";
import { SqliteStateStore } from "./sqlite-state-store.js";
import type { RunRecord } from "./state-store.js";

let store: SqliteStateStore;
let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `grimoire-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  store = new SqliteStateStore({ dbPath: join(testDir, "test.db") });
});

afterEach(() => {
  store.close();
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
});

function makeRunRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: `run-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    timestamp: new Date().toISOString(),
    success: true,
    duration: 1000,
    metrics: {
      stepsExecuted: 3,
      actionsExecuted: 1,
      gasUsed: "21000",
      advisoryCalls: 0,
      errors: 0,
      retries: 0,
    },
    finalState: { counter: 1 },
    ...overrides,
  };
}

function makeLedgerEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: `entry-${Date.now()}`,
    timestamp: Date.now(),
    runId: "run-1",
    spellId: "test-spell",
    event: {
      type: "run_started",
      runId: "run-1",
      spellId: "test-spell",
      trigger: { type: "manual" },
    },
    ...overrides,
  };
}

describe("SqliteStateStore", () => {
  describe("load/save", () => {
    test("returns null for non-existent spell", async () => {
      const state = await store.load("nonexistent");
      expect(state).toBeNull();
    });

    test("save and load round-trip", async () => {
      await store.save("my-spell", { counter: 42, name: "test" });
      const state = await store.load("my-spell");
      expect(state).toEqual({ counter: 42, name: "test" });
    });

    test("save overwrites previous state", async () => {
      await store.save("my-spell", { counter: 1 });
      await store.save("my-spell", { counter: 2, extra: true });
      const state = await store.load("my-spell");
      expect(state).toEqual({ counter: 2, extra: true });
    });

    test("handles empty state object", async () => {
      await store.save("my-spell", {});
      const state = await store.load("my-spell");
      expect(state).toEqual({});
    });
  });

  describe("addRun/getRuns", () => {
    test("addRun and getRuns round-trip", async () => {
      const run = makeRunRecord({ runId: "run-1", success: true, duration: 500 });
      await store.addRun("my-spell", run);

      const runs = await store.getRuns("my-spell");
      expect(runs).toHaveLength(1);
      expect(runs[0].runId).toBe("run-1");
      expect(runs[0].success).toBe(true);
      expect(runs[0].duration).toBe(500);
    });

    test("getRuns returns most recent first", async () => {
      await store.addRun("my-spell", makeRunRecord({ runId: "run-1" }));
      await store.addRun("my-spell", makeRunRecord({ runId: "run-2" }));
      await store.addRun("my-spell", makeRunRecord({ runId: "run-3" }));

      const runs = await store.getRuns("my-spell");
      expect(runs[0].runId).toBe("run-3");
      expect(runs[1].runId).toBe("run-2");
      expect(runs[2].runId).toBe("run-1");
    });

    test("getRuns respects limit", async () => {
      for (let i = 0; i < 10; i++) {
        await store.addRun("my-spell", makeRunRecord({ runId: `run-${i}` }));
      }

      const runs = await store.getRuns("my-spell", 3);
      expect(runs).toHaveLength(3);
    });

    test("preserves error field on failed run", async () => {
      const run = makeRunRecord({ success: false, error: "something broke" });
      await store.addRun("my-spell", run);

      const runs = await store.getRuns("my-spell");
      expect(runs[0].success).toBe(false);
      expect(runs[0].error).toBe("something broke");
    });

    test("returns empty array for spell with no runs", async () => {
      const runs = await store.getRuns("no-such-spell");
      expect(runs).toEqual([]);
    });

    test("preserves metrics through round-trip", async () => {
      const metrics = {
        stepsExecuted: 10,
        actionsExecuted: 4,
        gasUsed: "99999",
        advisoryCalls: 2,
        errors: 1,
        retries: 3,
      };
      await store.addRun("my-spell", makeRunRecord({ metrics }));

      const runs = await store.getRuns("my-spell");
      expect(runs[0].metrics).toEqual(metrics);
    });

    test("preserves provenance through round-trip", async () => {
      await store.addRun(
        "my-spell",
        makeRunRecord({
          runId: "run-provenance",
          provenance: {
            schema_version: "grimoire.runtime.provenance.v1",
            chain_id: 8453,
            input_params_hash: "sha256:test",
          },
        })
      );

      const runs = await store.getRuns("my-spell");
      expect(runs[0].runId).toBe("run-provenance");
      expect(runs[0].provenance).toEqual({
        schema_version: "grimoire.runtime.provenance.v1",
        chain_id: 8453,
        input_params_hash: "sha256:test",
      });
    });
  });

  describe("run pruning", () => {
    test("prunes old runs beyond maxRuns", async () => {
      const smallStore = new SqliteStateStore({
        dbPath: join(testDir, "prune.db"),
        maxRuns: 5,
      });

      try {
        for (let i = 0; i < 10; i++) {
          await smallStore.addRun("my-spell", makeRunRecord({ runId: `run-${i}` }));
        }

        const runs = await smallStore.getRuns("my-spell");
        expect(runs).toHaveLength(5);
        // Most recent runs should be kept
        expect(runs[0].runId).toBe("run-9");
        expect(runs[4].runId).toBe("run-5");
      } finally {
        smallStore.close();
      }
    });
  });

  describe("ledger", () => {
    test("saveLedger and loadLedger round-trip", async () => {
      const entries = [makeLedgerEntry({ id: "e1" }), makeLedgerEntry({ id: "e2" })];

      await store.saveLedger("my-spell", "run-1", entries);
      const loaded = await store.loadLedger("my-spell", "run-1");

      expect(loaded).toHaveLength(2);
      expect(loaded?.[0].id).toBe("e1");
      expect(loaded?.[1].id).toBe("e2");
    });

    test("returns null for non-existent ledger", async () => {
      const result = await store.loadLedger("no-spell", "no-run");
      expect(result).toBeNull();
    });

    test("saveLedger overwrites existing entries", async () => {
      await store.saveLedger("my-spell", "run-1", [makeLedgerEntry({ id: "e1" })]);
      await store.saveLedger("my-spell", "run-1", [
        makeLedgerEntry({ id: "e2" }),
        makeLedgerEntry({ id: "e3" }),
      ]);

      const loaded = await store.loadLedger("my-spell", "run-1");
      expect(loaded).toHaveLength(2);
      expect(loaded?.[0].id).toBe("e2");
    });
  });

  describe("listSpells", () => {
    test("returns empty array when no spells saved", async () => {
      const spells = await store.listSpells();
      expect(spells).toEqual([]);
    });

    test("returns spell IDs with saved state", async () => {
      await store.save("spell-a", { x: 1 });
      await store.save("spell-b", { y: 2 });

      const spells = await store.listSpells();
      expect(spells).toEqual(["spell-a", "spell-b"]);
    });

    test("returns sorted spell IDs", async () => {
      await store.save("zebra", {});
      await store.save("alpha", {});
      await store.save("middle", {});

      const spells = await store.listSpells();
      expect(spells).toEqual(["alpha", "middle", "zebra"]);
    });
  });

  describe("auto-creation", () => {
    test("works with new database (auto-creates tables)", async () => {
      const freshStore = new SqliteStateStore({
        dbPath: join(testDir, "fresh.db"),
      });

      try {
        // All operations should work on a fresh db
        expect(await freshStore.load("x")).toBeNull();
        expect(await freshStore.getRuns("x")).toEqual([]);
        expect(await freshStore.loadLedger("x", "y")).toBeNull();
        expect(await freshStore.listSpells()).toEqual([]);

        await freshStore.save("x", { val: 1 });
        expect(await freshStore.load("x")).toEqual({ val: 1 });
      } finally {
        freshStore.close();
      }
    });
  });
});
