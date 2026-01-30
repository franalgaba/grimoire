/**
 * Try step tests
 */

import { describe, expect, test } from "bun:test";
import type { ExecutionContext, StepResult } from "../../types/execution.js";
import type { SpellIR } from "../../types/ir.js";
import type { Address } from "../../types/primitives.js";
import type { TryStep } from "../../types/steps.js";
import { InMemoryLedger, createContext } from "../context.js";
import type { EvalContext } from "../expression-evaluator.js";
import { executeTryStep } from "./try.js";

function createSpell(): SpellIR {
  return {
    id: "spell",
    version: "1.0.0",
    meta: { name: "spell", created: Date.now(), hash: "hash" },
    aliases: [],
    assets: [],
    skills: [],
    advisors: [],
    params: [],
    state: { persistent: {}, ephemeral: {} },
    steps: [],
    guards: [],
    triggers: [{ type: "manual" }],
  };
}

function createTestContext(): ExecutionContext {
  return createContext({
    spell: createSpell(),
    vault: "0x0000000000000000000000000000000000000000" as Address,
    chain: 1,
  });
}

type MockExecutor = (
  stepId: string,
  ctx: ExecutionContext,
  evalCtx?: EvalContext
) => Promise<StepResult>;

/**
 * Create a mock executor that fails N times with a given error, then succeeds.
 */
function createFailThenSucceedExecutor(failCount: number, errorMessage: string): MockExecutor {
  let calls = 0;
  return async (stepId) => {
    calls++;
    if (calls <= failCount) {
      return { success: false, stepId, error: errorMessage };
    }
    return { success: true, stepId, output: { ok: true } };
  };
}

describe("Try Step", () => {
  test("try succeeds, finally runs", async () => {
    const ctx = createTestContext();
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);
    const executedSteps: string[] = [];

    const step: TryStep = {
      kind: "try",
      id: "try_1",
      trySteps: ["step_a"],
      catchBlocks: [],
      finallySteps: ["step_finally"],
      dependsOn: [],
    };

    const result = await executeTryStep(step, ctx, ledger, async (stepId) => {
      executedSteps.push(stepId);
      return { success: true, stepId, output: { done: true } };
    });

    expect(result.success).toBe(true);
    expect(executedSteps).toContain("step_a");
    expect(executedSteps).toContain("step_finally");
  });

  test("try fails, catch with steps executes", async () => {
    const ctx = createTestContext();
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);
    const executedSteps: string[] = [];

    const step: TryStep = {
      kind: "try",
      id: "try_2",
      trySteps: ["step_a"],
      catchBlocks: [
        {
          errorType: "*",
          steps: ["catch_step"],
        },
      ],
      dependsOn: [],
    };

    const result = await executeTryStep(step, ctx, ledger, async (stepId) => {
      executedSteps.push(stepId);
      if (stepId === "step_a") {
        return { success: false, stepId, error: "Something failed" };
      }
      return { success: true, stepId, output: { recovered: true } };
    });

    expect(result.success).toBe(true);
    expect(executedSteps).toContain("catch_step");
    expect(ctx.metrics.errors).toBe(1);
  });

  test("try fails, catch with retry succeeds on second attempt", async () => {
    const ctx = createTestContext();
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);

    const step: TryStep = {
      kind: "try",
      id: "try_3",
      trySteps: ["step_a"],
      catchBlocks: [
        {
          errorType: "*",
          retry: {
            maxAttempts: 3,
            backoff: "none",
          },
        },
      ],
      dependsOn: [],
    };

    // Fails first call (try), then fails once more (first retry), then succeeds
    const executor = createFailThenSucceedExecutor(2, "Slippage exceeded");

    const result = await executeTryStep(step, ctx, ledger, executor);

    expect(result.success).toBe(true);
    expect(ctx.metrics.retries).toBe(2);

    const events = ledger.getEntries().map((e) => e.event.type);
    expect(events).toContain("retry_attempted");
    expect(events).toContain("retry_succeeded");
  });

  test("try fails, catch with retry exhausted", async () => {
    const ctx = createTestContext();
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);

    const step: TryStep = {
      kind: "try",
      id: "try_4",
      trySteps: ["step_a"],
      catchBlocks: [
        {
          errorType: "*",
          retry: {
            maxAttempts: 2,
            backoff: "none",
          },
        },
      ],
      dependsOn: [],
    };

    const result = await executeTryStep(step, ctx, ledger, async (stepId) => ({
      success: false,
      stepId,
      error: "Always fails",
    }));

    expect(result.success).toBe(false);
    expect(ctx.metrics.retries).toBe(2);

    const events = ledger.getEntries().map((e) => e.event.type);
    expect(events).toContain("retry_exhausted");
    expect(events).not.toContain("retry_succeeded");
  });

  test("try fails, catch with action skip", async () => {
    const ctx = createTestContext();
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);

    const step: TryStep = {
      kind: "try",
      id: "try_5",
      trySteps: ["step_a"],
      catchBlocks: [{ errorType: "*", action: "skip" }],
      dependsOn: [],
    };

    const result = await executeTryStep(step, ctx, ledger, async (stepId) => ({
      success: false,
      stepId,
      error: "fail",
    }));

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
  });

  test("try fails, catch with action halt", async () => {
    const ctx = createTestContext();
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);

    const step: TryStep = {
      kind: "try",
      id: "try_6",
      trySteps: ["step_a"],
      catchBlocks: [{ errorType: "*", action: "halt" }],
      dependsOn: [],
    };

    const result = await executeTryStep(step, ctx, ledger, async (stepId) => ({
      success: false,
      stepId,
      error: "fail",
    }));

    expect(result.success).toBe(true);
    expect(result.halted).toBe(true);
  });

  test("try fails, wildcard catch matches any error", async () => {
    const ctx = createTestContext();
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);

    const step: TryStep = {
      kind: "try",
      id: "try_7",
      trySteps: ["step_a"],
      catchBlocks: [{ errorType: "*", steps: ["handler"] }],
      dependsOn: [],
    };

    const result = await executeTryStep(step, ctx, ledger, async (stepId) => {
      if (stepId === "step_a") {
        return { success: false, stepId, error: "totally unknown error" };
      }
      return { success: true, stepId };
    });

    expect(result.success).toBe(true);

    const errorCaught = ledger.getEntries().find((e) => e.event.type === "error_caught");
    expect(errorCaught).toBeDefined();
    expect((errorCaught?.event as { handler: string }).handler).toBe("wildcard");
  });

  test("try fails, specific ErrorType match", async () => {
    const ctx = createTestContext();
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);

    const step: TryStep = {
      kind: "try",
      id: "try_8",
      trySteps: ["step_a"],
      catchBlocks: [
        { errorType: "slippage_exceeded", action: "skip" },
        { errorType: "*", action: "halt" },
      ],
      dependsOn: [],
    };

    const result = await executeTryStep(step, ctx, ledger, async (stepId) => {
      if (stepId === "step_a") {
        return { success: false, stepId, error: "Slippage exceeded maximum" };
      }
      return { success: true, stepId };
    });

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true); // Matched slippage_exceeded, not wildcard

    const errorCaught = ledger.getEntries().find((e) => e.event.type === "error_caught");
    expect((errorCaught?.event as { handler: string }).handler).toBe("slippage_exceeded");
  });

  test("try fails, no matching catch returns failure", async () => {
    const ctx = createTestContext();
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);

    const step: TryStep = {
      kind: "try",
      id: "try_9",
      trySteps: ["step_a"],
      catchBlocks: [{ errorType: "slippage_exceeded", action: "skip" }],
      dependsOn: [],
    };

    const result = await executeTryStep(step, ctx, ledger, async (stepId) => ({
      success: false,
      stepId,
      error: "totally unrelated error",
    }));

    expect(result.success).toBe(false);
    expect(result.error).toBe("totally unrelated error");
  });

  test("finally always runs even after catch", async () => {
    const ctx = createTestContext();
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);
    const executedSteps: string[] = [];

    const step: TryStep = {
      kind: "try",
      id: "try_10",
      trySteps: ["step_a"],
      catchBlocks: [{ errorType: "*", steps: ["catch_step"] }],
      finallySteps: ["finally_step"],
      dependsOn: [],
    };

    const result = await executeTryStep(step, ctx, ledger, async (stepId) => {
      executedSteps.push(stepId);
      if (stepId === "step_a") {
        return { success: false, stepId, error: "fail" };
      }
      return { success: true, stepId };
    });

    expect(result.success).toBe(true);
    expect(executedSteps).toContain("catch_step");
    expect(executedSteps).toContain("finally_step");
  });

  test("finally always runs even after unmatched error", async () => {
    const ctx = createTestContext();
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);
    const executedSteps: string[] = [];

    const step: TryStep = {
      kind: "try",
      id: "try_11",
      trySteps: ["step_a"],
      catchBlocks: [{ errorType: "slippage_exceeded", action: "skip" }],
      finallySteps: ["finally_step"],
      dependsOn: [],
    };

    const result = await executeTryStep(step, ctx, ledger, async (stepId) => {
      executedSteps.push(stepId);
      if (stepId === "step_a") {
        return { success: false, stepId, error: "unrelated error" };
      }
      return { success: true, stepId };
    });

    expect(result.success).toBe(false);
    expect(executedSteps).toContain("finally_step");
  });

  test("finally failure supersedes try/catch result", async () => {
    const ctx = createTestContext();
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);

    const step: TryStep = {
      kind: "try",
      id: "try_12",
      trySteps: ["step_a"],
      catchBlocks: [],
      finallySteps: ["finally_step"],
      dependsOn: [],
    };

    const result = await executeTryStep(step, ctx, ledger, async (stepId) => {
      if (stepId === "step_a") {
        return { success: true, stepId, output: { ok: true } };
      }
      if (stepId === "finally_step") {
        return { success: false, stepId, error: "finally failed" };
      }
      return { success: true, stepId };
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("finally failed");
  });

  test("emits correct ledger events", async () => {
    const ctx = createTestContext();
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);

    const step: TryStep = {
      kind: "try",
      id: "try_13",
      trySteps: ["step_a"],
      catchBlocks: [
        {
          errorType: "*",
          retry: { maxAttempts: 1, backoff: "none" },
          action: "skip",
        },
      ],
      dependsOn: [],
    };

    await executeTryStep(step, ctx, ledger, async (stepId) => ({
      success: false,
      stepId,
      error: "Slippage exceeded",
    }));

    const eventTypes = ledger.getEntries().map((e) => e.event.type);
    expect(eventTypes).toContain("step_started");
    expect(eventTypes).toContain("error_caught");
    expect(eventTypes).toContain("retry_attempted");
    expect(eventTypes).toContain("retry_exhausted");
  });

  test("metrics track errors and retries", async () => {
    const ctx = createTestContext();
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);

    const step: TryStep = {
      kind: "try",
      id: "try_14",
      trySteps: ["step_a"],
      catchBlocks: [
        {
          errorType: "*",
          retry: { maxAttempts: 3, backoff: "none" },
        },
      ],
      dependsOn: [],
    };

    await executeTryStep(step, ctx, ledger, async (stepId) => ({
      success: false,
      stepId,
      error: "fail",
    }));

    expect(ctx.metrics.errors).toBe(1);
    expect(ctx.metrics.retries).toBe(3);
  });

  test("catch with action rollback returns failure", async () => {
    const ctx = createTestContext();
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);

    const step: TryStep = {
      kind: "try",
      id: "try_15",
      trySteps: ["step_a"],
      catchBlocks: [{ errorType: "*", action: "rollback" }],
      dependsOn: [],
    };

    const result = await executeTryStep(step, ctx, ledger, async (stepId) => ({
      success: false,
      stepId,
      error: "fail",
    }));

    expect(result.success).toBe(false);
    expect(result.error).toBe("Rollback requested");
  });

  test("retry with slippage modification sets ephemeral state", async () => {
    const ctx = createTestContext();
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);

    const step: TryStep = {
      kind: "try",
      id: "try_16",
      trySteps: ["step_a"],
      catchBlocks: [
        {
          errorType: "*",
          retry: {
            maxAttempts: 2,
            backoff: "none",
            modifyOnRetry: {
              slippage: { increase: 50 },
            },
          },
        },
      ],
      dependsOn: [],
    };

    // Fails the try, then fails first retry, succeeds second retry
    const executor = createFailThenSucceedExecutor(2, "Slippage exceeded");

    const result = await executeTryStep(step, ctx, ledger, executor);

    expect(result.success).toBe(true);
    // After attempt 2, slippage should be 50 * 2 = 100
    expect(ctx.state.ephemeral.get("_retry_slippage_bps_try_16")).toBe(100);
  });

  test("try with no steps succeeds", async () => {
    const ctx = createTestContext();
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);

    const step: TryStep = {
      kind: "try",
      id: "try_17",
      trySteps: [],
      catchBlocks: [],
      dependsOn: [],
    };

    const result = await executeTryStep(step, ctx, ledger, async (stepId) => ({
      success: true,
      stepId,
    }));

    expect(result.success).toBe(true);
  });

  test("halted try step propagates without catching", async () => {
    const ctx = createTestContext();
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);

    const step: TryStep = {
      kind: "try",
      id: "try_18",
      trySteps: ["step_a"],
      catchBlocks: [{ errorType: "*", action: "skip" }],
      finallySteps: ["finally_step"],
      dependsOn: [],
    };

    const executedSteps: string[] = [];

    const result = await executeTryStep(step, ctx, ledger, async (stepId) => {
      executedSteps.push(stepId);
      if (stepId === "step_a") {
        return { success: true, stepId, halted: true };
      }
      return { success: true, stepId };
    });

    expect(result.halted).toBe(true);
    // Finally still runs
    expect(executedSteps).toContain("finally_step");
    // Catch was NOT invoked
    expect(ctx.metrics.errors).toBe(0);
  });
});
