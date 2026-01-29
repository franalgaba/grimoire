/**
 * End-to-End Tests for Grimoire
 * Tests the full flow from spell source to execution
 */

import { describe, expect, test } from "bun:test";
import { type Address, compile, execute } from "./index.js";

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
      expect(compileResult.ir).toBeDefined();

      const execResult = await execute({
        spell: compileResult.ir!,
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

      // Execute with default params
      const result1 = await execute({
        spell: compileResult.ir!,
        vault: "0x0000000000000000000000000000000000000000" as Address,
        chain: 1,
      });
      expect(result1.success).toBe(true);

      // Execute with override
      const result2 = await execute({
        spell: compileResult.ir!,
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

      const execResult = await execute({
        spell: compileResult.ir!,
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

      const execResult = await execute({
        spell: compileResult.ir!,
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

      const execResult = await execute({
        spell: compileResult.ir!,
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

      const execResult = await execute({
        spell: compileResult.ir!,
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

      const execResult = await execute({
        spell: compileResult.ir!,
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

      const execResult = await execute({
        spell: compileResult.ir!,
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

      const execResult = await execute({
        spell: compileResult.ir!,
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

      const execResult = await execute({
        spell: compileResult.ir!,
        vault: "0x0000000000000000000000000000000000000000" as Address,
        chain: 1,
        persistentState: { counter: 5 },
      });

      expect(execResult.success).toBe(true);
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

    const execResult = await execute({
      spell: compileResult.ir!,
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

    const execResult = await execute({
      spell: compileResult.ir!,
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

    const execResult = await execute({
      spell: compileResult.ir!,
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

    const execResult = await execute({
      spell: compileResult.ir!,
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

    const execResult = await execute({
      spell: compileResult.ir!,
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
    });

    expect(execResult.success).toBe(true);
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

    const execResult = await execute({
      spell: compileResult.ir!,
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

    const execResult = await execute({
      spell: compileResult.ir!,
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
    });

    expect(execResult.success).toBe(true);
  });
});
