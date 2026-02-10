import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compile } from "../compiler/index.js";
import type { SpellIR } from "../types/ir.js";
import type { Address } from "../types/primitives.js";
import { getSessionLedgerView, getSessionPnlView } from "./session-views.js";
import { runManagedSession, runOneShotSession } from "./session.js";
import { SqliteStateStore } from "./sqlite-state-store.js";
import type { RunRecord } from "./state-store.js";
import { FEE_BUCKET_ADDRESS } from "./value-flow.js";

const VAULT: Address = "0x0000000000000000000000000000000000000000";
const SPELL_ID = "session-view-spell";

let testDir: string;
let store: SqliteStateStore;

beforeEach(() => {
  testDir = join(tmpdir(), `grimoire-session-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  store = new SqliteStateStore({ dbPath: join(testDir, "session.db") });
});

afterEach(() => {
  store.close();
  rmSync(testDir, { recursive: true, force: true });
});

function assertIR(
  result: ReturnType<typeof compile>
): asserts result is { success: true; ir: SpellIR; errors: never[]; warnings: never[] } {
  if (!result.success || !result.ir) {
    throw new Error(result.errors.map((error) => error.message).join(", "));
  }
}

function makeRunRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: `run-${Math.random().toString(36).slice(2)}`,
    timestamp: new Date().toISOString(),
    success: true,
    duration: 50,
    metrics: {
      stepsExecuted: 1,
      actionsExecuted: 0,
      gasUsed: "0",
      advisoryCalls: 0,
      errors: 0,
      retries: 0,
    },
    finalState: {},
    ...overrides,
  };
}

describe("session runtime API", () => {
  test("uses one execution path for one-shot and managed runs", async () => {
    const source = `spell ManagedRun {
  version: "1.0.0"

  on hourly: {
    counter = 1
  }
}`;
    const compiled = compile(source);
    assertIR(compiled);

    const oneShot = await runOneShotSession({
      sessionId: "session-1",
      spell: compiled.ir,
      vault: VAULT,
      chain: 1,
      simulate: true,
      trigger: { type: "manual" },
    });

    const managed = await runManagedSession({
      sessionId: "session-1",
      spell: compiled.ir,
      vault: VAULT,
      chain: 1,
      simulate: true,
    });

    expect(oneShot.result.success).toBe(true);
    expect(managed.result.success).toBe(true);
    expect(oneShot.result.metrics.stepsExecuted).toBe(managed.result.metrics.stepsExecuted);

    const oneShotStarted = oneShot.result.ledgerEvents.find(
      (entry) => entry.event.type === "run_started"
    );
    const managedStarted = managed.result.ledgerEvents.find(
      (entry) => entry.event.type === "run_started"
    );

    if (!oneShotStarted || oneShotStarted.event.type !== "run_started") {
      throw new Error("Missing one-shot run_started event");
    }
    if (!managedStarted || managedStarted.event.type !== "run_started") {
      throw new Error("Missing managed run_started event");
    }

    expect(oneShotStarted.event.trigger).toMatchObject({
      type: "manual",
      sessionId: "session-1",
      mode: "one-shot",
    });
    expect(managedStarted.event.trigger).toMatchObject({
      type: "schedule",
      sessionId: "session-1",
      mode: "managed",
    });
  });
});

describe("session views", () => {
  test("aggregates session ledger and ledger-derived pnl", async () => {
    const runReady = makeRunRecord({ runId: "run-ready", success: true });
    const runRejected = makeRunRecord({ runId: "run-rejected", success: false, error: "rejected" });

    await store.addRun(SPELL_ID, runReady);
    await store.saveLedger(SPELL_ID, runReady.runId, [
      {
        id: "e1",
        timestamp: Date.now(),
        runId: runReady.runId,
        spellId: SPELL_ID,
        event: {
          type: "run_started",
          runId: runReady.runId,
          spellId: SPELL_ID,
          trigger: { type: "manual" },
        },
      },
      {
        id: "e2",
        timestamp: Date.now(),
        runId: runReady.runId,
        spellId: SPELL_ID,
        event: {
          type: "preview_completed",
          runId: runReady.runId,
          receiptId: "rcpt_ready",
          status: "ready",
        },
      },
      {
        id: "e3",
        timestamp: Date.now(),
        runId: runReady.runId,
        spellId: SPELL_ID,
        event: {
          type: "value_delta",
          delta: {
            asset: "USDC",
            amount: 100n,
            from: VAULT,
            to: "0x0000000000000000000000000000000000000001",
            reason: "swap:input",
          },
        },
      },
      {
        id: "e4",
        timestamp: Date.now(),
        runId: runReady.runId,
        spellId: SPELL_ID,
        event: {
          type: "value_delta",
          delta: {
            asset: "USDC",
            amount: 98n,
            from: "0x0000000000000000000000000000000000000001",
            to: VAULT,
            reason: "swap:output",
          },
        },
      },
      {
        id: "e5",
        timestamp: Date.now(),
        runId: runReady.runId,
        spellId: SPELL_ID,
        event: {
          type: "value_delta",
          delta: {
            asset: "USDC",
            amount: 2n,
            from: VAULT,
            to: FEE_BUCKET_ADDRESS,
            reason: "protocol_fee",
          },
        },
      },
    ]);

    await store.addRun(SPELL_ID, runRejected);
    await store.saveLedger(SPELL_ID, runRejected.runId, [
      {
        id: "e6",
        timestamp: Date.now(),
        runId: runRejected.runId,
        spellId: SPELL_ID,
        event: {
          type: "run_started",
          runId: runRejected.runId,
          spellId: SPELL_ID,
          trigger: { type: "schedule" },
        },
      },
      {
        id: "e7",
        timestamp: Date.now(),
        runId: runRejected.runId,
        spellId: SPELL_ID,
        event: {
          type: "preview_completed",
          runId: runRejected.runId,
          receiptId: "rcpt_rejected",
          status: "rejected",
        },
      },
    ]);

    const ledgerView = await getSessionLedgerView(store, SPELL_ID, 10);
    expect(ledgerView.runs.total).toBe(2);
    expect(ledgerView.runs.success).toBe(1);
    expect(ledgerView.runs.failed).toBe(1);
    expect(ledgerView.triggers.manual).toBe(1);
    expect(ledgerView.triggers.schedule).toBe(1);
    expect(ledgerView.receipts.ready).toBe(1);
    expect(ledgerView.receipts.rejected).toBe(1);
    expect(ledgerView.events.value_delta).toBe(3);

    const pnlView = await getSessionPnlView(store, SPELL_ID, 10);
    expect(pnlView.runCount).toBe(2);
    expect(pnlView.deltaCount).toBe(3);
    expect(pnlView.accountingPassed).toBe(true);
    expect(pnlView.totalUnaccounted).toBe("0");
    expect(pnlView.totalNet).toBe("-4");
    expect(pnlView.assets).toEqual([
      {
        asset: "USDC",
        debits: "100",
        credits: "98",
        fees: "2",
        losses: "0",
        net: "-4",
        unaccounted: "0",
      },
    ]);
  });
});
