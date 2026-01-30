/**
 * End-to-end tests for state persistence
 *
 * Validates the full lifecycle:
 *   compile spell → execute → persist → reload → re-execute → verify history/ledger
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compile } from "../compiler/index.js";
import type { SpellIR } from "../types/ir.js";
import type { Address } from "../types/primitives.js";
import { execute } from "./interpreter.js";
import { SqliteStateStore } from "./sqlite-state-store.js";
import { createRunRecord } from "./state-store.js";

let testDir: string;
let store: SqliteStateStore;

beforeEach(() => {
  testDir = join(tmpdir(), `grimoire-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  store = new SqliteStateStore({ dbPath: join(testDir, "grimoire.db") });
});

afterEach(() => {
  store.close();
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

const VAULT: Address = "0x0000000000000000000000000000000000000000";
const CHAIN = 1;

function compileSpell(source: string): SpellIR {
  const result = compile(source);
  if (!result.success || !result.ir) {
    throw new Error(`Compilation failed: ${result.errors.map((e) => e.message).join(", ")}`);
  }
  return result.ir;
}

describe("State persistence e2e", () => {
  test("full lifecycle: execute → persist → reload → re-execute", async () => {
    const spell = compileSpell(`
spell ComputeSpell

  version: "1.0.0"
  description: "Simple compute spell"

  params:
    increment: 10

  on manual:
    value = params.increment * 2
    emit computed(result=value)
`);

    // --- Run 1 ---
    const state1 = (await store.load(spell.id)) ?? {};
    const result1 = await execute({
      spell,
      vault: VAULT,
      chain: CHAIN,
      params: { increment: 10 },
      persistentState: state1,
      simulate: true,
    });

    expect(result1.success).toBe(true);

    // Persist
    await store.save(spell.id, result1.finalState);
    await store.addRun(spell.id, createRunRecord(result1));
    await store.saveLedger(spell.id, result1.runId, result1.ledgerEvents);

    // --- Run 2 ---
    const state2 = (await store.load(spell.id)) ?? {};

    const result2 = await execute({
      spell,
      vault: VAULT,
      chain: CHAIN,
      params: { increment: 20 },
      persistentState: state2,
      simulate: true,
    });

    expect(result2.success).toBe(true);

    // Persist run 2
    await store.save(spell.id, result2.finalState);
    await store.addRun(spell.id, createRunRecord(result2));
    await store.saveLedger(spell.id, result2.runId, result2.ledgerEvents);

    // --- Verify run history ---
    const runs = await store.getRuns(spell.id);
    expect(runs).toHaveLength(2);
    expect(runs[0].success).toBe(true);
    expect(runs[1].success).toBe(true);
    // Most recent first
    expect(runs[0].runId).toBe(result2.runId);
    expect(runs[1].runId).toBe(result1.runId);

    // --- Verify ledger for each run ---
    const ledger1 = await store.loadLedger(spell.id, result1.runId);
    expect(ledger1).not.toBeNull();
    expect(ledger1?.length).toBeGreaterThan(0);
    const runStarted1 = ledger1?.find((e) => e.event.type === "run_started");
    expect(runStarted1).toBeDefined();

    const ledger2 = await store.loadLedger(spell.id, result2.runId);
    expect(ledger2).not.toBeNull();
    expect(ledger2?.length).toBeGreaterThan(0);

    // --- Verify listSpells ---
    const spells = await store.listSpells();
    expect(spells).toContain(spell.id);
  });

  test("state survives store close and reopen", async () => {
    const dbPath = join(testDir, "grimoire.db");
    const spell = compileSpell(`
spell Accumulator

  version: "1.0.0"
  description: "Accumulator"

  on manual:
    x = 1 + 2
    emit done(value=x)
`);

    // Run 1 with first store instance
    const store1 = new SqliteStateStore({ dbPath });
    const result1 = await execute({
      spell,
      vault: VAULT,
      chain: CHAIN,
      simulate: true,
    });
    await store1.save(spell.id, result1.finalState);
    await store1.addRun(spell.id, createRunRecord(result1));
    store1.close();

    // Reopen store and verify state persisted
    const store2 = new SqliteStateStore({ dbPath });
    const loadedState = await store2.load(spell.id);
    expect(loadedState).toEqual(result1.finalState);

    // Run 2 with reopened store
    const result2 = await execute({
      spell,
      vault: VAULT,
      chain: CHAIN,
      persistentState: loadedState ?? {},
      simulate: true,
    });
    expect(result2.success).toBe(true);

    await store2.save(spell.id, result2.finalState);
    await store2.addRun(spell.id, createRunRecord(result2));

    const runs = await store2.getRuns(spell.id);
    expect(runs).toHaveLength(2);

    store2.close();
  });

  test("compute-only spell from spells/ directory", async () => {
    const spell = compileSpell(`
spell ComputeOnly

  version: "1.0.0"
  description: "Test spell with only compute steps"

  params:
    amount: 1000
    target_weight: 60
    current_weight: 50

  on manual:
    drift = params.target_weight - params.current_weight
    needs_rebalance = drift > 5 or drift < -5

    if needs_rebalance:
      rebalance_amount = params.amount * drift / 100
      fee_estimate = rebalance_amount * 3 / 1000
      emit rebalance_needed(drift=drift, amount=rebalance_amount, fee=fee_estimate)
    else:
      emit no_rebalance_needed(drift=drift)
`);

    const result = await execute({
      spell,
      vault: VAULT,
      chain: CHAIN,
      params: { amount: 1000, target_weight: 60, current_weight: 50 },
      simulate: true,
    });

    expect(result.success).toBe(true);

    // Persist and verify
    await store.save(spell.id, result.finalState);
    await store.addRun(spell.id, createRunRecord(result));
    await store.saveLedger(spell.id, result.runId, result.ledgerEvents);

    // Verify run record
    const runs = await store.getRuns(spell.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].success).toBe(true);
    expect(runs[0].metrics.stepsExecuted).toBeGreaterThan(0);

    // Verify ledger events
    const ledger = await store.loadLedger(spell.id, result.runId);
    expect(ledger).not.toBeNull();
    const completedEvents = ledger?.filter((e) => e.event.type === "step_completed");
    expect(completedEvents?.length).toBeGreaterThan(0);
  });

  test("failed execution is recorded correctly", async () => {
    // Create a spell with a guard that always fails by constructing IR directly
    const baseSpell = compileSpell(`
spell FailSpell

  version: "1.0.0"
  description: "Spell that will fail"

  on manual:
    x = 1
`);

    // Manually add a guard that always fails
    const spell: SpellIR = {
      ...baseSpell,
      guards: [
        {
          id: "always_fail",
          check: { kind: "literal", value: false, type: "bool" },
          severity: "halt",
          message: "Always fails",
        },
      ],
    };

    const result = await execute({
      spell,
      vault: VAULT,
      chain: CHAIN,
      simulate: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Always fails");

    // Persist the failure
    await store.save(spell.id, result.finalState);
    await store.addRun(spell.id, createRunRecord(result));
    await store.saveLedger(spell.id, result.runId, result.ledgerEvents);

    // Verify failure recorded
    const runs = await store.getRuns(spell.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].success).toBe(false);
    expect(runs[0].error).toContain("Always fails");
  });

  test("multiple spells tracked independently", async () => {
    const spellA = compileSpell(`
spell SpellAlpha

  version: "1.0.0"
  description: "Spell A"

  params:
    x: 100

  on manual:
    value = params.x * 2
    emit done(value=value)
`);

    const spellB = compileSpell(`
spell SpellBeta

  version: "1.0.0"
  description: "Spell B"

  params:
    y: 50

  on manual:
    count = params.y + 1
    emit done(count=count)
`);

    // Execute spell A
    const resultA = await execute({
      spell: spellA,
      vault: VAULT,
      chain: CHAIN,
      params: { x: 100 },
      simulate: true,
    });
    await store.save(spellA.id, resultA.finalState);
    await store.addRun(spellA.id, createRunRecord(resultA));

    // Execute spell B
    const resultB = await execute({
      spell: spellB,
      vault: VAULT,
      chain: CHAIN,
      params: { y: 50 },
      simulate: true,
    });
    await store.save(spellB.id, resultB.finalState);
    await store.addRun(spellB.id, createRunRecord(resultB));

    // Verify listSpells shows both
    const spells = await store.listSpells();
    expect(spells).toHaveLength(2);
    expect(spells).toContain(spellA.id);
    expect(spells).toContain(spellB.id);

    // Verify history is separate
    const runsA = await store.getRuns(spellA.id);
    const runsB = await store.getRuns(spellB.id);
    expect(runsA).toHaveLength(1);
    expect(runsB).toHaveLength(1);
    expect(runsA[0].runId).not.toBe(runsB[0].runId);
  });

  test("createRunRecord serializes bigint gasUsed correctly", async () => {
    const spell = compileSpell(`
spell GasTest

  version: "1.0.0"
  description: "Gas test"

  on manual:
    x = 42
`);

    const result = await execute({
      spell,
      vault: VAULT,
      chain: CHAIN,
      simulate: true,
    });

    const record = createRunRecord(result);

    // gasUsed should be a string, not bigint
    expect(typeof record.metrics.gasUsed).toBe("string");
    expect(record.metrics.gasUsed).toBe(result.metrics.gasUsed.toString());

    // Should survive JSON round-trip (bigint would throw)
    const json = JSON.stringify(record);
    const parsed = JSON.parse(json);
    expect(parsed.metrics.gasUsed).toBe(record.metrics.gasUsed);

    // Should persist and load from SQLite
    await store.addRun(spell.id, record);
    const runs = await store.getRuns(spell.id);
    expect(runs[0].metrics.gasUsed).toBe(record.metrics.gasUsed);
  });

  test("ledger serializes bigint values without errors", async () => {
    const spell = compileSpell(`
spell LedgerBigint

  version: "1.0.0"
  description: "Test ledger bigint serialization"

  on manual:
    x = 1 + 2
    emit done(value=x)
`);

    const result = await execute({
      spell,
      vault: VAULT,
      chain: CHAIN,
      simulate: true,
    });

    expect(result.success).toBe(true);

    // This should not throw even though ledger events may contain bigint metrics
    await store.saveLedger(spell.id, result.runId, result.ledgerEvents);

    const loaded = await store.loadLedger(spell.id, result.runId);
    expect(loaded).not.toBeNull();
    expect(loaded?.length).toBeGreaterThan(0);

    // Verify run_started and run_completed events present
    const types = loaded?.map((e) => e.event.type) ?? [];
    expect(types).toContain("run_started");
    expect(types).toContain("run_completed");
  });

  test("run pruning works across multiple executions", async () => {
    const dbPath = join(testDir, "prune-e2e.db");
    const pruningStore = new SqliteStateStore({ dbPath, maxRuns: 3 });

    const spell = compileSpell(`
spell PruneTest

  version: "1.0.0"
  description: "Pruning test"

  params:
    run_number: 0

  on manual:
    n = params.run_number
    emit run(number=n)
`);

    try {
      for (let i = 0; i < 5; i++) {
        const result = await execute({
          spell,
          vault: VAULT,
          chain: CHAIN,
          params: { run_number: i },
          simulate: true,
        });
        await pruningStore.save(spell.id, result.finalState);
        await pruningStore.addRun(spell.id, createRunRecord(result));
      }

      // Should only have 3 runs (pruned to maxRuns)
      const runs = await pruningStore.getRuns(spell.id);
      expect(runs).toHaveLength(3);
    } finally {
      pruningStore.close();
    }
  });

  test("persistentState is passed through to execution context", async () => {
    // Compile a spell with persistent state in the schema
    const baseSpell = compileSpell(`
spell StateCheck

  version: "1.0.0"
  description: "Verify state loading"

  on manual:
    x = 1
`);

    // Manually add persistent state to the IR (simulating a spell with state schema)
    const spell: SpellIR = {
      ...baseSpell,
      state: {
        persistent: {
          counter: { key: "counter", initialValue: 0 },
        },
        ephemeral: {},
      },
    };

    // First execution: no persisted state, uses schema default
    const result1 = await execute({
      spell,
      vault: VAULT,
      chain: CHAIN,
      persistentState: {},
      simulate: true,
    });
    expect(result1.success).toBe(true);
    expect(result1.finalState.counter).toBe(0);

    // Simulate persisting updated state externally
    await store.save(spell.id, { counter: 42 });

    // Load and pass to next execution
    const loaded = await store.load(spell.id);
    expect(loaded).toEqual({ counter: 42 });

    const result2 = await execute({
      spell,
      vault: VAULT,
      chain: CHAIN,
      persistentState: loaded ?? {},
      simulate: true,
    });
    expect(result2.success).toBe(true);
    // The persistent state should reflect the loaded value, not the schema default
    expect(result2.finalState.counter).toBe(42);
  });

  test("compileFile and execute real .spell file", async () => {
    // Use the actual compute-only.spell from the spells/ directory
    const { compileFile } = await import("../compiler/index.js");
    const compileResult = await compileFile("spells/compute-only.spell");

    expect(compileResult.success).toBe(true);
    expect(compileResult.ir).toBeDefined();

    const spell = compileResult.ir as SpellIR;

    const result = await execute({
      spell,
      vault: VAULT,
      chain: CHAIN,
      params: { amount: 2000, target_weight: 70, current_weight: 40 },
      simulate: true,
    });

    expect(result.success).toBe(true);

    // Full persistence round-trip
    await store.save(spell.id, result.finalState);
    await store.addRun(spell.id, createRunRecord(result));
    await store.saveLedger(spell.id, result.runId, result.ledgerEvents);

    // Verify everything was saved
    const runs = await store.getRuns(spell.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].success).toBe(true);

    const ledger = await store.loadLedger(spell.id, result.runId);
    expect(ledger).not.toBeNull();
    expect(ledger?.length).toBeGreaterThan(0);

    const spells = await store.listSpells();
    expect(spells).toContain(spell.id);
  });
});
