/**
 * Action step tests
 */

import { describe, expect, test } from "bun:test";
import type { SpellIR } from "../../types/ir.js";
import type { CircuitBreaker } from "../../types/policy.js";
import type { Address } from "../../types/primitives.js";
import type { ActionStep } from "../../types/steps.js";
import { createVenueRegistry } from "../../venues/index.js";
import type { VenueAdapter } from "../../venues/types.js";
import type { Executor } from "../../wallet/executor.js";
import type { Provider } from "../../wallet/provider.js";
import { CircuitBreakerManager } from "../circuit-breaker.js";
import { InMemoryLedger, createContext } from "../context.js";
import { executeActionStep, previewActionStep } from "./action.js";

function createSpell(): SpellIR {
  return {
    id: "spell",
    version: "1.0.0",
    meta: {
      name: "spell",
      created: Date.now(),
      hash: "hash",
    },
    aliases: [{ alias: "aave", chain: 1, address: "0x0000000000000000000000000000000000000001" }],
    assets: [
      {
        symbol: "USDC",
        chain: 1,
        address: "0x0000000000000000000000000000000000000002",
        decimals: 6,
      },
    ],
    skills: [],
    advisors: [],
    params: [],
    state: { persistent: {}, ephemeral: {} },
    steps: [],
    guards: [],
    triggers: [{ type: "manual" }],
  };
}

describe("Action Step", () => {
  test("simulates action and records ledger", async () => {
    const step: ActionStep = {
      kind: "action",
      id: "action_1",
      action: {
        type: "transfer",
        asset: "USDC",
        amount: { kind: "literal", value: 100, type: "int" },
        to: "0x0000000000000000000000000000000000000003",
      },
      constraints: {},
      dependsOn: [],
      onFailure: "revert",
    };

    const ctx = createContext({
      spell: createSpell(),
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
    });
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);

    const result = await executeActionStep(step, ctx, ledger, { mode: "simulate" });

    expect(result.success).toBe(true);
    expect(ctx.metrics.actionsExecuted).toBe(1);

    const simulated = ledger.getEntries().find((entry) => entry.event.type === "action_simulated");
    expect(simulated).toBeDefined();
  });

  test("resolves bridge chain from params", async () => {
    const step: ActionStep = {
      kind: "action",
      id: "action_bridge",
      action: {
        type: "bridge",
        venue: "across",
        asset: "USDC",
        amount: { kind: "literal", value: 10, type: "int" },
        toChain: { kind: "param", name: "destination_chain" },
      },
      constraints: {},
      dependsOn: [],
      onFailure: "revert",
    };

    const spell = {
      ...createSpell(),
      params: [{ name: "destination_chain", type: "number" as const, default: 10 }],
    };

    const ctx = createContext({
      spell,
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
      params: { destination_chain: 10 },
    });
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);

    const result = await executeActionStep(step, ctx, ledger, { mode: "simulate" });
    expect(result.success).toBe(true);

    const simulated = ledger.getEntries().find((entry) => entry.event.type === "action_simulated");
    if (!simulated || simulated.event.type !== "action_simulated") {
      throw new Error("Missing simulated action event");
    }

    expect(simulated.event.action.type).toBe("bridge");
    if (simulated.event.action.type === "bridge") {
      expect(simulated.event.action.toChain).toBe(10);
    }
  });

  test("resolves typed pendle multi-input action amounts", async () => {
    const step: ActionStep = {
      kind: "action",
      id: "action_pendle_swap",
      action: {
        type: "pendle_swap",
        venue: "pendle",
        inputs: [
          { asset: "USDC", amount: { kind: "literal", value: 10, type: "int" } },
          { asset: "USDC", amount: { kind: "param", name: "second_amount" } },
        ],
        outputs: ["PT"],
      },
      constraints: {},
      dependsOn: [],
      onFailure: "revert",
    };

    const spell = {
      ...createSpell(),
      aliases: [
        ...createSpell().aliases,
        {
          alias: "pendle",
          chain: 1,
          address: "0x0000000000000000000000000000000000000007" as Address,
        },
      ],
      params: [{ name: "second_amount", type: "number" as const, default: 25 }],
    };

    const ctx = createContext({
      spell,
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
      params: { second_amount: 25 },
    });
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);

    const result = await executeActionStep(step, ctx, ledger, { mode: "simulate" });
    expect(result.success).toBe(true);

    const simulated = ledger.getEntries().find((entry) => entry.event.type === "action_simulated");
    if (!simulated || simulated.event.type !== "action_simulated") {
      throw new Error("Missing simulated action event");
    }

    expect(simulated.event.action.type).toBe("pendle_swap");
    if (simulated.event.action.type === "pendle_swap") {
      expect(simulated.event.action.inputs[0]?.amount).toBe(10n);
      expect(simulated.event.action.inputs[1]?.amount).toBe(25n);
    }
    expect(simulated.event.result.input.amount).toBe("35");
    expect(simulated.event.result.output.asset).toBe("PT");
  });

  test("preview uses adapter quote and gas metadata when available", async () => {
    const step: ActionStep = {
      kind: "action",
      id: "action_quote_preview",
      action: {
        type: "swap",
        venue: "uniswap",
        assetIn: "USDC",
        assetOut: "WETH",
        amount: { kind: "literal", value: 1000, type: "int" },
        mode: "exact_in",
      },
      constraints: {},
      dependsOn: [],
      onFailure: "revert",
    };

    const spell = {
      ...createSpell(),
      aliases: [
        ...createSpell().aliases,
        {
          alias: "uniswap",
          chain: 1,
          address: "0x0000000000000000000000000000000000000004" as Address,
        },
      ],
      assets: [
        ...createSpell().assets,
        {
          symbol: "WETH",
          chain: 1,
          address: "0x0000000000000000000000000000000000000005" as Address,
          decimals: 18,
        },
      ],
    };

    const ctx = createContext({
      spell,
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
    });
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);
    const adapter: VenueAdapter = {
      meta: {
        name: "uniswap",
        supportedChains: [1],
        actions: ["swap"],
        supportedConstraints: ["max_slippage", "min_output"],
        supportsQuote: true,
        supportsSimulation: true,
      },
      buildAction: async (action) => ({
        tx: { to: "0x0000000000000000000000000000000000000006", data: "0x", value: 0n },
        description: "quoted swap",
        gasEstimate: {
          gasLimit: 123456n,
          maxFeePerGas: 1n,
          maxPriorityFeePerGas: 1n,
          estimatedCost: 123456n,
        },
        action,
        metadata: {
          quote: {
            expectedIn: 1000n,
            expectedOut: 950n,
            minOut: 900n,
            slippageBps: 500,
          },
        },
      }),
    };

    const result = await previewActionStep(step, ctx, ledger, {
      mode: "simulate",
      adapterRegistry: createVenueRegistry([adapter]),
      previewAdapterContext: {
        provider: { chainId: 1 } as unknown as Provider,
        walletAddress: "0x0000000000000000000000000000000000000001" as Address,
        chainId: 1,
      },
    });

    expect(result.stepResult.success).toBe(true);
    expect(result.plannedAction?.simulationResult?.gasEstimate).toBe("123456");
    expect(result.plannedAction?.simulationResult?.input.amount).toBe("1000");
    expect(result.plannedAction?.simulationResult?.output.amount).toBe("900");
  });

  test("preview fails when venue adapter is not registered", async () => {
    const step: ActionStep = {
      kind: "action",
      id: "action_missing_adapter",
      action: {
        type: "swap",
        venue: "uniswap",
        assetIn: "USDC",
        assetOut: "WETH",
        amount: { kind: "literal", value: 1000, type: "int" },
        mode: "exact_in",
      },
      constraints: {},
      dependsOn: [],
      onFailure: "revert",
    };

    const spell = {
      ...createSpell(),
      aliases: [
        ...createSpell().aliases,
        {
          alias: "uniswap",
          chain: 1,
          address: "0x0000000000000000000000000000000000000004" as Address,
        },
      ],
      assets: [
        ...createSpell().assets,
        {
          symbol: "WETH",
          chain: 1,
          address: "0x0000000000000000000000000000000000000005" as Address,
          decimals: 18,
        },
      ],
    };

    const ctx = createContext({
      spell,
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
    });
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);

    const result = await previewActionStep(step, ctx, ledger, {
      mode: "simulate",
      adapterRegistry: createVenueRegistry([]),
      previewAdapterContext: {
        provider: { chainId: 1 } as unknown as Provider,
        walletAddress: "0x0000000000000000000000000000000000000001" as Address,
        chainId: 1,
      },
    });

    expect(result.stepResult.success).toBe(false);
    expect(result.stepResult.error).toContain("Adapter 'uniswap' is not registered");
  });

  test("preview fails closed for max_gas when adapter provides no gas estimate", async () => {
    const step: ActionStep = {
      kind: "action",
      id: "action_max_gas_fail_closed",
      action: {
        type: "swap",
        venue: "uniswap",
        assetIn: "USDC",
        assetOut: "WETH",
        amount: { kind: "literal", value: 1000, type: "int" },
        mode: "exact_in",
      },
      constraints: {
        maxGas: { kind: "literal", value: 100000, type: "int" },
      },
      dependsOn: [],
      onFailure: "revert",
    };

    const spell = {
      ...createSpell(),
      aliases: [
        ...createSpell().aliases,
        {
          alias: "uniswap",
          chain: 1,
          address: "0x0000000000000000000000000000000000000004" as Address,
        },
      ],
      assets: [
        ...createSpell().assets,
        {
          symbol: "WETH",
          chain: 1,
          address: "0x0000000000000000000000000000000000000005" as Address,
          decimals: 18,
        },
      ],
    };

    const ctx = createContext({
      spell,
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
    });
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);
    const adapter: VenueAdapter = {
      meta: {
        name: "uniswap",
        supportedChains: [1],
        actions: ["swap"],
        supportedConstraints: ["max_gas"],
        supportsQuote: true,
        supportsSimulation: true,
      },
      buildAction: async (action) => ({
        tx: { to: "0x0000000000000000000000000000000000000006", data: "0x", value: 0n },
        description: "swap without gas estimate",
        action,
      }),
    };

    const result = await previewActionStep(step, ctx, ledger, {
      mode: "simulate",
      adapterRegistry: createVenueRegistry([adapter]),
      previewAdapterContext: {
        provider: { chainId: 1 } as unknown as Provider,
        walletAddress: "0x0000000000000000000000000000000000000001" as Address,
        chainId: 1,
      },
    });

    expect(result.stepResult.success).toBe(false);
    expect(result.stepResult.error).toContain("could not provide gas estimate");
  });

  test("preview fails closed for require_quote without adapter preview context", async () => {
    const step: ActionStep = {
      kind: "action",
      id: "action_require_quote_missing_context",
      action: {
        type: "swap",
        venue: "uniswap",
        assetIn: "USDC",
        assetOut: "WETH",
        amount: { kind: "literal", value: 1000, type: "int" },
        mode: "exact_in",
      },
      constraints: {
        requireQuote: { kind: "literal", value: true, type: "bool" },
      },
      dependsOn: [],
      onFailure: "revert",
    };

    const spell = {
      ...createSpell(),
      aliases: [
        ...createSpell().aliases,
        {
          alias: "uniswap",
          chain: 1,
          address: "0x0000000000000000000000000000000000000004" as Address,
        },
      ],
      assets: [
        ...createSpell().assets,
        {
          symbol: "WETH",
          chain: 1,
          address: "0x0000000000000000000000000000000000000005" as Address,
          decimals: 18,
        },
      ],
    };

    const ctx = createContext({
      spell,
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
    });
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);
    const adapter: VenueAdapter = {
      meta: {
        name: "uniswap",
        supportedChains: [1],
        actions: ["swap"],
        supportedConstraints: ["require_quote"],
        supportsQuote: true,
        supportsSimulation: true,
      },
      buildAction: async (action) => ({
        tx: { to: "0x0000000000000000000000000000000000000006", data: "0x", value: 0n },
        description: "quoted swap",
        action,
      }),
    };

    const result = await previewActionStep(step, ctx, ledger, {
      mode: "simulate",
      adapterRegistry: createVenueRegistry([adapter]),
    });

    expect(result.stepResult.success).toBe(false);
    expect(result.stepResult.error).toContain("without preview adapter context");
  });

  test("resolves custom action args recursively", async () => {
    const step: ActionStep = {
      kind: "action",
      id: "action_custom",
      action: {
        type: "custom",
        venue: "offchain_fixture",
        op: "session_update",
        args: {
          version: {
            kind: "binary",
            op: "+",
            left: { kind: "param", name: "version" },
            right: { kind: "literal", value: 1, type: "int" },
          },
          payload: { kind: "param", name: "payload" },
        },
      },
      constraints: {},
      dependsOn: [],
      onFailure: "revert",
    };

    const spell = {
      ...createSpell(),
      params: [
        { name: "version", type: "number" as const, default: 2 },
        {
          name: "payload",
          type: "string" as const,
          default: {
            intent: "operate",
            allocations: [{ account: "0xabc", amount: "100" }],
          },
        },
      ],
    };

    const ctx = createContext({
      spell,
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
      params: {
        version: 2,
        payload: {
          intent: "operate",
          allocations: [{ account: "0xabc", amount: "100" }],
        },
      },
    });
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);

    const result = await executeActionStep(step, ctx, ledger, { mode: "simulate" });
    expect(result.success).toBe(true);

    const simulated = ledger.getEntries().find((entry) => entry.event.type === "action_simulated");
    if (!simulated || simulated.event.type !== "action_simulated") {
      throw new Error("Missing simulated action event");
    }

    expect(simulated.event.action.type).toBe("custom");
    if (simulated.event.action.type === "custom") {
      expect(simulated.event.action.args.version).toBe(3);
      expect(simulated.event.action.args.payload).toEqual({
        intent: "operate",
        allocations: [{ account: "0xabc", amount: "100" }],
      });
    }
  });

  test("executes action through executor", async () => {
    const step: ActionStep = {
      kind: "action",
      id: "action_2",
      action: {
        type: "transfer",
        asset: "USDC",
        amount: { kind: "literal", value: "50", type: "string" },
        to: "0x0000000000000000000000000000000000000003",
      },
      constraints: {},
      dependsOn: [],
      outputBinding: "tx",
      onFailure: "revert",
    };

    const ctx = createContext({
      spell: createSpell(),
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
    });
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);

    const executor = {
      executeAction: async () => ({
        success: true,
        hash: "0xabc",
        receipt: {
          hash: "0xabc",
          blockNumber: 1n,
          blockHash: "0xdef",
          gasUsed: 21000n,
          effectiveGasPrice: 100n,
          status: "success",
          logs: [],
        },
        gasUsed: 21000n,
        builtTx: { tx: {}, description: "", action: step.action },
      }),
    } as unknown as Executor;

    const result = await executeActionStep(step, ctx, ledger, {
      mode: "execute",
      executor,
    });

    expect(result.success).toBe(true);
    expect(ctx.bindings.get("tx")).toBeDefined();
    expect(ctx.metrics.gasUsed).toBe(21000n);
  });

  test("fails when executor missing", async () => {
    const step: ActionStep = {
      kind: "action",
      id: "action_3",
      action: {
        type: "transfer",
        asset: "USDC",
        amount: { kind: "literal", value: 10, type: "int" },
        to: "0x0000000000000000000000000000000000000003",
      },
      constraints: {},
      dependsOn: [],
      onFailure: "revert",
    };

    const ctx = createContext({
      spell: createSpell(),
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
    });
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);

    const result = await executeActionStep(step, ctx, ledger, { mode: "execute" });
    expect(result.success).toBe(false);
  });
});

describe("Action Step: Circuit Breaker Integration", () => {
  function makeStep(): ActionStep {
    return {
      kind: "action",
      id: "action_cb",
      action: {
        type: "transfer",
        asset: "USDC",
        amount: { kind: "literal", value: 100, type: "int" },
        to: "0x0000000000000000000000000000000000000003",
      },
      constraints: {},
      dependsOn: [],
      onFailure: "revert",
    };
  }

  function makeOpenBreakerManager(action: CircuitBreaker["action"]): CircuitBreakerManager {
    const now = 1000;
    const mgr = new CircuitBreakerManager(
      [
        {
          id: "test-breaker",
          trigger: { type: "revert_rate", maxPercent: 0.3, window: 60 },
          action,
          cooldown: 300,
        },
      ],
      () => now
    );
    // Force the breaker open
    mgr.recordEvent({ timestamp: now, type: "revert" });
    return mgr;
  }

  test("skips action when circuit breaker is open with pause action", async () => {
    const step = makeStep();
    const ctx = createContext({
      spell: createSpell(),
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
    });
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);
    const cbManager = makeOpenBreakerManager("pause");

    const result = await executeActionStep(step, ctx, ledger, {
      mode: "simulate",
      circuitBreakerManager: cbManager,
    });

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);

    const skipEvent = ledger.getEntries().find((e) => e.event.type === "step_skipped");
    expect(skipEvent).toBeDefined();

    const cbActionEvent = ledger
      .getEntries()
      .find((e) => e.event.type === "circuit_breaker_action");
    expect(cbActionEvent).toBeDefined();
  });

  test("fails action when circuit breaker is open with unwind action", async () => {
    const step = makeStep();
    const ctx = createContext({
      spell: createSpell(),
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
    });
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);
    const cbManager = makeOpenBreakerManager("unwind");

    const result = await executeActionStep(step, ctx, ledger, {
      mode: "simulate",
      circuitBreakerManager: cbManager,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Circuit breaker");

    const failEvent = ledger.getEntries().find((e) => e.event.type === "step_failed");
    expect(failEvent).toBeDefined();
  });

  test("records failure event and triggers breaker", async () => {
    const step = makeStep();
    const ctx = createContext({
      spell: createSpell(),
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
    });
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);

    // Create a breaker that's closed but has a very low threshold
    const cbManager = new CircuitBreakerManager([
      {
        id: "sensitive-breaker",
        trigger: { type: "revert_rate", maxPercent: 0.3, window: 60 },
        action: "pause",
        cooldown: 300,
      },
    ]);

    // Set up a failing executor
    const executor = {
      executeAction: async () => ({
        success: false,
        error: "tx reverted",
        hash: "0xfail",
      }),
    } as unknown as Executor;

    const result = await executeActionStep(step, ctx, ledger, {
      mode: "execute",
      executor,
      circuitBreakerManager: cbManager,
    });

    expect(result.success).toBe(false);

    // Check the breaker was triggered by the failure
    const cbTriggered = ledger
      .getEntries()
      .find((e) => e.event.type === "circuit_breaker_triggered");
    expect(cbTriggered).toBeDefined();

    // Breaker should now be open
    const states = cbManager.getStates();
    expect(states[0]?.state).toBe("open");
  });

  test("records success and transitions half-open breaker to closed", async () => {
    const step = makeStep();
    const ctx = createContext({
      spell: createSpell(),
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
    });
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);

    // Create a breaker that's in half_open state
    let now = 1000;
    const cbManager = new CircuitBreakerManager(
      [
        {
          id: "recovering-breaker",
          trigger: { type: "revert_rate", maxPercent: 0.3, window: 60 },
          action: "pause",
          cooldown: 5,
        },
      ],
      () => now
    );
    // Trip it
    cbManager.recordEvent({ timestamp: now, type: "revert" });
    expect(cbManager.getStates()[0]?.state).toBe("open");
    // Advance past cooldown
    now = 1000 + 5000;
    cbManager.check(); // transitions to half_open
    expect(cbManager.getStates()[0]?.state).toBe("half_open");

    const executor = {
      executeAction: async () => ({
        success: true,
        hash: "0xsuccess",
        receipt: {
          hash: "0xsuccess",
          blockNumber: 1n,
          blockHash: "0xdef",
          gasUsed: 21000n,
          effectiveGasPrice: 100n,
          status: "success",
          logs: [],
        },
        gasUsed: 21000n,
        builtTx: { tx: {}, description: "", action: step.action },
      }),
    } as unknown as Executor;

    const result = await executeActionStep(step, ctx, ledger, {
      mode: "execute",
      executor,
      circuitBreakerManager: cbManager,
    });

    expect(result.success).toBe(true);
    // Breaker should now be closed after success in half_open
    expect(cbManager.getStates()[0]?.state).toBe("closed");
  });

  test("allows action when circuit breaker is closed", async () => {
    const step = makeStep();
    const ctx = createContext({
      spell: createSpell(),
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
    });
    const ledger = new InMemoryLedger(ctx.runId, ctx.spell.id);

    const cbManager = new CircuitBreakerManager([
      {
        id: "closed-breaker",
        trigger: { type: "revert_rate", maxPercent: 0.5, window: 60 },
        action: "pause",
      },
    ]);

    const result = await executeActionStep(step, ctx, ledger, {
      mode: "simulate",
      circuitBreakerManager: cbManager,
    });

    expect(result.success).toBe(true);
    expect(result.skipped).toBeUndefined();
  });
});
