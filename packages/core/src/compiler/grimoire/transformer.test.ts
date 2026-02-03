/**
 * Transformer tests
 */

import { describe, expect, test } from "bun:test";
import { parse } from "./parser.js";
import { transform } from "./transformer.js";

type StepRecord = Record<string, unknown>;

const findStep = (steps: StepRecord[] | undefined, key: string): StepRecord | undefined =>
  steps?.find((step) => key in step);

const getAction = (step: StepRecord | undefined): { type?: string; venue?: string } | undefined =>
  step && "action" in step ? (step.action as { type?: string; venue?: string }) : undefined;

const getCompute = (step: StepRecord | undefined): Record<string, string> | undefined =>
  step && "compute" in step ? (step.compute as Record<string, string>) : undefined;

const getEmit = (step: StepRecord | undefined): { event?: string } | undefined =>
  step && "emit" in step ? (step.emit as { event?: string }) : undefined;

describe("Transformer", () => {
  describe("basic transformation", () => {
    test("transforms spell name", () => {
      const source = `spell TestSpell

  version: "1.0.0"

  on manual:
    pass
`;
      const ast = parse(source);
      const result = transform(ast);
      expect(result.spell).toBe("TestSpell");
    });

    test("transforms version", () => {
      const source = `spell Test

  version: "2.0.0"

  on manual:
    pass
`;
      const ast = parse(source);
      const result = transform(ast);
      expect(result.version).toBe("2.0.0");
    });

    test("transforms description", () => {
      const source = `spell Test

  version: "1.0.0"
  description: "A test spell"

  on manual:
    pass
`;
      const ast = parse(source);
      const result = transform(ast);
      expect(result.description).toBe("A test spell");
    });
  });

  describe("assets transformation", () => {
    test("transforms asset array", () => {
      const source = `spell Test

  version: "1.0.0"
  assets: [USDC, DAI, USDT]

  on manual:
    pass
`;
      const ast = parse(source);
      const result = transform(ast);
      const assets = result.assets ?? {};
      expect(Object.keys(assets)).toEqual(["USDC", "DAI", "USDT"]);
    });

    test("assets have default chain", () => {
      const source = `spell Test

  version: "1.0.0"
  assets: [USDC]

  on manual:
    pass
`;
      const ast = parse(source);
      const result = transform(ast);
      expect(result.assets?.USDC.chain).toBe(1);
    });
  });

  describe("params transformation", () => {
    test("transforms simple params", () => {
      const source = `spell Test

  version: "1.0.0"

  params:
    amount: 100
    threshold: 50

  on manual:
    pass
`;
      const ast = parse(source);
      const result = transform(ast);
      expect(result.params).toBeDefined();
      expect(result.params?.amount).toBe(100);
      expect(result.params?.threshold).toBe(50);
    });

    test("transforms percentage params", () => {
      const source = `spell Test

  version: "1.0.0"

  params:
    ratio: 50%

  on manual:
    pass
`;
      const ast = parse(source);
      const result = transform(ast);
      expect(result.params?.ratio).toBe(0.5);
    });

    test("transforms unit literal params with asset decimals", () => {
      const source = `spell Test

  version: "1.0.0"
  assets:
    USDC:
      decimals: 6

  params:
    amount: 1.5 USDC

  on manual:
    pass
`;
      const ast = parse(source);
      const result = transform(ast);
      expect(result.params?.amount).toBe(1500000);
    });
  });

  describe("limits transformation", () => {
    test("transforms limits as params with prefix", () => {
      const source = `spell Test

  version: "1.0.0"

  limits:
    max_allocation: 50%
    min_amount: 100

  on manual:
    pass
`;
      const ast = parse(source);
      const result = transform(ast);
      expect(result.params?.limit_max_allocation).toBe(0.5);
      expect(result.params?.limit_min_amount).toBe(100);
    });
  });

  describe("venues transformation", () => {
    test("transforms single venue", () => {
      const source = `spell Test

  version: "1.0.0"

  venues:
    swap: @uniswap

  on manual:
    pass
`;
      const ast = parse(source);
      const result = transform(ast);
      expect(result.venues).toBeDefined();
      expect(result.venues?.uniswap).toBeDefined();
      expect(result.venues?.uniswap.label).toBe("swap");
    });

    test("transforms venue array", () => {
      const source = `spell Test

  version: "1.0.0"

  venues:
    lending: [@aave, @morpho, @compound]

  on manual:
    pass
`;
      const ast = parse(source);
      const result = transform(ast);
      expect(result.venues?.aave).toBeDefined();
      expect(result.venues?.morpho).toBeDefined();
      expect(result.venues?.compound).toBeDefined();
      expect(result.venues?.aave.label).toBe("lending");
    });
  });

  describe("state transformation", () => {
    test("transforms persistent state", () => {
      const source = `spell Test

  version: "1.0.0"

  state:
    persistent:
      counter: 0
      total: 100

  on manual:
    pass
`;
      const ast = parse(source);
      const result = transform(ast);
      expect(result.state).toBeDefined();
      expect(result.state?.persistent?.counter).toBe(0);
      expect(result.state?.persistent?.total).toBe(100);
    });

    test("transforms ephemeral state", () => {
      const source = `spell Test

  version: "1.0.0"

  state:
    ephemeral:
      temp: 0

  on manual:
    pass
`;
      const ast = parse(source);
      const result = transform(ast);
      expect(result.state?.ephemeral?.temp).toBe(0);
    });
  });

  describe("trigger transformation", () => {
    test("transforms manual trigger", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    pass
`;
      const ast = parse(source);
      const result = transform(ast);
      expect(result.trigger).toEqual({ manual: true });
    });

    test("transforms hourly trigger", () => {
      const source = `spell Test

  version: "1.0.0"

  on hourly:
    pass
`;
      const ast = parse(source);
      const result = transform(ast);
      expect(result.trigger).toEqual({ schedule: "0 * * * *" });
    });

    test("transforms daily trigger", () => {
      const source = `spell Test

  version: "1.0.0"

  on daily:
    pass
`;
      const ast = parse(source);
      const result = transform(ast);
      expect(result.trigger).toEqual({ schedule: "0 0 * * *" });
    });

    test("transforms condition trigger", () => {
      const source = `spell Test

  version: "1.0.0"

  on condition params.amount > 1 every 60:
    pass
`;
      const ast = parse(source);
      const result = transform(ast);
      expect(result.trigger).toEqual({
        condition: "(params.amount > 1)",
        poll_interval: 60,
      });
    });

    test("transforms event trigger", () => {
      const source = `spell Test

  version: "1.0.0"

  on event "base.block" where block.number > 0:
    pass
`;
      const ast = parse(source);
      const result = transform(ast);
      expect(result.trigger).toEqual({
        event: "base.block",
        filter: "(block.number > 0)",
      });
    });
  });

  describe("statement transformation", () => {
    test("transforms assignment to compute step", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    x = 42
`;
      const ast = parse(source);
      const result = transform(ast);
      expect(result.steps).toBeDefined();
      expect(result.steps?.length).toBeGreaterThan(0);
      expect(result.steps?.[0]?.compute).toBeDefined();
    });

    test("transforms if statement to conditional", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    if x > 10:
      y = 1
`;
      const ast = parse(source);
      const result = transform(ast);
      const condStep = findStep(result.steps, "if");
      expect(condStep).toBeDefined();
    });

    test("transforms for loop", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    for item in items:
      x = item
`;
      const ast = parse(source);
      const result = transform(ast);
      const loopStep = findStep(result.steps, "for");
      expect(loopStep).toBeDefined();
    });

    test("transforms emit statement", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    emit done(value=42)
`;
      const ast = parse(source);
      const result = transform(ast);
      const emitStep = findStep(result.steps, "emit");
      expect(emitStep).toBeDefined();
      const emit = getEmit(emitStep);
      expect(emit?.event).toBe("done");
    });

    test("transforms halt statement", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    halt "stopped"
`;
      const ast = parse(source);
      const result = transform(ast);
      const haltStep = findStep(result.steps, "halt");
      expect(haltStep).toBeDefined();
      expect(haltStep?.halt).toBe("stopped");
    });

    test("transforms wait statement", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    wait 60
`;
      const ast = parse(source);
      const result = transform(ast);
      const waitStep = findStep(result.steps, "wait");
      expect(waitStep).toBeDefined();
      expect(waitStep?.wait).toBe(60);
    });

    test("transforms atomic block", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    atomic:
      x = 1
      y = 2
`;
      const ast = parse(source);
      const result = transform(ast);
      const tryStep = findStep(result.steps, "try");
      expect(tryStep).toBeDefined();
    });
  });

  describe("expression transformation", () => {
    test("transforms literal expressions", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    x = 42
    y = "hello"
    z = true
`;
      const ast = parse(source);
      const result = transform(ast);
      expect(result.steps?.length).toBe(3);
    });

    test("transforms binary expressions", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    x = a + b * c
`;
      const ast = parse(source);
      const result = transform(ast);
      const step = result.steps?.[0];
      const compute = getCompute(step);
      expect(compute?.x).toContain("+");
    });

    test("transforms function calls", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    x = max(a, b)
`;
      const ast = parse(source);
      const result = transform(ast);
      const step = result.steps?.[0];
      const compute = getCompute(step);
      expect(compute?.x).toContain("max");
    });

    test("transforms property access", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    x = params.amount
`;
      const ast = parse(source);
      const result = transform(ast);
      const step = result.steps?.[0];
      const compute = getCompute(step);
      expect(compute?.x).toContain("params.amount");
    });

    test("transforms array literal", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    x = [1, 2, 3]
`;
      const ast = parse(source);
      const result = transform(ast);
      const step = result.steps?.[0];
      const compute = getCompute(step);
      expect(compute?.x).toContain("[");
    });

    test("transforms venue reference", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    x = @aave_v3
`;
      const ast = parse(source);
      const result = transform(ast);
      const step = result.steps?.[0];
      const compute = getCompute(step);
      expect(compute?.x).toContain("@aave_v3");
    });

    test("transforms percentage", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    x = 50%
`;
      const ast = parse(source);
      const result = transform(ast);
      const step = result.steps?.[0];
      const compute = getCompute(step);
      expect(compute?.x).toBe("0.5");
    });

    test("transforms unary expressions", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    x = -a
    y = not b
`;
      const ast = parse(source);
      const result = transform(ast);
      expect(result.steps?.length).toBe(2);
    });

    test("transforms ternary expressions", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    x = a > 0 ? a : 0
`;
      const ast = parse(source);
      const result = transform(ast);
      const step = result.steps?.[0];
      const compute = getCompute(step);
      expect(compute?.x).toContain("?");
    });
  });

  describe("advisory transformation", () => {
    test("transforms advisory if condition", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    if **is this safe**:
      x = 1
    else:
      x = 0
`;
      const ast = parse(source);
      const result = transform(ast);
      // Advisory conditions create special steps
      expect(result.steps?.length).toBeGreaterThan(0);
    });
  });

  describe("method call transformation", () => {
    test("transforms deposit method call", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    aave.deposit(USDC, 100)
`;
      const ast = parse(source);
      const result = transform(ast);
      const actionStep = findStep(result.steps, "action");
      expect(actionStep).toBeDefined();
      expect(getAction(actionStep)?.type).toBe("lend");
    });

    test("transforms withdraw method call", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    aave.withdraw(USDC, 100)
`;
      const ast = parse(source);
      const result = transform(ast);
      const actionStep = findStep(result.steps, "action");
      expect(actionStep).toBeDefined();
      expect(getAction(actionStep)?.type).toBe("withdraw");
    });

    test("transforms swap method call", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    uniswap.swap(USDC, ETH, 100)
`;
      const ast = parse(source);
      const result = transform(ast);
      const actionStep = findStep(result.steps, "action");
      expect(actionStep).toBeDefined();
      expect(getAction(actionStep)?.type).toBe("swap");
    });

    test("transforms generic method call", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    venue.custom_action(arg1, arg2)
`;
      const ast = parse(source);
      const result = transform(ast);
      const actionStep = findStep(result.steps, "action");
      expect(actionStep).toBeDefined();
    });

    test("transforms query method call to compute", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    lending.get_rates(USDC)
`;
      const ast = parse(source);
      const result = transform(ast);
      const computeStep = findStep(result.steps, "compute");
      expect(computeStep).toBeDefined();
    });

    test("extracts venue from identifier", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    myVenue.deposit(USDC, 100)
`;
      const ast = parse(source);
      const result = transform(ast);
      const actionStep = findStep(result.steps, "action");
      expect(getAction(actionStep)?.venue).toBe("myVenue");
    });
  });

  describe("complex transformations", () => {
    test("transforms nested if statements", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    if a > 0:
      if b > 0:
        x = 1
`;
      const ast = parse(source);
      const result = transform(ast);
      expect(result.steps?.length).toBeGreaterThan(0);
    });

    test("transforms if-elif-else", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    if a > 10:
      x = 3
    elif a > 5:
      x = 2
    else:
      x = 1
`;
      const ast = parse(source);
      const result = transform(ast);
      expect(result.steps?.length).toBeGreaterThan(0);
    });

    test("transforms multiple triggers", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    x = 1

  on hourly:
    y = 2
`;
      const ast = parse(source);
      const result = transform(ast);
      expect(result.trigger).toBeDefined();
    });
  });

  describe("guards transformation", () => {
    test("transforms guards section into source.guards", () => {
      const source = `spell Test

  version: "1.0.0"

  guards:
    max_amount: params.amount < 1000000
    positive: params.amount > 0

  on manual:
    pass
`;
      const ast = parse(source);
      const result = transform(ast);
      expect(result.guards).toBeDefined();
      expect(result.guards?.length).toBe(2);
      expect(result.guards?.[0]?.id).toBe("max_amount");
      expect(result.guards?.[0]?.check).toContain("params.amount");
      expect(result.guards?.[0]?.severity).toBe("halt");
      expect(result.guards?.[1]?.id).toBe("positive");
    });
  });

  describe("output binding transformation", () => {
    test("transforms assignment with method call to action step with output", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    result = venue.swap(USDC, ETH, 100)
`;
      const ast = parse(source);
      const result = transform(ast);
      const actionStep = findStep(result.steps, "action");
      expect(actionStep).toBeDefined();
      expect(actionStep?.output).toBe("result");
      expect(getAction(actionStep)?.type).toBe("swap");
    });

    test("plain function call assignment stays as compute step", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    result = max(a, b)
`;
      const ast = parse(source);
      const result = transform(ast);
      const computeStep = findStep(result.steps, "compute");
      expect(computeStep).toBeDefined();
      expect(getCompute(computeStep)?.result).toContain("max");
    });
  });

  describe("constraints transformation", () => {
    test("transforms with clause on method call to step.constraints", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    venue.swap(USDC, ETH, 1000) with slippage=50, deadline=300, min_output=900, max_input=1100
`;
      const ast = parse(source);
      const result = transform(ast);
      const actionStep = findStep(result.steps, "action");
      expect(actionStep).toBeDefined();
      const constraints = actionStep?.constraints as Record<string, unknown> | undefined;
      expect(constraints).toBeDefined();
      expect(constraints?.max_slippage).toBe(50);
      expect(constraints?.deadline).toBe(300);
      expect(constraints?.min_output).toBe(900);
      expect(constraints?.max_input).toBe(1100);
    });

    test("transforms with clause on assignment with method call", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    result = venue.swap(USDC, ETH, 1000) with slippage=50
`;
      const ast = parse(source);
      const result = transform(ast);
      const actionStep = findStep(result.steps, "action");
      expect(actionStep).toBeDefined();
      expect(actionStep?.output).toBe("result");
      const constraints = actionStep?.constraints as Record<string, unknown> | undefined;
      expect(constraints?.max_slippage).toBe(50);
    });
  });

  describe("atomic onFailure transformation", () => {
    test("transforms atomic skip: to try step with skip catch action", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    atomic skip:
      x = 1
`;
      const ast = parse(source);
      const result = transform(ast);
      const tryStep = findStep(result.steps, "try");
      expect(tryStep).toBeDefined();
      const catchBlocks = tryStep?.catch as Array<{ error: string; action: string }> | undefined;
      expect(catchBlocks?.[0]?.action).toBe("skip");
    });

    test("transforms atomic halt: to try step with halt catch action", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    atomic halt:
      x = 1
`;
      const ast = parse(source);
      const result = transform(ast);
      const tryStep = findStep(result.steps, "try");
      expect(tryStep).toBeDefined();
      const catchBlocks = tryStep?.catch as Array<{ error: string; action: string }> | undefined;
      expect(catchBlocks?.[0]?.action).toBe("halt");
    });

    test("transforms plain atomic: to try step with revert (default)", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    atomic:
      x = 1
`;
      const ast = parse(source);
      const result = transform(ast);
      const tryStep = findStep(result.steps, "try");
      expect(tryStep).toBeDefined();
      const catchBlocks = tryStep?.catch as Array<{ error: string; action: string }> | undefined;
      expect(catchBlocks?.[0]?.action).toBe("revert");
    });
  });
});
