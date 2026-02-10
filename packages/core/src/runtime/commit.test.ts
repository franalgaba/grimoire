/**
 * Commit function tests
 */

import { describe, expect, test } from "bun:test";
import { compile } from "../compiler/index.js";
import type { SpellIR } from "../types/ir.js";
import type { Address } from "../types/primitives.js";
import type { Receipt } from "../types/receipt.js";
import { commit, preview } from "./interpreter.js";

function assertIR(
  result: ReturnType<typeof compile>
): asserts result is { success: true; ir: SpellIR; errors: never[]; warnings: never[] } {
  if (!result.success || !result.ir) {
    throw new Error(
      `Expected successful compilation: ${result.errors.map((e) => e.message).join(", ")}`
    );
  }
}

const VAULT: Address = "0x0000000000000000000000000000000000000000";

function createMockReceipt(overrides?: Partial<Receipt>): Receipt {
  return {
    id: "rcpt_test-001",
    spellId: "TestSpell",
    phase: "preview",
    timestamp: Date.now(),
    chainContext: {
      chainId: 1,
      vault: VAULT,
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

async function createReadyReceipt(overrides?: Partial<Receipt>): Promise<Receipt> {
  const source = `spell CommitReady {
  version: "1.0.0"

  on manual: {
    x = 42
  }
}`;

  const compileResult = compile(source);
  assertIR(compileResult);

  const result = await preview({
    spell: compileResult.ir,
    vault: VAULT,
    chain: 1,
  });

  if (!result.success || !result.receipt) {
    throw new Error(`Expected successful preview: ${result.error?.message}`);
  }

  return {
    ...result.receipt,
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
    expect(result.error?.code).toBe("RECEIPT_INVALID_STATUS");
    expect(result.error?.message).toContain("status is 'rejected'");
    expect(result.receiptId).toBe("rcpt_test-001");
  });

  test("fails when receipt status is 'expired'", async () => {
    const receipt = createMockReceipt({ status: "expired" });

    const result = await commit({
      receipt,
      wallet: createMockWallet(),
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("RECEIPT_INVALID_STATUS");
    expect(result.error?.message).toContain("status is 'expired'");
  });

  test("fails when receipt is unknown to runtime", async () => {
    const receipt = createMockReceipt({ status: "ready" });

    const result = await commit({
      receipt,
      wallet: createMockWallet(),
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("PREVIEW_RECEIPT_UNKNOWN");
  });

  test("fails when receipt is expired (maxAge)", async () => {
    const receipt = await createReadyReceipt();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const result = await commit({
      receipt,
      wallet: createMockWallet(),
      driftPolicy: { maxAge: 0.001 },
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("RECEIPT_EXPIRED");
    expect(result.error?.message).toContain("Receipt expired");
    expect(result.error?.message).toContain("maxAge");
  });

  test("succeeds with empty planned actions", async () => {
    const receipt = await createReadyReceipt();

    const result = await commit({
      receipt,
      wallet: createMockWallet(),
    });

    expect(result.success).toBe(true);
    expect(result.receiptId).toBe(receipt.id);
    expect(result.transactions).toHaveLength(0);
    expect(result.driftChecks).toHaveLength(0);
  });

  test("performs drift checks on drift keys", async () => {
    const receipt = await createReadyReceipt({
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
    const receipt = await createReadyReceipt();

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
    const receipt = await createReadyReceipt({
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
