/**
 * Type checker tests
 */

import { describe, expect, test } from "bun:test";
import type { SpellIR } from "../types/ir.js";
import { type TypeCheckResult, typeCheckIR } from "./type-checker.js";

// =============================================================================
// TEST HELPERS
// =============================================================================

function createBaseIR(): SpellIR {
  return {
    id: "test-spell",
    version: "1.0.0",
    meta: {
      name: "test",
      created: Date.now(),
      hash: "test-hash",
    },
    aliases: [{ alias: "aave", chain: 1, address: "0x0000000000000000000000000000000000000001" }],
    assets: [
      {
        symbol: "USDC",
        chain: 1,
        address: "0x0000000000000000000000000000000000000002",
        decimals: 6,
      },
      {
        symbol: "ETH",
        chain: 1,
        address: "0x0000000000000000000000000000000000000003",
        decimals: 18,
      },
    ],
    skills: [],
    advisors: [{ name: "advisor", model: "haiku", scope: "read-only" }],
    params: [
      { name: "amount", type: "number", default: 100 },
      { name: "threshold", type: "number", default: 0.5 },
      { name: "enabled", type: "bool", default: true },
      { name: "target", type: "address", default: "0x0000000000000000000000000000000000000099" },
      { name: "token", type: "asset", default: "USDC" },
    ],
    state: {
      persistent: {
        counter: { key: "counter", initialValue: 0 },
        flag: { key: "flag", initialValue: false },
        label: { key: "label", initialValue: "default" },
      },
      ephemeral: {},
    },
    steps: [],
    guards: [],
    triggers: [{ type: "manual" }],
  };
}

function expectNoErrors(result: TypeCheckResult): void {
  expect(result.errors).toHaveLength(0);
}

function expectNoWarnings(result: TypeCheckResult): void {
  expect(result.warnings).toHaveLength(0);
}

function expectClean(result: TypeCheckResult): void {
  expectNoErrors(result);
  expectNoWarnings(result);
}

function expectErrorCode(result: TypeCheckResult, code: string): void {
  expect(result.errors.some((e) => e.code === code)).toBe(true);
}

// =============================================================================
// POSITIVE TESTS — WELL-TYPED SPELLS
// =============================================================================

describe("Type Checker — Positive", () => {
  test("empty spell produces no warnings", () => {
    const ir = createBaseIR();
    const result = typeCheckIR(ir);
    expectClean(result);
  });

  test("well-typed compute with number arithmetic", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "x",
            expression: {
              kind: "binary",
              op: "+",
              left: { kind: "param", name: "amount" },
              right: { kind: "literal", value: 10, type: "int" },
            },
          },
        ],
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectClean(result);
  });

  test("well-typed boolean guard", () => {
    const ir = createBaseIR();
    ir.guards = [
      {
        id: "g1",
        check: {
          kind: "binary",
          op: ">",
          left: { kind: "param", name: "amount" },
          right: { kind: "literal", value: 0, type: "int" },
        },
        severity: "warn",
        message: "Amount must be positive",
      },
    ];
    const result = typeCheckIR(ir);
    expectClean(result);
  });

  test("well-typed conditional step with bool condition", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "conditional",
        id: "cond1",
        condition: { kind: "param", name: "enabled" },
        thenSteps: [],
        elseSteps: [],
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectClean(result);
  });

  test("well-typed builtin function calls", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "minVal",
            expression: {
              kind: "call",
              fn: "min",
              args: [
                { kind: "param", name: "amount" },
                { kind: "param", name: "threshold" },
              ],
            },
          },
          {
            variable: "bal",
            expression: {
              kind: "call",
              fn: "balance",
              args: [{ kind: "param", name: "token" }],
            },
          },
        ],
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectClean(result);
  });

  test("well-typed ternary expression", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "val",
            expression: {
              kind: "ternary",
              condition: { kind: "param", name: "enabled" },
              then: { kind: "param", name: "amount" },
              else: { kind: "literal", value: 0, type: "int" },
            },
          },
        ],
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectClean(result);
  });

  test("well-typed logical operators", () => {
    const ir = createBaseIR();
    ir.guards = [
      {
        id: "g1",
        check: {
          kind: "binary",
          op: "AND",
          left: { kind: "param", name: "enabled" },
          right: {
            kind: "binary",
            op: ">",
            left: { kind: "param", name: "amount" },
            right: { kind: "literal", value: 0, type: "int" },
          },
        },
        severity: "warn",
        message: "Check",
      },
    ];
    const result = typeCheckIR(ir);
    expectClean(result);
  });

  test("well-typed unary operators", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "neg",
            expression: { kind: "unary", op: "-", arg: { kind: "param", name: "amount" } },
          },
          {
            variable: "notFlag",
            expression: { kind: "unary", op: "NOT", arg: { kind: "param", name: "enabled" } },
          },
          {
            variable: "absVal",
            expression: { kind: "unary", op: "ABS", arg: { kind: "param", name: "amount" } },
          },
        ],
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectClean(result);
  });

  test("well-typed state references", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "x",
            expression: {
              kind: "binary",
              op: "+",
              left: { kind: "state", scope: "persistent", key: "counter" },
              right: { kind: "literal", value: 1, type: "int" },
            },
          },
        ],
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectClean(result);
  });

  test("well-typed action step with output binding", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "action",
        id: "a1",
        action: {
          type: "transfer",
          asset: "USDC",
          amount: { kind: "param", name: "amount" },
          to: "0x0000000000000000000000000000000000000003",
        },
        constraints: {},
        onFailure: "revert",
        outputBinding: "result",
        dependsOn: [],
      },
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "txResult",
            expression: { kind: "binding", name: "result" },
          },
        ],
        dependsOn: ["a1"],
      },
    ];
    const result = typeCheckIR(ir);
    expectClean(result);
  });

  test("well-typed advisory step", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "advisory",
        id: "adv1",
        advisor: "advisor",
        prompt: "Should we proceed?",
        outputSchema: { type: "boolean" },
        outputBinding: "decision",
        timeout: 5,
        fallback: { kind: "literal", value: false, type: "bool" },
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectClean(result);
  });

  test("advisory guard produces no warnings", () => {
    const ir = createBaseIR();
    ir.guards = [
      {
        id: "ag1",
        advisor: "advisor",
        check: "Is the market stable?",
        severity: "warn",
        fallback: true,
      },
    ];
    const result = typeCheckIR(ir);
    expectClean(result);
  });

  test("well-typed loop with until condition", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "loop",
        id: "l1",
        loopType: {
          type: "until",
          condition: {
            kind: "binary",
            op: ">",
            left: { kind: "state", scope: "persistent", key: "counter" },
            right: { kind: "literal", value: 10, type: "int" },
          },
        },
        bodySteps: [],
        maxIterations: 100,
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectClean(result);
  });

  test("well-typed emit step", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "emit",
        id: "e1",
        event: "transfer_complete",
        data: {
          amount: { kind: "param", name: "amount" },
          success: { kind: "literal", value: true, type: "bool" },
        },
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectClean(result);
  });

  test("wait and halt steps produce no warnings", () => {
    const ir = createBaseIR();
    ir.steps = [
      { kind: "wait", id: "w1", duration: 60, dependsOn: [] },
      { kind: "halt", id: "h1", reason: "done", dependsOn: ["w1"] },
    ];
    const result = typeCheckIR(ir);
    expectClean(result);
  });

  test("comparison between number and bigint is allowed (auto-promotion)", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "bal",
            expression: { kind: "call", fn: "balance", args: [{ kind: "param", name: "token" }] },
          },
        ],
        dependsOn: [],
      },
    ];
    ir.guards = [
      {
        id: "g1",
        check: {
          kind: "binary",
          op: ">",
          left: { kind: "binding", name: "bal" },
          right: { kind: "literal", value: 0, type: "int" },
        },
        severity: "warn",
        message: "Balance must be positive",
      },
    ];
    const result = typeCheckIR(ir);
    expectClean(result);
  });
});

// =============================================================================
// NEGATIVE TESTS — TYPE MISMATCHES
// =============================================================================

describe("Type Checker — Negative", () => {
  test("arithmetic on bool operands", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "bad",
            expression: {
              kind: "binary",
              op: "+",
              left: { kind: "param", name: "enabled" },
              right: { kind: "literal", value: 1, type: "int" },
            },
          },
        ],
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectErrorCode(result, "TYPE_MISMATCH");
  });

  test("arithmetic on string operands (not concatenation)", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "bad",
            expression: {
              kind: "binary",
              op: "*",
              left: { kind: "literal", value: "hello", type: "string" },
              right: { kind: "literal", value: 2, type: "int" },
            },
          },
        ],
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectErrorCode(result, "TYPE_MISMATCH");
  });

  test("non-bool guard expression", () => {
    const ir = createBaseIR();
    ir.guards = [
      {
        id: "g1",
        check: { kind: "param", name: "amount" },
        severity: "warn",
        message: "This is not a bool check",
      },
    ];
    const result = typeCheckIR(ir);
    expectErrorCode(result, "TYPE_MISMATCH");
    expect(result.errors[0].message).toContain("bool");
    expect(result.errors[0].message).toContain("number");
  });

  test("non-bool conditional step condition", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "conditional",
        id: "cond1",
        condition: { kind: "param", name: "amount" },
        thenSteps: [],
        elseSteps: [],
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectErrorCode(result, "TYPE_MISMATCH");
  });

  test("non-bool loop until condition", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "loop",
        id: "l1",
        loopType: {
          type: "until",
          condition: { kind: "param", name: "amount" },
        },
        bodySteps: [],
        maxIterations: 100,
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectErrorCode(result, "TYPE_MISMATCH");
    expect(result.errors[0].message).toContain("until");
  });

  test("for loop over non-array", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "loop",
        id: "l1",
        loopType: {
          type: "for",
          variable: "item",
          source: { kind: "param", name: "amount" },
        },
        bodySteps: [],
        maxIterations: 100,
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectErrorCode(result, "TYPE_MISMATCH");
    expect(result.errors[0].message).toContain("array");
  });

  test("logical AND with non-bool operand", () => {
    const ir = createBaseIR();
    ir.guards = [
      {
        id: "g1",
        check: {
          kind: "binary",
          op: "AND",
          left: { kind: "param", name: "amount" },
          right: { kind: "param", name: "enabled" },
        },
        severity: "warn",
        message: "check",
      },
    ];
    const result = typeCheckIR(ir);
    expectErrorCode(result, "TYPE_MISMATCH");
    expect(result.errors[0].message).toContain("AND");
  });

  test("NOT on non-bool operand", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "bad",
            expression: { kind: "unary", op: "NOT", arg: { kind: "param", name: "amount" } },
          },
        ],
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectErrorCode(result, "TYPE_MISMATCH");
    expect(result.errors[0].message).toContain("NOT");
  });

  test("negation of non-numeric", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "bad",
            expression: { kind: "unary", op: "-", arg: { kind: "param", name: "enabled" } },
          },
        ],
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectErrorCode(result, "TYPE_MISMATCH");
  });

  test("ternary with non-bool condition", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "val",
            expression: {
              kind: "ternary",
              condition: { kind: "param", name: "amount" },
              then: { kind: "literal", value: 1, type: "int" },
              else: { kind: "literal", value: 0, type: "int" },
            },
          },
        ],
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectErrorCode(result, "TYPE_MISMATCH");
    expect(result.errors[0].message).toContain("Ternary condition");
  });

  test("ternary with mismatched branch types", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "val",
            expression: {
              kind: "ternary",
              condition: { kind: "param", name: "enabled" },
              then: { kind: "literal", value: 1, type: "int" },
              else: { kind: "literal", value: "hello", type: "string" },
            },
          },
        ],
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectErrorCode(result, "TYPE_MISMATCH");
    expect(result.errors[0].message).toContain("incompatible types");
  });

  test("wrong argument count for builtin function", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "val",
            expression: {
              kind: "call",
              fn: "min",
              args: [{ kind: "literal", value: 1, type: "int" }],
            },
          },
        ],
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectErrorCode(result, "WRONG_ARG_COUNT");
  });

  test("wrong argument type for builtin function", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "val",
            expression: {
              kind: "call",
              fn: "min",
              args: [
                { kind: "literal", value: "hello", type: "string" },
                { kind: "literal", value: 1, type: "int" },
              ],
            },
          },
        ],
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectErrorCode(result, "TYPE_MISMATCH");
    expect(result.errors[0].message).toContain("min");
  });

  test("array access on non-array", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "val",
            expression: {
              kind: "array_access",
              array: { kind: "param", name: "amount" },
              index: { kind: "literal", value: 0, type: "int" },
            },
          },
        ],
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectErrorCode(result, "TYPE_MISMATCH");
    expect(result.errors[0].message).toContain("non-array");
  });

  test("array access with non-number index", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "val",
            expression: {
              kind: "array_access",
              array: { kind: "literal", value: [], type: "json" },
              index: { kind: "literal", value: "key", type: "string" },
            },
          },
        ],
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectErrorCode(result, "TYPE_MISMATCH");
    expect(result.errors[0].message).toContain("index");
  });

  test("comparison between incompatible types", () => {
    const ir = createBaseIR();
    ir.guards = [
      {
        id: "g1",
        check: {
          kind: "binary",
          op: "==",
          left: { kind: "param", name: "amount" },
          right: { kind: "literal", value: "hello", type: "string" },
        },
        severity: "warn",
        message: "check",
      },
    ];
    const result = typeCheckIR(ir);
    expectErrorCode(result, "TYPE_MISMATCH");
    expect(result.errors[0].message).toContain("Comparison");
  });

  test("pipeline source not array", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "pipeline",
        id: "p1",
        source: { kind: "param", name: "amount" },
        stages: [],
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectErrorCode(result, "TYPE_MISMATCH");
    expect(result.errors[0].message).toContain("Pipeline source");
  });

  test("pipeline where predicate not bool", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "pipeline",
        id: "p1",
        source: { kind: "literal", value: [], type: "json" },
        stages: [{ op: "where", predicate: { kind: "literal", value: 42, type: "int" } }],
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectErrorCode(result, "TYPE_MISMATCH");
    expect(result.errors[0].message).toContain("where");
  });

  test("number/bigint arithmetic mismatch", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "bal",
            expression: { kind: "call", fn: "balance", args: [{ kind: "param", name: "token" }] },
          },
        ],
        dependsOn: [],
      },
      {
        kind: "compute",
        id: "c2",
        assignments: [
          {
            variable: "bad",
            expression: {
              kind: "binary",
              op: "+",
              left: { kind: "binding", name: "bal" },
              right: { kind: "param", name: "amount" },
            },
          },
        ],
        dependsOn: ["c1"],
      },
    ];
    const result = typeCheckIR(ir);
    expectErrorCode(result, "TYPE_MISMATCH");
    expect(result.errors[0].message).toContain("mismatched");
  });
});

// =============================================================================
// EDGE CASES
// =============================================================================

describe("Type Checker — Edge Cases", () => {
  test("any type is compatible with everything", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "jsonVal",
            expression: { kind: "literal", value: null, type: "json" },
          },
        ],
        dependsOn: [],
      },
      {
        kind: "compute",
        id: "c2",
        assignments: [
          {
            variable: "sum",
            expression: {
              kind: "binary",
              op: "+",
              left: { kind: "binding", name: "jsonVal" },
              right: { kind: "literal", value: 1, type: "int" },
            },
          },
        ],
        dependsOn: ["c1"],
      },
    ];
    const result = typeCheckIR(ir);
    // No warnings because one operand is 'any'
    expectClean(result);
  });

  test("asset is subtype of string", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "name",
            expression: {
              kind: "binary",
              op: "+",
              left: { kind: "param", name: "token" },
              right: { kind: "literal", value: " token", type: "string" },
            },
          },
        ],
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    // asset + string should work (asset is subtype of string, string concat)
    expectClean(result);
  });

  test("address is subtype of string", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "label",
            expression: {
              kind: "binary",
              op: "+",
              left: { kind: "literal", value: "addr:", type: "string" },
              right: { kind: "param", name: "target" },
            },
          },
        ],
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectClean(result);
  });

  test("bindings accumulate across steps", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "compute",
        id: "c1",
        assignments: [{ variable: "x", expression: { kind: "literal", value: 10, type: "int" } }],
        dependsOn: [],
      },
      {
        kind: "compute",
        id: "c2",
        assignments: [
          {
            variable: "y",
            expression: {
              kind: "binary",
              op: "+",
              left: { kind: "binding", name: "x" },
              right: { kind: "literal", value: 20, type: "int" },
            },
          },
        ],
        dependsOn: ["c1"],
      },
    ];
    const result = typeCheckIR(ir);
    expectClean(result);
  });

  test("unknown binding returns any (no warning from type checker)", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "y",
            expression: {
              kind: "binary",
              op: "+",
              left: { kind: "binding", name: "unknown" },
              right: { kind: "literal", value: 1, type: "int" },
            },
          },
        ],
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    // Unknown binding is 'any', which is compatible — no type mismatch
    expectClean(result);
  });

  test("index expression returns number", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "pos",
            expression: {
              kind: "binary",
              op: "+",
              left: { kind: "index" },
              right: { kind: "literal", value: 1, type: "int" },
            },
          },
        ],
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectClean(result);
  });

  test("advisory output schema maps to correct types", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "advisory",
        id: "adv1",
        advisor: "advisor",
        prompt: "Get number",
        outputSchema: { type: "number", min: 0, max: 100 },
        outputBinding: "numResult",
        timeout: 5,
        fallback: { kind: "literal", value: 50, type: "int" },
        dependsOn: [],
      },
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "doubled",
            expression: {
              kind: "binary",
              op: "*",
              left: { kind: "binding", name: "numResult" },
              right: { kind: "literal", value: 2, type: "int" },
            },
          },
        ],
        dependsOn: ["adv1"],
      },
    ];
    const result = typeCheckIR(ir);
    expectClean(result);
  });

  test("for loop variable gets element type", () => {
    const ir = createBaseIR();
    ir.state.persistent.prices = { key: "prices", initialValue: [1.5, 2.3, 3.1] };
    ir.steps = [
      {
        kind: "loop",
        id: "l1",
        loopType: {
          type: "for",
          variable: "price",
          source: { kind: "state", scope: "persistent", key: "prices" },
        },
        bodySteps: [],
        maxIterations: 100,
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectClean(result);
  });

  test("string concatenation with + operator", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "msg",
            expression: {
              kind: "binary",
              op: "+",
              left: { kind: "literal", value: "hello ", type: "string" },
              right: { kind: "literal", value: "world", type: "string" },
            },
          },
        ],
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectClean(result);
  });

  test("multiple errors accumulate", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "bad1",
            expression: {
              kind: "binary",
              op: "+",
              left: { kind: "param", name: "enabled" },
              right: { kind: "literal", value: 1, type: "int" },
            },
          },
          {
            variable: "bad2",
            expression: {
              kind: "unary",
              op: "NOT",
              arg: { kind: "param", name: "amount" },
            },
          },
        ],
        dependsOn: [],
      },
    ];
    ir.guards = [
      {
        id: "g1",
        check: { kind: "param", name: "amount" },
        severity: "warn",
        message: "not bool",
      },
    ];
    const result = typeCheckIR(ir);
    // Should have 3 errors: arithmetic mismatch, NOT mismatch, guard non-bool
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });

  test("try step produces no warnings", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "try",
        id: "t1",
        trySteps: [],
        catchBlocks: [],
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectClean(result);
  });

  test("parallel step with best join checks metric expression", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "parallel",
        id: "p1",
        branches: [],
        join: {
          type: "best",
          metric: { kind: "param", name: "amount" },
          order: "max",
        },
        onFail: "abort",
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    // Just checking it doesn't crash — metric expression is valid
    expectClean(result);
  });

  test("action step with constraint expressions", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "action",
        id: "a1",
        action: {
          type: "transfer",
          asset: "USDC",
          amount: { kind: "param", name: "amount" },
          to: "0x0000000000000000000000000000000000000003",
        },
        constraints: {
          minOutput: { kind: "literal", value: 100, type: "int" },
          maxGas: { kind: "literal", value: 500000, type: "int" },
        },
        onFailure: "revert",
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectClean(result);
  });

  test("advisory step with context expressions", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "advisory",
        id: "adv1",
        advisor: "advisor",
        prompt: "Analyze",
        context: {
          currentAmount: { kind: "param", name: "amount" },
          isEnabled: { kind: "param", name: "enabled" },
        },
        outputSchema: { type: "string" },
        outputBinding: "analysis",
        timeout: 10,
        fallback: { kind: "literal", value: "default", type: "string" },
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectClean(result);
  });

  test("advisory output schema with nested object fields", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "advisory",
        id: "adv1",
        advisor: "advisor",
        prompt: "Get allocation",
        outputSchema: {
          type: "object",
          fields: {
            amount: { type: "number" },
            approved: { type: "boolean" },
          },
        },
        outputBinding: "allocation",
        timeout: 5,
        fallback: { kind: "literal", value: {}, type: "json" },
        dependsOn: [],
      },
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "amt",
            expression: {
              kind: "property_access",
              object: { kind: "binding", name: "allocation" },
              property: "amount",
            },
          },
        ],
        dependsOn: ["adv1"],
      },
    ];
    const result = typeCheckIR(ir);
    expectClean(result);
  });
});

// =============================================================================
// CONVERSION BUILTINS — to_number() / to_bigint()
// =============================================================================

describe("Type Checker — Conversion Builtins", () => {
  test("to_number(bigint) returns number — well-typed", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "bal",
            expression: { kind: "call", fn: "balance", args: [{ kind: "param", name: "token" }] },
          },
        ],
        dependsOn: [],
      },
      {
        kind: "compute",
        id: "c2",
        assignments: [
          {
            variable: "balNum",
            expression: { kind: "call", fn: "to_number", args: [{ kind: "binding", name: "bal" }] },
          },
        ],
        dependsOn: ["c1"],
      },
    ];
    const result = typeCheckIR(ir);
    expectClean(result);
  });

  test("to_bigint(number) returns bigint — well-typed", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "bigVal",
            expression: {
              kind: "call",
              fn: "to_bigint",
              args: [{ kind: "param", name: "amount" }],
            },
          },
        ],
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectClean(result);
  });

  test("to_number(balance(X)) * price(X, Y) is well-typed", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "bal",
            expression: { kind: "call", fn: "balance", args: [{ kind: "param", name: "token" }] },
          },
          {
            variable: "px",
            expression: {
              kind: "call",
              fn: "price",
              args: [
                { kind: "param", name: "token" },
                { kind: "param", name: "token" },
              ],
            },
          },
        ],
        dependsOn: [],
      },
      {
        kind: "compute",
        id: "c2",
        assignments: [
          {
            variable: "value",
            expression: {
              kind: "binary",
              op: "*",
              left: { kind: "call", fn: "to_number", args: [{ kind: "binding", name: "bal" }] },
              right: { kind: "binding", name: "px" },
            },
          },
        ],
        dependsOn: ["c1"],
      },
    ];
    const result = typeCheckIR(ir);
    expectClean(result);
  });

  test("to_number with wrong arg type produces error", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "bad",
            expression: {
              kind: "call",
              fn: "to_number",
              args: [{ kind: "literal", value: "hello", type: "string" }],
            },
          },
        ],
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectErrorCode(result, "TYPE_MISMATCH");
    expect(result.errors[0].message).toContain("to_number");
  });

  test("to_bigint with wrong arg type produces error", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "bad",
            expression: {
              kind: "call",
              fn: "to_bigint",
              args: [{ kind: "literal", value: true, type: "bool" }],
            },
          },
        ],
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectErrorCode(result, "TYPE_MISMATCH");
    expect(result.errors[0].message).toContain("to_bigint");
  });

  test("to_number with wrong arg count produces error", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "bad",
            expression: {
              kind: "call",
              fn: "to_number",
              args: [],
            },
          },
        ],
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectErrorCode(result, "WRONG_ARG_COUNT");
  });

  // ===========================================================================
  // OPTIONAL ARGS — price() and balance()
  // ===========================================================================

  test("price(ETH, USDC) with 2 args is well-typed", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "px",
            expression: {
              kind: "call",
              fn: "price",
              args: [
                { kind: "param", name: "token" },
                { kind: "param", name: "token" },
              ],
            },
          },
        ],
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectClean(result);
  });

  test("price(ETH, USDC, source) with 3 args is well-typed", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "px",
            expression: {
              kind: "call",
              fn: "price",
              args: [
                { kind: "param", name: "token" },
                { kind: "param", name: "token" },
                { kind: "literal", value: "chainlink", type: "string" },
              ],
            },
          },
        ],
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectClean(result);
  });

  test("price(ETH) with 1 arg produces WRONG_ARG_COUNT", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "px",
            expression: {
              kind: "call",
              fn: "price",
              args: [{ kind: "param", name: "token" }],
            },
          },
        ],
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectErrorCode(result, "WRONG_ARG_COUNT");
  });

  test("price() with 4 args produces WRONG_ARG_COUNT", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "px",
            expression: {
              kind: "call",
              fn: "price",
              args: [
                { kind: "param", name: "token" },
                { kind: "param", name: "token" },
                { kind: "literal", value: "src", type: "string" },
                { kind: "literal", value: "extra", type: "string" },
              ],
            },
          },
        ],
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectErrorCode(result, "WRONG_ARG_COUNT");
  });

  test("balance(ETH) with 1 arg is well-typed", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "bal",
            expression: {
              kind: "call",
              fn: "balance",
              args: [{ kind: "param", name: "token" }],
            },
          },
        ],
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectClean(result);
  });

  test("balance(ETH, address) with 2 args is well-typed", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "bal",
            expression: {
              kind: "call",
              fn: "balance",
              args: [
                { kind: "param", name: "token" },
                { kind: "param", name: "target" },
              ],
            },
          },
        ],
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectClean(result);
  });

  test("balance() with 0 args produces WRONG_ARG_COUNT", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "bal",
            expression: {
              kind: "call",
              fn: "balance",
              args: [],
            },
          },
        ],
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectErrorCode(result, "WRONG_ARG_COUNT");
  });

  test("price optional arg with wrong type produces TYPE_MISMATCH", () => {
    const ir = createBaseIR();
    ir.steps = [
      {
        kind: "compute",
        id: "c1",
        assignments: [
          {
            variable: "px",
            expression: {
              kind: "call",
              fn: "price",
              args: [
                { kind: "param", name: "token" },
                { kind: "param", name: "token" },
                { kind: "literal", value: 42, type: "int" }, // number, not string
              ],
            },
          },
        ],
        dependsOn: [],
      },
    ];
    const result = typeCheckIR(ir);
    expectErrorCode(result, "TYPE_MISMATCH");
    expect(result.errors[0].message).toContain("source");
  });
});
