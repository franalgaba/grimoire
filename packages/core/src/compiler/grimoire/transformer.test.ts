/**
 * Transformer tests
 */

import { describe, expect, test } from "bun:test";
import { parse } from "./parser.js";
import { transform } from "./transformer.js";

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
      expect(result.assets).toBeDefined();
      expect(Object.keys(result.assets!)).toEqual(["USDC", "DAI", "USDT"]);
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
      const condStep = result.steps?.find((s: any) => s.if);
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
      const loopStep = result.steps?.find((s: any) => s.for);
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
      const emitStep = result.steps?.find((s: any) => s.emit);
      expect(emitStep).toBeDefined();
      expect((emitStep as any)?.emit.event).toBe("done");
    });

    test("transforms halt statement", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    halt "stopped"
`;
      const ast = parse(source);
      const result = transform(ast);
      const haltStep = result.steps?.find((s: any) => s.halt);
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
      const waitStep = result.steps?.find((s: any) => s.wait !== undefined);
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
      const tryStep = result.steps?.find((s: any) => s.try);
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
      const step = result.steps?.[0] as any;
      expect(step.compute.x).toContain("+");
    });

    test("transforms function calls", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    x = max(a, b)
`;
      const ast = parse(source);
      const result = transform(ast);
      const step = result.steps?.[0] as any;
      expect(step.compute.x).toContain("max");
    });

    test("transforms property access", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    x = params.amount
`;
      const ast = parse(source);
      const result = transform(ast);
      const step = result.steps?.[0] as any;
      expect(step.compute.x).toContain("params.amount");
    });

    test("transforms array literal", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    x = [1, 2, 3]
`;
      const ast = parse(source);
      const result = transform(ast);
      const step = result.steps?.[0] as any;
      expect(step.compute.x).toContain("[");
    });

    test("transforms venue reference", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    x = @aave_v3
`;
      const ast = parse(source);
      const result = transform(ast);
      const step = result.steps?.[0] as any;
      expect(step.compute.x).toContain("@aave_v3");
    });

    test("transforms percentage", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    x = 50%
`;
      const ast = parse(source);
      const result = transform(ast);
      const step = result.steps?.[0] as any;
      expect(step.compute.x).toBe("0.5");
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
      const step = result.steps?.[0] as any;
      expect(step.compute.x).toContain("?");
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
      const actionStep = result.steps?.find((s: any) => s.action);
      expect(actionStep).toBeDefined();
      expect((actionStep as any)?.action.type).toBe("lend");
    });

    test("transforms withdraw method call", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    aave.withdraw(USDC, 100)
`;
      const ast = parse(source);
      const result = transform(ast);
      const actionStep = result.steps?.find((s: any) => s.action);
      expect(actionStep).toBeDefined();
      expect((actionStep as any)?.action.type).toBe("withdraw");
    });

    test("transforms swap method call", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    uniswap.swap(USDC, ETH, 100)
`;
      const ast = parse(source);
      const result = transform(ast);
      const actionStep = result.steps?.find((s: any) => s.action);
      expect(actionStep).toBeDefined();
      expect((actionStep as any)?.action.type).toBe("swap");
    });

    test("transforms generic method call", () => {
      const source = `spell Test

  version: "1.0.0"

  on manual:
    venue.custom_action(arg1, arg2)
`;
      const ast = parse(source);
      const result = transform(ast);
      const actionStep = result.steps?.find((s: any) => s.action);
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
      const computeStep = result.steps?.find((s: any) => s.compute);
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
      const actionStep = result.steps?.find((s: any) => s.action);
      expect((actionStep as any)?.action.venue).toBe("myVenue");
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
});
