/**
 * E2E tests for preview/commit foundation behavior.
 */

import { describe, expect, test } from "bun:test";
import { compile, execute, preview } from "./index.js";
import type { SpellIR } from "./types/ir.js";
import type { Address } from "./types/primitives.js";
import type { Provider } from "./wallet/provider.js";
import type { Wallet } from "./wallet/types.js";

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

describe("Preview/Commit E2E", () => {
  describe("preview → commit round trip", () => {
    test("full preview for simple spell produces receipt", async () => {
      const source = `spell RoundTrip {
  version: "1.0.0"

  params: {
    amount: 100
  }

  on manual: {
    result = params.amount * 2
  }
}`;
      const compileResult = compile(source);
      assertIR(compileResult);

      const previewResult = await preview({
        spell: compileResult.ir,
        vault: VAULT,
        chain: 1,
      });

      expect(previewResult.success).toBe(true);
      expect(previewResult.receipt).toBeDefined();
      expect(previewResult.receipt?.status).toBe("ready");
      expect(previewResult.receipt?.plannedActions).toHaveLength(0);
      expect(previewResult.receipt?.requiresApproval).toBe(false);
    });
  });

  describe("execute() backward compat", () => {
    test("execute() still returns ExecutionResult", async () => {
      const source = `spell BackwardCompat {
  version: "1.0.0"

  params: {
    x: 5
  }

  on manual: {
    y = params.x * 10
  }
}`;
      const compileResult = compile(source);
      assertIR(compileResult);

      const result = await execute({
        spell: compileResult.ir,
        vault: VAULT,
        chain: 1,
      });

      // Same ExecutionResult shape as before
      expect(result.success).toBe(true);
      expect(result.runId).toBeDefined();
      expect(result.startTime).toBeGreaterThan(0);
      expect(result.endTime).toBeGreaterThanOrEqual(result.startTime);
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.metrics).toBeDefined();
      expect(result.metrics.stepsExecuted).toBeGreaterThan(0);
      expect(result.finalState).toBeDefined();
      expect(result.ledgerEvents).toBeInstanceOf(Array);
    });

    test("execute() with simulate:true uses preview internally", async () => {
      const source = `spell SimulatePreview {
  version: "1.0.0"

  on manual: {
    x = 1
  }
}`;
      const compileResult = compile(source);
      assertIR(compileResult);

      const result = await execute({
        spell: compileResult.ir,
        vault: VAULT,
        chain: 1,
        simulate: true,
      });

      expect(result.success).toBe(true);
      // Preview lifecycle events should be present
      const eventTypes = result.ledgerEvents.map((e) => e.event.type);
      expect(eventTypes).toContain("preview_started");
      expect(eventTypes).toContain("preview_completed");
    });

    test("execute() with wallet enforces preview then commit", async () => {
      const source = `spell WalletFlow {
  version: "1.0.0"
  assets: [ETH]

  venues: {
    wallet: @wallet
  }

  params: {
    amount: 1000
    to: "0x0000000000000000000000000000000000000002"
  }

  on manual: {
    wallet.transfer(ETH, params.amount, params.to)
  }
}`;
      const compileResult = compile(source);
      assertIR(compileResult);

      const wallet = {
        address: "0x0000000000000000000000000000000000000009",
        chainId: 1,
        signTransaction: async () => "0x",
        signMessage: async () => "0x",
        sendTransaction: async () => ({
          hash: "0xabc",
          blockNumber: 1n,
          blockHash: "0xdef",
          gasUsed: 21000n,
          effectiveGasPrice: 100n,
          status: "success",
          logs: [],
        }),
      } as Wallet;

      const provider = {
        chainId: 1,
        rpcUrl: "http://localhost",
        getGasEstimate: async () => ({
          gasLimit: 21000n,
          maxFeePerGas: 100n,
          maxPriorityFeePerGas: 2n,
          estimatedCost: 21000n * 100n,
        }),
        readContract: async () => 0n,
      } as unknown as Provider;

      const result = await execute({
        spell: compileResult.ir,
        vault: VAULT,
        chain: 1,
        wallet,
        provider,
        executionMode: "execute",
        confirmCallback: async () => true,
      });

      expect(result.success).toBe(true);
      const eventTypes = result.ledgerEvents.map((e) => e.event.type);
      expect(eventTypes).toContain("preview_started");
      expect(eventTypes).toContain("preview_completed");
      expect(eventTypes).toContain("commit_started");
      expect(eventTypes).toContain("commit_completed");
    });
  });

  describe("Receipt schema contract", () => {
    test("receipt has all required fields from §9.1", async () => {
      const source = `spell ReceiptSchema {
  version: "1.0.0"
  assets: [ETH, USDC]

  venues: {
    uniswap: @uniswap
  }

  params: {
    amount: 1000
  }

  on manual: {
    uniswap.swap(ETH, USDC, params.amount)
  }
}`;
      const compileResult = compile(source);
      assertIR(compileResult);

      const previewResult = await preview({
        spell: compileResult.ir,
        vault: VAULT,
        chain: 1,
      });

      expect(previewResult.success).toBe(true);
      const receipt = previewResult.receipt as NonNullable<typeof previewResult.receipt>;

      // Required receipt fields
      expect(receipt.id).toBeDefined();
      expect(receipt.spellId).toBeDefined();
      expect(receipt.phase).toBe("preview");
      expect(receipt.timestamp).toBeGreaterThan(0);
      expect(receipt.chainContext).toBeDefined();
      expect(receipt.chainContext.chainId).toBe(1);
      expect(receipt.chainContext.vault).toBe(VAULT);
      expect(receipt.guardResults).toBeInstanceOf(Array);
      expect(receipt.advisoryResults).toBeInstanceOf(Array);
      expect(receipt.plannedActions).toBeInstanceOf(Array);
      expect(receipt.valueDeltas).toBeInstanceOf(Array);
      expect(receipt.accounting).toBeDefined();
      expect(receipt.constraintResults).toBeInstanceOf(Array);
      expect(receipt.driftKeys).toBeInstanceOf(Array);
      expect(typeof receipt.requiresApproval).toBe("boolean");
      expect(typeof receipt.status).toBe("string");
      expect(receipt.metrics).toBeDefined();
      expect(receipt.finalState).toBeDefined();
    });
  });

  describe("inline advisory expressions", () => {
    test("inline advisory expression now produces compilation error", () => {
      const source = `spell InlineAdvisory {
  version: "1.0.0"

  on manual: {
    if **is this safe** {
      x = 1
    }
  }
}`;
      const compileResult = compile(source);
      expect(compileResult.success).toBe(false);
      expect(compileResult.errors.length).toBeGreaterThan(0);
      const errorMessages = compileResult.errors.map((e) => e.message);
      expect(errorMessages.some((m) => m.includes("Inline advisory expressions"))).toBe(true);
      expect(
        compileResult.errors.some((error) => error.code === "ADVISORY_INLINE_UNSUPPORTED")
      ).toBe(true);
    });
  });

  describe("migrated advisory spells", () => {
    test("explicit advise binding compiles and executes", async () => {
      const source = `spell ExplicitAdvise {
  version: "1.0.0"

  advisors: {
    analyst: {
      model: "anthropic:haiku"
    }
  }

  on manual: {
    decision = advise analyst: "should we proceed" {
      output: {
        type: boolean
      }
      timeout: 10
      fallback: true
    }
    if decision {
      result = "approved"
    } else {
      result = "rejected"
    }
  }
}`;
      const compileResult = compile(source);
      expect(compileResult.success).toBe(true);
      assertIR(compileResult);

      const result = await execute({
        spell: compileResult.ir,
        vault: VAULT,
        chain: 1,
      });

      expect(result.success).toBe(true);
    });

    test("clamp policy records raw and effective advisory outputs", async () => {
      const source = `spell AdvisoryClamp {
  version: "1.0.0"

  advisors: {
    analyst: {
      model: "anthropic:haiku"
    }
  }

  on manual: {
    decision = advise analyst: "score this opportunity" {
      context: 1
      within: constraints
      output: {
        type: number
        min: 0
        max: 10
      }
      on_violation: clamp
      clamp_constraints: [max_slippage]
      timeout: 10
      fallback: 0
    }
    emit advised(score=decision)
  }
}`;
      const compileResult = compile(source);
      assertIR(compileResult);

      const previewResult = await preview({
        spell: compileResult.ir,
        vault: VAULT,
        chain: 1,
        onAdvisory: async () => 100,
      });

      expect(previewResult.success).toBe(true);
      const advisoryResult = previewResult.receipt?.advisoryResults[0];
      expect(advisoryResult).toBeDefined();
      expect(advisoryResult?.rawOutput).toBe(100);
      expect(advisoryResult?.effectiveOutput).toBe(10);
      expect(advisoryResult?.output).toBe(10);
      expect(advisoryResult?.clamped).toBe(true);
      expect(advisoryResult?.onViolation).toBe("clamp");
    });
  });

  describe("preview with state", () => {
    test("preview preserves persistent state", async () => {
      const source = `spell StatefulPreview {
  version: "1.0.0"

  state: {
    persistent: {
      counter: 0
    }
  }

  on manual: {
    counter = counter + 1
  }
}`;
      const compileResult = compile(source);
      assertIR(compileResult);

      const result = await preview({
        spell: compileResult.ir,
        vault: VAULT,
        chain: 1,
        persistentState: { counter: 5 },
      });

      expect(result.success).toBe(true);
      expect(result.receipt?.finalState.counter).toBe(6);
    });
  });

  describe("preview with conditional", () => {
    test("preview evaluates conditionals correctly", async () => {
      const source = `spell ConditionalPreview {
  version: "1.0.0"

  params: {
    threshold: 100
    value: 150
  }

  on manual: {
    if params.value > params.threshold {
      result = "above"
    } else {
      result = "below"
    }
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
      expect(result.receipt?.status).toBe("ready");
    });
  });
});
