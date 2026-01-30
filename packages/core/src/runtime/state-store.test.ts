import { describe, expect, test } from "bun:test";
import type { ExecutionResult } from "../types/execution.js";
import { createRunRecord } from "./state-store.js";

function makeExecutionResult(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    success: true,
    runId: "run-abc-123",
    startTime: 1700000000000,
    endTime: 1700000005000,
    duration: 5000,
    metrics: {
      stepsExecuted: 3,
      actionsExecuted: 1,
      gasUsed: 21000n,
      advisoryCalls: 0,
      errors: 0,
      retries: 0,
    },
    finalState: { counter: 1 },
    ledgerEvents: [],
    ...overrides,
  };
}

describe("createRunRecord", () => {
  test("converts ExecutionResult to RunRecord", () => {
    const result = makeExecutionResult();
    const record = createRunRecord(result);

    expect(record.runId).toBe("run-abc-123");
    expect(record.success).toBe(true);
    expect(record.duration).toBe(5000);
    expect(record.finalState).toEqual({ counter: 1 });
    expect(record.error).toBeUndefined();
  });

  test("serializes bigint gasUsed to string", () => {
    const result = makeExecutionResult({
      metrics: {
        stepsExecuted: 5,
        actionsExecuted: 2,
        gasUsed: 123456789012345678n,
        advisoryCalls: 1,
        errors: 0,
        retries: 1,
      },
    });

    const record = createRunRecord(result);

    expect(record.metrics.gasUsed).toBe("123456789012345678");
    expect(typeof record.metrics.gasUsed).toBe("string");
  });

  test("preserves error field on failed result", () => {
    const result = makeExecutionResult({
      success: false,
      error: "Guard failed: insufficient balance",
    });

    const record = createRunRecord(result);

    expect(record.success).toBe(false);
    expect(record.error).toBe("Guard failed: insufficient balance");
  });

  test("generates ISO 8601 timestamp from startTime", () => {
    const result = makeExecutionResult({ startTime: 1700000000000 });
    const record = createRunRecord(result);

    expect(record.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  test("preserves all metrics fields", () => {
    const result = makeExecutionResult({
      metrics: {
        stepsExecuted: 10,
        actionsExecuted: 4,
        gasUsed: 0n,
        advisoryCalls: 2,
        errors: 1,
        retries: 3,
      },
    });

    const record = createRunRecord(result);

    expect(record.metrics.stepsExecuted).toBe(10);
    expect(record.metrics.actionsExecuted).toBe(4);
    expect(record.metrics.gasUsed).toBe("0");
    expect(record.metrics.advisoryCalls).toBe(2);
    expect(record.metrics.errors).toBe(1);
    expect(record.metrics.retries).toBe(3);
  });
});
