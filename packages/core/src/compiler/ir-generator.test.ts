/**
 * IR generator tests
 */

import { describe, expect, test } from "bun:test";
import type { SpellSource } from "../types/ir.js";
import { generateIR } from "./ir-generator.js";

const baseSource: SpellSource = {
  spell: "TestSpell",
  version: "1.0.0",
  trigger: { manual: true },
  assets: {
    USDC: {
      chain: 1,
      address: "0x0000000000000000000000000000000000000001",
      decimals: 6,
    },
  },
  venues: {
    aave: {
      chain: 1,
      address: "0x0000000000000000000000000000000000000002",
      label: "lending",
    },
  },
  params: {
    amount: 100,
  },
  state: {
    persistent: { counter: 0 },
    ephemeral: { temp: 0 },
  },
  steps: [
    { id: "compute_1", compute: { total: "1 + 2" } },
    {
      id: "action_1",
      action: {
        type: "transfer",
        asset: "USDC",
        amount: "100",
        to: "0x0000000000000000000000000000000000000003",
      },
    },
    {
      id: "loop_1",
      repeat: 2,
      steps: ["compute_1"],
      max: 3,
    },
    {
      id: "emit_1",
      emit: {
        event: "done",
        data: { value: "amount" },
      },
    },
    { id: "wait_1", wait: 10 },
    { id: "halt_1", halt: "stop" },
  ],
  guards: [
    {
      id: "guard_1",
      check: "amount > 0",
      severity: "warn",
      message: "amount must be positive",
    },
  ],
};

describe("IR Generator", () => {
  test("generates IR from SpellSource", () => {
    const result = generateIR(baseSource);

    expect(result.success).toBe(true);
    expect(result.ir?.steps.length).toBeGreaterThan(0);
    expect(result.ir?.aliases.length).toBe(1);
    expect(result.ir?.assets.length).toBe(1);
  });

  test("reports errors for invalid step", () => {
    const badSource: SpellSource = {
      ...baseSource,
      steps: [{ id: "", compute: { x: "1" } }],
    };

    const result = generateIR(badSource);
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("handles invalid for clause", () => {
    const badSource: SpellSource = {
      ...baseSource,
      steps: [{ id: "loop_2", for: "invalid clause", steps: [], max: 2 }],
    };

    const result = generateIR(badSource);
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.code === "INVALID_FOR_CLAUSE")).toBe(true);
  });

  test("transforms multiple action types", () => {
    const source: SpellSource = {
      ...baseSource,
      steps: [
        {
          id: "swap",
          action: { type: "swap", venue: "aave", asset_in: "USDC", asset_out: "USDC", amount: "1" },
        },
        { id: "lend", action: { type: "lend", venue: "aave", asset: "USDC", amount: "1" } },
        { id: "withdraw", action: { type: "withdraw", venue: "aave", asset: "USDC", amount: "1" } },
        { id: "borrow", action: { type: "borrow", venue: "aave", asset: "USDC", amount: "1" } },
        { id: "repay", action: { type: "repay", venue: "aave", asset: "USDC", amount: "1" } },
        { id: "stake", action: { type: "stake", venue: "aave", asset: "USDC", amount: "1" } },
        { id: "unstake", action: { type: "unstake", venue: "aave", asset: "USDC", amount: "1" } },
        { id: "claim", action: { type: "claim", venue: "aave" } },
      ],
    };

    const result = generateIR(source);
    expect(result.success).toBe(true);
    expect(result.ir?.steps.length).toBe(8);
  });

  test("parses bridge to_chain expressions", () => {
    const source: SpellSource = {
      ...baseSource,
      steps: [
        {
          id: "bridge",
          action: {
            type: "bridge",
            venue: "aave",
            asset: "USDC",
            amount: "1",
            to_chain: "params.destination_chain",
          },
        },
      ],
    };

    const result = generateIR(source);
    expect(result.success).toBe(true);

    const step = result.ir?.steps[0];
    expect(step?.kind).toBe("action");
    if (step?.kind === "action" && step.action.type === "bridge") {
      expect(step.action.toChain).toBeDefined();
    }
  });

  test("transforms try step with wildcard catch and revert action", () => {
    const source: SpellSource = {
      ...baseSource,
      steps: [
        {
          id: "atomic_1",
          try: ["action_1", "action_2"],
          catch: [{ error: "*", action: "revert" }],
        },
      ],
    };

    const result = generateIR(source);
    expect(result.success).toBe(true);

    const step = result.ir?.steps[0];
    expect(step?.kind).toBe("try");
    if (step?.kind === "try") {
      expect(step.trySteps).toEqual(["action_1", "action_2"]);
      expect(step.catchBlocks.length).toBe(1);
      expect(step.catchBlocks[0].errorType).toBe("*");
      expect(step.catchBlocks[0].action).toBe("rollback"); // "revert" mapped to "rollback"
    }
  });

  test("transforms try step with specific error type", () => {
    const source: SpellSource = {
      ...baseSource,
      steps: [
        {
          id: "try_1",
          try: ["action_1"],
          catch: [
            { error: "slippage_exceeded", action: "skip" },
            { error: "*", action: "halt" },
          ],
        },
      ],
    };

    const result = generateIR(source);
    expect(result.success).toBe(true);

    const step = result.ir?.steps[0];
    if (step?.kind === "try") {
      expect(step.catchBlocks.length).toBe(2);
      expect(step.catchBlocks[0].errorType).toBe("slippage_exceeded");
      expect(step.catchBlocks[0].action).toBe("skip");
      expect(step.catchBlocks[1].errorType).toBe("*");
      expect(step.catchBlocks[1].action).toBe("halt");
    }
  });

  test("transforms try step with finally", () => {
    const source: SpellSource = {
      ...baseSource,
      steps: [
        {
          id: "try_2",
          try: ["action_1"],
          catch: [{ error: "*", action: "skip" }],
          finally: ["cleanup_1"],
        },
      ],
    };

    const result = generateIR(source);
    expect(result.success).toBe(true);

    const step = result.ir?.steps[0];
    if (step?.kind === "try") {
      expect(step.finallySteps).toEqual(["cleanup_1"]);
    }
  });

  test("transforms try step with unknown error type falls back to wildcard", () => {
    const source: SpellSource = {
      ...baseSource,
      steps: [
        {
          id: "try_3",
          try: ["action_1"],
          catch: [{ error: "some_unknown_error", action: "skip" }],
        },
      ],
    };

    const result = generateIR(source);
    expect(result.success).toBe(true);

    const step = result.ir?.steps[0];
    if (step?.kind === "try") {
      expect(step.catchBlocks[0].errorType).toBe("*");
    }
  });

  test("handles until loop and expression errors", () => {
    const source: SpellSource = {
      ...baseSource,
      steps: [
        { id: "loop", loop: { until: "amount > 0", max: 2 }, steps: ["compute_1"] },
        {
          id: "action",
          action: {
            type: "transfer",
            asset: "USDC",
            amount: "bad +",
            to: "0x0000000000000000000000000000000000000003",
          },
        },
      ],
    };

    const result = generateIR(source);
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.code === "EXPRESSION_PARSE_ERROR")).toBe(true);
  });
});
