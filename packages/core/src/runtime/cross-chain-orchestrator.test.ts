import { describe, expect, test } from "bun:test";
import type { ExecutionResult } from "../types/execution.js";
import type { PlannedAction, Receipt } from "../types/receipt.js";
import { orchestrateCrossChain } from "./cross-chain-orchestrator.js";

function makeBridgePlannedAction(stepId = "bridge_1"): PlannedAction {
  return {
    stepId,
    action: {
      type: "bridge",
      venue: "across",
      asset: "USDC",
      amount: 1000n,
      toChain: 42161,
    },
    venue: "across",
    constraints: {},
    onFailure: "revert",
    simulationResult: {
      success: true,
      gasEstimate: "0",
      input: { asset: "USDC", amount: "1000" },
      output: { asset: "USDC", amount: "990" },
    },
    valueDeltas: [],
  };
}

function makeReceipt(plannedActions: PlannedAction[]): Receipt {
  return {
    id: "rcpt-1",
    spellId: "spell-source",
    phase: "preview",
    timestamp: Date.now(),
    chainContext: {
      chainId: 8453,
      vault: "0x0000000000000000000000000000000000000001",
    },
    guardResults: [],
    advisoryResults: [],
    plannedActions,
    valueDeltas: [],
    accounting: {
      assets: [],
      totalUnaccounted: 0n,
      passed: true,
    },
    constraintResults: [],
    driftKeys: [],
    requiresApproval: false,
    status: "ready",
    metrics: {
      stepsExecuted: 1,
      actionsExecuted: 1,
      gasUsed: 0n,
      advisoryCalls: 0,
      errors: 0,
      retries: 0,
    },
    finalState: {},
  };
}

function makeExecutionResult(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    success: true,
    runId: "run-1",
    startTime: Date.now(),
    endTime: Date.now(),
    duration: 1,
    metrics: {
      stepsExecuted: 1,
      actionsExecuted: 1,
      gasUsed: 0n,
      advisoryCalls: 0,
      errors: 0,
      retries: 0,
    },
    finalState: {},
    ledgerEvents: [],
    receipt: makeReceipt([makeBridgePlannedAction()]),
    commit: {
      success: true,
      receiptId: "rcpt-1",
      transactions: [{ stepId: "bridge_1", success: true, hash: "0xabc" }],
      driftChecks: [],
      finalState: {},
      ledgerEvents: [],
    },
    ...overrides,
  };
}

describe("orchestrateCrossChain", () => {
  test("runs source and destination in simulate mode and injects handoff params", async () => {
    let destinationParams: Record<string, unknown> | undefined;

    const result = await orchestrateCrossChain({
      runId: "run-1",
      sourceSpellId: "source-spell",
      destinationSpellId: "destination-spell",
      sourceChainId: 8453,
      destinationChainId: 42161,
      vault: "0x0000000000000000000000000000000000000001",
      mode: "simulate",
      handoffTimeoutSec: 60,
      executeSource: async () => makeExecutionResult(),
      executeDestination: async (params) => {
        destinationParams = params;
        return makeExecutionResult({
          receipt: makeReceipt([]),
        });
      },
    });

    expect(result.success).toBe(true);
    expect(result.pending).toBe(false);
    expect(result.handoffs[0]?.status).toBe("settled");
    expect(result.tracks.find((track) => track.trackId === "destination")?.status).toBe(
      "completed"
    );
    expect(destinationParams).toBeDefined();
    expect((destinationParams?.__cross_chain as { handoff?: { id?: string } })?.handoff?.id).toBe(
      "handoff:bridge_1"
    );
  });

  test("returns pending when execute mode runs without watch", async () => {
    const result = await orchestrateCrossChain({
      runId: "run-2",
      sourceSpellId: "source-spell",
      destinationSpellId: "destination-spell",
      sourceChainId: 8453,
      destinationChainId: 42161,
      vault: "0x0000000000000000000000000000000000000001",
      mode: "execute",
      watch: false,
      handoffTimeoutSec: 60,
      executeSource: async () => makeExecutionResult(),
      executeDestination: async () => makeExecutionResult({ receipt: makeReceipt([]) }),
    });

    expect(result.success).toBe(true);
    expect(result.pending).toBe(true);
    expect(result.tracks.find((track) => track.trackId === "destination")?.status).toBe("waiting");
  });

  test("continues destination execution when watch mode observes settlement", async () => {
    const result = await orchestrateCrossChain({
      runId: "run-3",
      sourceSpellId: "source-spell",
      destinationSpellId: "destination-spell",
      sourceChainId: 8453,
      destinationChainId: 42161,
      vault: "0x0000000000000000000000000000000000000001",
      mode: "execute",
      watch: true,
      handoffTimeoutSec: 60,
      executeSource: async () => makeExecutionResult(),
      executeDestination: async () => makeExecutionResult({ receipt: makeReceipt([]) }),
      resolveHandoffStatus: async () => ({
        status: "settled",
        settledAmount: 995n,
      }),
    });

    expect(result.success).toBe(true);
    expect(result.pending).toBe(false);
    expect(result.handoffs[0]?.settledAmount).toBe(995n);
  });

  test("expires handoff after timeout in watch mode", async () => {
    let current = 0;
    const result = await orchestrateCrossChain({
      runId: "run-4",
      sourceSpellId: "source-spell",
      destinationSpellId: "destination-spell",
      sourceChainId: 8453,
      destinationChainId: 42161,
      vault: "0x0000000000000000000000000000000000000001",
      mode: "execute",
      watch: true,
      handoffTimeoutSec: 1,
      pollIntervalSec: 1,
      executeSource: async () => makeExecutionResult(),
      executeDestination: async () => makeExecutionResult({ receipt: makeReceipt([]) }),
      resolveHandoffStatus: async () => ({ status: "pending" }),
      now: () => {
        current += 1500;
        return current;
      },
      sleep: async () => {},
    });

    expect(result.success).toBe(false);
    expect(result.pending).toBe(false);
    expect(result.handoffs[0]?.status).toBe("expired");
  });
});
