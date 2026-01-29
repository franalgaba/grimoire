/**
 * End-to-End Tests for Grimoire
 * Tests the full flow from spell source to execution
 */

import { describe, expect, test } from "bun:test";
import { type Address, compile, createProvider, execute } from "./index.js";
import type { Action } from "./types/actions.js";
import type { SpellIR } from "./types/ir.js";
import type { VenueAdapter } from "./venues/types.js";
import type { Wallet } from "./wallet/types.js";

/** Helper to assert compile result has IR */
function assertIR(
  result: ReturnType<typeof compile>
): asserts result is { success: true; ir: SpellIR; errors: never[]; warnings: never[] } {
  if (!result.success || !result.ir) {
    throw new Error("Expected successful compilation with IR");
  }
}

describe("E2E: Compile and Execute", () => {
  describe("Basic Compute Spells", () => {
    test("executes simple compute step", async () => {
      const source = `spell SimpleCompute

  version: "1.0.0"

  params:
    x: 10
    y: 20

  on manual:
    sum = params.x + params.y
    product = params.x * params.y
`;
      const compileResult = compile(source);
      expect(compileResult.success).toBe(true);
      assertIR(compileResult);

      const execResult = await execute({
        spell: compileResult.ir,
        vault: "0x0000000000000000000000000000000000000000" as Address,
        chain: 1,
      });

      expect(execResult.success).toBe(true);
      expect(execResult.metrics.stepsExecuted).toBeGreaterThan(0);
    });

    test("uses parameter overrides", async () => {
      const source = `spell ParamOverride

  version: "1.0.0"

  params:
    multiplier: 2

  on manual:
    result = 100 * params.multiplier
`;
      const compileResult = compile(source);
      expect(compileResult.success).toBe(true);
      assertIR(compileResult);

      // Execute with default params
      const result1 = await execute({
        spell: compileResult.ir,
        vault: "0x0000000000000000000000000000000000000000" as Address,
        chain: 1,
      });
      expect(result1.success).toBe(true);

      // Execute with override
      const result2 = await execute({
        spell: compileResult.ir,
        vault: "0x0000000000000000000000000000000000000000" as Address,
        chain: 1,
        params: { multiplier: 5 },
      });
      expect(result2.success).toBe(true);
    });

    test("chains multiple compute steps", async () => {
      const source = `spell ChainedCompute

  version: "1.0.0"

  params:
    input: 100

  on manual:
    doubled = params.input * 2
    tripled = doubled * 1.5
    final = tripled + 10
`;
      const compileResult = compile(source);
      expect(compileResult.success).toBe(true);
      assertIR(compileResult);

      const execResult = await execute({
        spell: compileResult.ir,
        vault: "0x0000000000000000000000000000000000000000" as Address,
        chain: 1,
      });

      expect(execResult.success).toBe(true);
      expect(execResult.metrics.stepsExecuted).toBeGreaterThan(0);
    });
  });

  describe("Conditional Spells", () => {
    test("executes then branch when condition is true", async () => {
      const source = `spell ConditionalThen

  version: "1.0.0"

  params:
    value: 100

  on manual:
    if params.value > 50:
      result = 1
    else:
      result = 0
`;
      const compileResult = compile(source);
      expect(compileResult.success).toBe(true);
      assertIR(compileResult);

      const execResult = await execute({
        spell: compileResult.ir,
        vault: "0x0000000000000000000000000000000000000000" as Address,
        chain: 1,
      });

      expect(execResult.success).toBe(true);
    });

    test("executes else branch when condition is false", async () => {
      const source = `spell ConditionalElse

  version: "1.0.0"

  params:
    value: 10

  on manual:
    if params.value > 50:
      result = 1
    else:
      result = 0
`;
      const compileResult = compile(source);
      expect(compileResult.success).toBe(true);
      assertIR(compileResult);

      const execResult = await execute({
        spell: compileResult.ir,
        vault: "0x0000000000000000000000000000000000000000" as Address,
        chain: 1,
        params: { value: 10 },
      });

      expect(execResult.success).toBe(true);
    });

    test("handles nested conditionals", async () => {
      const source = `spell NestedConditional

  version: "1.0.0"

  params:
    x: 100
    y: 50

  on manual:
    if params.x > 50:
      if params.y > 25:
        result = 3
      else:
        result = 2
    else:
      result = 1
`;
      const compileResult = compile(source);
      expect(compileResult.success).toBe(true);
      assertIR(compileResult);

      const execResult = await execute({
        spell: compileResult.ir,
        vault: "0x0000000000000000000000000000000000000000" as Address,
        chain: 1,
      });

      expect(execResult.success).toBe(true);
    });
  });

  describe("Loop Spells", () => {
    test("compiles for loop", async () => {
      const source = `spell ForLoop

  version: "1.0.0"

  on manual:
    for i in items:
      x = i
`;
      const compileResult = compile(source);
      expect(compileResult.success).toBe(true);
      // Loop step is created
      const loopStep = compileResult.ir?.steps.find((s) => s.kind === "loop");
      expect(loopStep).toBeDefined();
    });
  });

  describe("Wait Steps", () => {
    test("executes wait step", async () => {
      const source = `spell WaitSpell

  version: "1.0.0"

  on manual:
    x = 1
    wait 1
    y = 2
`;
      const compileResult = compile(source);
      expect(compileResult.success).toBe(true);
      assertIR(compileResult);

      const execResult = await execute({
        spell: compileResult.ir,
        vault: "0x0000000000000000000000000000000000000000" as Address,
        chain: 1,
      });

      expect(execResult.success).toBe(true);
    });
  });

  describe("Emit Steps", () => {
    test("emits event with data", async () => {
      const source = `spell EmitSpell

  version: "1.0.0"

  params:
    value: 42

  on manual:
    emit result(value=params.value)
`;
      const compileResult = compile(source);
      expect(compileResult.success).toBe(true);
      assertIR(compileResult);

      const execResult = await execute({
        spell: compileResult.ir,
        vault: "0x0000000000000000000000000000000000000000" as Address,
        chain: 1,
      });

      expect(execResult.success).toBe(true);
    });
  });

  describe("Halt Steps", () => {
    test("halts execution immediately", async () => {
      const source = `spell HaltSpell

  version: "1.0.0"

  on manual:
    x = 1
    halt "Stopping here"
`;
      const compileResult = compile(source);
      expect(compileResult.success).toBe(true);
      assertIR(compileResult);

      const execResult = await execute({
        spell: compileResult.ir,
        vault: "0x0000000000000000000000000000000000000000" as Address,
        chain: 1,
      });

      // Halt ends execution
      expect(execResult.success).toBe(true);
    });
  });

  describe("State Management", () => {
    test("uses state in computations", async () => {
      const source = `spell StateSpell

  version: "1.0.0"

  state:
    persistent:
      counter: 0
    ephemeral:
      temp: 0

  on manual:
    x = 1
`;
      const compileResult = compile(source);
      expect(compileResult.success).toBe(true);
      assertIR(compileResult);

      const execResult = await execute({
        spell: compileResult.ir,
        vault: "0x0000000000000000000000000000000000000000" as Address,
        chain: 1,
        persistentState: { counter: 5 },
      });

      expect(execResult.success).toBe(true);
    });
  });

  describe("Action Steps", () => {
    test("simulates action steps and emits ledger events", async () => {
      const source = `spell ActionSpell

  version: "1.0.0"
  assets: [USDC]

  venues:
    lending: [@aave]

  on manual:
    aave.deposit(USDC, 100)
`;
      const compileResult = compile(source);
      expect(compileResult.success).toBe(true);
      assertIR(compileResult);

      const execResult = await execute({
        spell: compileResult.ir,
        vault: "0x0000000000000000000000000000000000000000" as Address,
        chain: 1,
        simulate: true,
      });

      expect(execResult.success).toBe(true);
      expect(execResult.metrics.actionsExecuted).toBeGreaterThan(0);

      const simulated = execResult.ledgerEvents.find(
        (entry) => entry.event.type === "action_simulated"
      );
      expect(simulated).toBeDefined();
    });
  });
});

describe("E2E: Expression Evaluation", () => {
  test("evaluates arithmetic expressions", async () => {
    const source = `spell ArithmeticSpell

  version: "1.0.0"

  params:
    a: 10
    b: 3

  on manual:
    sum = params.a + params.b
    diff = params.a - params.b
    prod = params.a * params.b
    quot = params.a / params.b
    modulo = params.a % params.b
`;
    const compileResult = compile(source);
    expect(compileResult.success).toBe(true);
    assertIR(compileResult);

    const execResult = await execute({
      spell: compileResult.ir,
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
    });

    expect(execResult.success).toBe(true);
  });

  test("evaluates comparison expressions", async () => {
    const source = `spell ComparisonSpell

  version: "1.0.0"

  params:
    x: 10
    y: 20

  on manual:
    eq = params.x == params.y
    neq = params.x != params.y
    lt = params.x < params.y
    gt = params.x > params.y
`;
    const compileResult = compile(source);
    expect(compileResult.success).toBe(true);
    assertIR(compileResult);

    const execResult = await execute({
      spell: compileResult.ir,
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
    });

    expect(execResult.success).toBe(true);
  });

  test("evaluates logical expressions", async () => {
    const source = `spell LogicalSpell

  version: "1.0.0"

  params:
    a: true
    b: false

  on manual:
    and_result = params.a and params.b
    or_result = params.a or params.b
`;
    const compileResult = compile(source);
    expect(compileResult.success).toBe(true);
    assertIR(compileResult);

    const execResult = await execute({
      spell: compileResult.ir,
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
    });

    expect(execResult.success).toBe(true);
  });

  test("evaluates function calls", async () => {
    const source = `spell FunctionSpell

  version: "1.0.0"

  params:
    a: 10
    b: 20
    c: 15

  on manual:
    min_val = min(params.a, params.b)
    max_val = max(params.a, params.b)
`;
    const compileResult = compile(source);
    expect(compileResult.success).toBe(true);
    assertIR(compileResult);

    const execResult = await execute({
      spell: compileResult.ir,
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
    });

    expect(execResult.success).toBe(true);
  });

  test("evaluates ternary expressions", async () => {
    const source = `spell TernarySpell

  version: "1.0.0"

  params:
    value: 100

  on manual:
    result = params.value > 50 ? 1 : 0
`;
    const compileResult = compile(source);
    expect(compileResult.success).toBe(true);
    assertIR(compileResult);

    const execResult = await execute({
      spell: compileResult.ir,
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
    });

    expect(execResult.success).toBe(true);
  });

  describe("Action execution", () => {
    test("executes action with approval flow", async () => {
      const source = `spell ActionApproval

  version: "1.0.0"

  venues:
    lending: @aave_v3

  on manual:
    aave_v3.deposit(USDC, 100)
`;
      const compileResult = compile(source);
      expect(compileResult.success).toBe(true);
      assertIR(compileResult);

      const adapter: VenueAdapter = {
        meta: {
          name: "aave_v3",
          supportedChains: [1],
          actions: ["lend"],
        },
        buildAction: async (action: Action) => [
          {
            tx: { to: "0x0000000000000000000000000000000000000002", data: "0x" },
            description: "Approve",
            action,
          },
          {
            tx: { to: "0x0000000000000000000000000000000000000003", data: "0x" },
            description: "Supply",
            action,
          },
        ],
      };

      const wallet: Wallet = {
        address: "0x0000000000000000000000000000000000000001" as Address,
        chainId: 1,
        signTransaction: async () => "0x",
        signMessage: async () => "0x",
        sendTransaction: async () => ({
          hash: "0x",
          blockNumber: 1n,
          blockHash: "0x",
          gasUsed: 0n,
          effectiveGasPrice: 0n,
          status: "success",
          logs: [],
        }),
      };

      const provider = createProvider(1, "http://localhost");

      const execResult = await execute({
        spell: compileResult.ir,
        vault: "0x0000000000000000000000000000000000000000" as Address,
        chain: 1,
        executionMode: "dry-run",
        wallet,
        provider,
        adapters: [adapter],
      });

      expect(execResult.success).toBe(true);
      expect(execResult.metrics.actionsExecuted).toBe(1);
    });
  });
});

describe("E2E: Trigger Types", () => {
  test("compiles manual trigger", async () => {
    const source = `spell ManualSpell

  version: "1.0.0"

  on manual:
    x = 1
`;
    const compileResult = compile(source);
    expect(compileResult.success).toBe(true);
    expect(compileResult.ir?.triggers[0]?.type).toBe("manual");
  });

  test("compiles hourly trigger", async () => {
    const source = `spell HourlySpell

  version: "1.0.0"

  on hourly:
    x = 1
`;
    const compileResult = compile(source);
    expect(compileResult.success).toBe(true);
    expect(compileResult.ir?.triggers[0]?.type).toBe("schedule");
  });

  test("compiles daily trigger", async () => {
    const source = `spell DailySpell

  version: "1.0.0"

  on daily:
    x = 1
`;
    const compileResult = compile(source);
    expect(compileResult.success).toBe(true);
    expect(compileResult.ir?.triggers[0]?.type).toBe("schedule");
  });
});

describe("E2E: Complex Spells", () => {
  test("compiles and executes spell with all features", async () => {
    const source = `spell ComplexSpell

  version: "1.0.0"
  description: "A complex test spell"
  assets: [USDC, ETH]

  params:
    threshold: 100
    multiplier: 2

  limits:
    max_amount: 50%

  venues:
    swap: @uniswap
    lending: [@aave, @compound]

  on manual:
    value = params.threshold * params.multiplier
    if value > 100:
      emit success(amount=value)
    else:
      emit failure(amount=value)
`;
    const compileResult = compile(source);
    expect(compileResult.success).toBe(true);
    assertIR(compileResult);

    const execResult = await execute({
      spell: compileResult.ir,
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
    });

    expect(execResult.success).toBe(true);
  });

  test("handles percentage values", async () => {
    const source = `spell PercentageSpell

  version: "1.0.0"

  limits:
    max_allocation: 50%
    min_threshold: 0.5%

  on manual:
    x = 100
`;
    const compileResult = compile(source);
    expect(compileResult.success).toBe(true);
    assertIR(compileResult);

    const execResult = await execute({
      spell: compileResult.ir,
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
    });

    expect(execResult.success).toBe(true);
  });
});
