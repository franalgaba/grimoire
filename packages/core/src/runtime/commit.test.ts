/**
 * Commit function tests (SPEC-004 Phase 1)
 */

import { describe, expect, test } from "bun:test";
import type { Receipt } from "../types/receipt.js";
import { commit } from "./interpreter.js";

function createMockReceipt(overrides?: Partial<Receipt>): Receipt {
  return {
    id: "rcpt_test-001",
    spellId: "TestSpell",
    phase: "preview",
    timestamp: Date.now(),
    chainContext: {
      chainId: 1,
      vault: "0x0000000000000000000000000000000000000000",
    },
    guardResults: [],
    advisoryResults: [],
    plannedActions: [],
    valueDeltas: [],
    constraintResults: [],
    driftKeys: [],
    requiresApproval: false,
    status: "ready",
    metrics: {
      stepsExecuted: 1,
      actionsExecuted: 0,
      gasUsed: 0n,
      advisoryCalls: 0,
      errors: 0,
      retries: 0,
    },
    finalState: {},
    ...overrides,
  };
}

function createMockWallet() {
  return {
    address: "0x0000000000000000000000000000000000000001" as const,
    chainId: 1,
    signTransaction: async () => "0x" as const,
    signMessage: async () => "0x" as const,
    sendTransaction: async () => ({
      hash: "0x",
      blockNumber: 0n,
      blockHash: "0x",
      gasUsed: 0n,
      effectiveGasPrice: 0n,
      status: "success" as const,
      logs: [],
    }),
  };
}

describe("commit()", () => {
  test("fails when receipt status is 'rejected'", async () => {
    const receipt = createMockReceipt({ status: "rejected" });

    const result = await commit({
      receipt,
      wallet: createMockWallet(),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("status is 'rejected'");
    expect(result.receiptId).toBe("rcpt_test-001");
  });

  test("fails when receipt status is 'expired'", async () => {
    const receipt = createMockReceipt({ status: "expired" });

    const result = await commit({
      receipt,
      wallet: createMockWallet(),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("status is 'expired'");
  });

  test("fails when receipt is expired (maxAge)", async () => {
    const receipt = createMockReceipt({
      timestamp: Date.now() - 120_000, // 2 minutes ago
    });

    const result = await commit({
      receipt,
      wallet: createMockWallet(),
      driftPolicy: { maxAge: 60 }, // 60 second max age
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Receipt expired");
    expect(result.error).toContain("maxAge");
  });

  test("succeeds with empty planned actions", async () => {
    const receipt = createMockReceipt();

    const result = await commit({
      receipt,
      wallet: createMockWallet(),
    });

    expect(result.success).toBe(true);
    expect(result.receiptId).toBe("rcpt_test-001");
    expect(result.transactions).toHaveLength(0);
    expect(result.driftChecks).toHaveLength(0);
  });

  test("performs drift checks on drift keys", async () => {
    const receipt = createMockReceipt({
      driftKeys: [
        { field: "balance", previewValue: 1000n, timestamp: Date.now(), source: "test" },
        { field: "quote", previewValue: 2500, timestamp: Date.now(), source: "test" },
      ],
    });

    const result = await commit({
      receipt,
      wallet: createMockWallet(),
    });

    expect(result.success).toBe(true);
    expect(result.driftChecks).toHaveLength(2);
    expect(result.driftChecks[0]?.field).toBe("balance");
    expect(result.driftChecks[0]?.passed).toBe(true);
    expect(result.driftChecks[1]?.field).toBe("quote");
    expect(result.driftChecks[1]?.passed).toBe(true);
  });

  test("emits commit lifecycle events", async () => {
    const receipt = createMockReceipt();

    const result = await commit({
      receipt,
      wallet: createMockWallet(),
    });

    expect(result.success).toBe(true);
    const eventTypes = result.ledgerEvents.map((e) => e.event.type);
    expect(eventTypes).toContain("commit_started");
    expect(eventTypes).toContain("commit_completed");
  });

  test("returns finalState from receipt", async () => {
    const receipt = createMockReceipt({
      finalState: { counter: 42, name: "test" },
    });

    const result = await commit({
      receipt,
      wallet: createMockWallet(),
    });

    expect(result.success).toBe(true);
    expect(result.finalState).toEqual({ counter: 42, name: "test" });
  });
});
