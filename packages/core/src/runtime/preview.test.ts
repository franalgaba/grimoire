/**
 * Preview function tests
 */

import { describe, expect, test } from "bun:test";
import { compile } from "../compiler/index.js";
import type { SpellIR } from "../types/ir.js";
import type { Address } from "../types/primitives.js";
import { preview } from "./interpreter.js";

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

describe("preview()", () => {
  test("produces valid Receipt for simple compute spell", async () => {
    const source = `spell SimplePreview {
  version: "1.0.0"

  params: {
    x: 10
    y: 20
  }

  on manual: {
    sum = params.x + params.y
  }
}`;
    const compileResult = compile(source);
    assertIR(compileResult);

    const result = await preview({
      spell: compileResult.ir,
      vault: VAULT,
      chain: 1,
    });

    expect(result.success).toBe(true);
    expect(result.receipt).toBeDefined();
    expect(result.receipt?.id).toMatch(/^rcpt_/);
    expect(result.receipt?.spellId).toBe(compileResult.ir.id);
    expect(result.receipt?.phase).toBe("preview");
    expect(result.receipt?.status).toBe("ready");
    expect(result.receipt?.timestamp).toBeGreaterThan(0);
    expect(result.receipt?.chainContext.chainId).toBe(1);
    expect(result.receipt?.chainContext.vault).toBe(VAULT);
    expect(result.receipt?.metrics.stepsExecuted).toBeGreaterThan(0);
  });

  test("receipt has valid structure", async () => {
    const source = `spell ReceiptStructure {
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

    expect(result.success).toBe(true);
    const receipt = result.receipt as NonNullable<typeof result.receipt>;
    expect(receipt.guardResults).toBeInstanceOf(Array);
    expect(receipt.advisoryResults).toBeInstanceOf(Array);
    expect(receipt.plannedActions).toBeInstanceOf(Array);
    expect(receipt.valueDeltas).toBeInstanceOf(Array);
    expect(receipt.accounting).toBeDefined();
    expect(receipt.accounting.assets).toBeInstanceOf(Array);
    expect(receipt.constraintResults).toBeInstanceOf(Array);
    expect(receipt.driftKeys).toBeInstanceOf(Array);
    expect(typeof receipt.requiresApproval).toBe("boolean");
    expect(receipt.finalState).toBeDefined();
  });

  test("rejects when guards fail (receipt.status === 'rejected')", async () => {
    const source = `spell GuardFail {
  version: "1.0.0"

  guards: {
    always_fail: 1 > 2 with severity="halt", message="Guard intentionally fails"
  }

  on manual: {
    x = 1
  }
}`;
    const compileResult = compile(source);
    assertIR(compileResult);

    const result = await preview({
      spell: compileResult.ir,
      vault: VAULT,
      chain: 1,
    });

    expect(result.success).toBe(false);
    expect(result.receipt).toBeDefined();
    expect(result.receipt?.status).toBe("rejected");
    expect(result.error?.code).toBe("GUARD_FAILED");
    expect(result.error?.message).toContain("Guard failed");
  });

  test("collects PlannedActions for action steps", async () => {
    const source = `spell ActionPreview {
  version: "1.0.0"
  assets: [ETH, USDC]

  venues: {
    uniswap: @uniswap
  }

  params: {
    amount: 1000000
  }

  on manual: {
    uniswap.swap(ETH, USDC, params.amount)
  }
}`;
    const compileResult = compile(source);
    assertIR(compileResult);

    const result = await preview({
      spell: compileResult.ir,
      vault: VAULT,
      chain: 1,
    });

    expect(result.success).toBe(true);
    expect(result.receipt).toBeDefined();
    expect(result.receipt?.plannedActions.length).toBeGreaterThan(0);
    expect(result.receipt?.plannedActions[0]?.action.type).toBe("swap");
    expect(result.receipt?.requiresApproval).toBe(false);
  });

  test("requires approval when approval_required_above is exceeded", async () => {
    const source = `spell ApprovalThreshold {
  version: "1.0.0"
  assets: [ETH, USDC]

  venues: {
    uniswap: @uniswap
  }

  limits: {
    max_single_move: 2000
    approval_required_above: 500
  }

  params: {
    amount: 1000
  }

  on manual: {
    uniswap.swap(ETH, USDC, params.amount) with max_slippage=50
  }
}`;
    const compileResult = compile(source);
    assertIR(compileResult);

    const result = await preview({
      spell: compileResult.ir,
      vault: VAULT,
      chain: 1,
    });

    expect(result.success).toBe(true);
    expect(result.receipt?.requiresApproval).toBe(true);
    const approvalConstraint = result.receipt?.constraintResults.find(
      (item) => item.constraintName === "approval_required_above"
    );
    expect(approvalConstraint?.passed).toBe(true);
    expect(approvalConstraint?.message).toContain("Approval required");
  });

  test("rejects preview when max_single_move is exceeded", async () => {
    const source = `spell MaxSingleMoveViolation {
  version: "1.0.0"
  assets: [ETH, USDC]

  venues: {
    uniswap: @uniswap
  }

  limits: {
    max_single_move: 500
  }

  params: {
    amount: 1000
  }

  on manual: {
    uniswap.swap(ETH, USDC, params.amount) with max_slippage=50
  }
}`;
    const compileResult = compile(source);
    assertIR(compileResult);

    const result = await preview({
      spell: compileResult.ir,
      vault: VAULT,
      chain: 1,
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("CONSTRAINT_VIOLATION");
    const maxSingleMoveConstraint = result.receipt?.constraintResults.find(
      (item) => item.constraintName === "max_single_move"
    );
    expect(maxSingleMoveConstraint?.passed).toBe(false);
  });

  test("does NOT execute actual transactions", async () => {
    const source = `spell NoExecPreview {
  version: "1.0.0"
  assets: [ETH, USDC]

  venues: {
    uniswap: @uniswap
  }

  on manual: {
    uniswap.swap(ETH, USDC, 100)
  }
}`;
    const compileResult = compile(source);
    assertIR(compileResult);

    const result = await preview({
      spell: compileResult.ir,
      vault: VAULT,
      chain: 1,
    });

    expect(result.success).toBe(true);
    // No action_submitted or action_confirmed events — only action_simulated
    const submittedEvents = result.ledgerEvents.filter((e) => e.event.type === "action_submitted");
    const simulatedEvents = result.ledgerEvents.filter((e) => e.event.type === "action_simulated");
    expect(submittedEvents.length).toBe(0);
    expect(simulatedEvents.length).toBeGreaterThan(0);
  });

  test("emits preview lifecycle events", async () => {
    const source = `spell PreviewEvents {
  version: "1.0.0"

  on manual: {
    x = 1
  }
}`;
    const compileResult = compile(source);
    assertIR(compileResult);

    const result = await preview({
      spell: compileResult.ir,
      vault: VAULT,
      chain: 1,
    });

    expect(result.success).toBe(true);

    const eventTypes = result.ledgerEvents.map((e) => e.event.type);
    expect(eventTypes).toContain("preview_started");
    expect(eventTypes).toContain("preview_completed");
    expect(eventTypes).toContain("receipt_generated");
  });

  test("requiresApproval is false for compute-only spells", async () => {
    const source = `spell ComputeOnly {
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

    expect(result.success).toBe(true);
    expect(result.receipt?.requiresApproval).toBe(false);
    expect(result.receipt?.plannedActions.length).toBe(0);
  });
});
