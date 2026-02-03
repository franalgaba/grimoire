/**
 * Validator tests
 */

import { describe, expect, test } from "bun:test";
import type { SpellIR } from "../types/ir.js";
import { validateIR } from "./validator.js";

function createValidIR(): SpellIR {
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
    advisors: [{ name: "advisor", model: "haiku", scope: "read-only" }],
    params: [{ name: "amount", type: "number", default: 1 }],
    state: {
      persistent: { counter: { key: "counter", initialValue: 0 } },
      ephemeral: {},
    },
    steps: [
      {
        kind: "compute",
        id: "compute_1",
        assignments: [{ variable: "x", expression: { kind: "param", name: "amount" } }],
        dependsOn: [],
      },
      {
        kind: "action",
        id: "action_1",
        action: {
          type: "transfer",
          asset: "USDC",
          amount: { kind: "literal", value: 1, type: "int" },
          to: "0x0000000000000000000000000000000000000003",
        },
        constraints: {},
        onFailure: "revert",
        dependsOn: [],
      },
      {
        kind: "loop",
        id: "loop_1",
        loopType: { type: "repeat", count: 1 },
        bodySteps: ["compute_1"],
        maxIterations: 1,
        dependsOn: [],
      },
      {
        kind: "advisory",
        id: "advisory_1",
        advisor: "advisor",
        prompt: "ok?",
        outputSchema: { type: "boolean" },
        outputBinding: "decision",
        timeout: 5,
        fallback: { kind: "literal", value: true, type: "bool" },
        dependsOn: [],
      },
    ],
    guards: [
      {
        id: "guard_1",
        check: { kind: "param", name: "amount" },
        severity: "warn",
        message: "ok",
      },
    ],
    triggers: [{ type: "manual" }],
  };
}

describe("Validator", () => {
  test("validates a correct IR", () => {
    const result = validateIR(createValidIR());
    expect(result.valid).toBe(true);
  });

  test("reports unknown references", () => {
    const ir = createValidIR();
    ir.steps[1] = {
      kind: "action",
      id: "action_2",
      action: {
        type: "transfer",
        asset: "UNKNOWN",
        amount: { kind: "literal", value: 1, type: "int" },
        to: "0x0000000000000000000000000000000000000003",
      },
      constraints: {},
      onFailure: "revert",
      dependsOn: ["missing"],
    };

    const result = validateIR(ir);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "UNKNOWN_STEP_REFERENCE")).toBe(true);
    expect(result.warnings.some((w) => w.code === "UNKNOWN_ASSET")).toBe(true);
  });

  test("allows auto-selected venues for skills", () => {
    const ir = createValidIR();
    ir.aliases.push({
      alias: "uniswap",
      chain: 1,
      address: "0x0000000000000000000000000000000000000004",
    });
    ir.skills = [{ name: "dex", type: "swap", adapters: ["uniswap"] }];
    ir.steps = [
      {
        kind: "action",
        id: "action_auto",
        skill: "dex",
        action: {
          type: "swap",
          venue: "dex",
          assetIn: "USDC",
          assetOut: "USDC",
          amount: { kind: "literal", value: 1, type: "int" },
          mode: "exact_in",
        },
        constraints: {},
        onFailure: "revert",
        dependsOn: [],
      },
    ];

    const result = validateIR(ir);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.code === "AUTO_VENUE")).toBe(true);
  });

  test("detects dependency cycles", () => {
    const ir = createValidIR();
    ir.steps = [
      {
        kind: "compute",
        id: "step_a",
        assignments: [],
        dependsOn: ["step_b"],
      },
      {
        kind: "compute",
        id: "step_b",
        assignments: [],
        dependsOn: ["step_a"],
      },
    ];

    const result = validateIR(ir);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "DEPENDENCY_CYCLE")).toBe(true);
  });

  test("detects advisory issues", () => {
    const ir = createValidIR();
    ir.steps = [
      {
        kind: "advisory",
        id: "advisory_bad",
        advisor: "missing",
        prompt: "?",
        outputSchema: { type: "boolean" },
        outputBinding: "decision",
        timeout: 0,
        fallback: { kind: "literal", value: false, type: "bool" },
        dependsOn: [],
      },
    ];

    const result = validateIR(ir);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "ADVISORY_NO_TIMEOUT")).toBe(true);
    expect(result.errors.some((e) => e.code === "UNKNOWN_ADVISOR")).toBe(true);
  });

  test("warns when no steps", () => {
    const ir = createValidIR();
    ir.steps = [];

    const result = validateIR(ir);
    expect(result.warnings.some((w) => w.code === "NO_STEPS")).toBe(true);
  });

  test("validates complex steps", () => {
    const ir = createValidIR();
    ir.steps = [
      {
        kind: "parallel",
        id: "parallel",
        branches: [
          { id: "b1", name: "b1", steps: ["compute_1"] },
          { id: "b2", name: "b2", steps: ["missing"] },
        ],
        join: { type: "all" },
        onFail: "abort",
        dependsOn: [],
      },
      {
        kind: "pipeline",
        id: "pipeline",
        source: { kind: "param", name: "amount" },
        stages: [
          { op: "where", predicate: { kind: "literal", value: true, type: "bool" } },
          { op: "sort", by: { kind: "literal", value: 1, type: "int" }, order: "asc" },
          { op: "map", step: "missing" },
        ],
        dependsOn: [],
      },
      {
        kind: "try",
        id: "try",
        trySteps: ["missing"],
        catchBlocks: [],
        dependsOn: [],
      },
      {
        kind: "emit",
        id: "emit",
        event: "event",
        data: { value: { kind: "param", name: "amount" } },
        dependsOn: [],
      },
      {
        kind: "wait",
        id: "wait",
        duration: 1,
        dependsOn: [],
      },
    ];

    const result = validateIR(ir);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "UNKNOWN_STEP_REFERENCE")).toBe(true);
  });
});
