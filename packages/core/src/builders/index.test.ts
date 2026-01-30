/**
 * Tests for the builders API
 */

import { describe, expect, test } from "bun:test";
import type { Action } from "../types/index.js";
import {
  action,
  advisory,
  arrayAccess,
  binary,
  binding,
  call,
  compute,
  conditional,
  emit,
  forLoop,
  halt,
  literal,
  parallel,
  param,
  propertyAccess,
  repeat,
  spell,
  tryBlock,
  until,
  wait,
} from "./index.js";

describe("SpellBuilder", () => {
  test("creates a basic spell", () => {
    const mySpell = spell("MyStrategy").version("1.0.0").description("A sample strategy");

    const ir = mySpell.build();
    expect(ir.id).toBe("my-strategy");
    expect(ir.version).toBe("1.0.0");
    expect(ir.meta.description).toBe("A sample strategy");
    expect(ir.steps).toHaveLength(0);
  });

  test("adds assets", () => {
    const mySpell = spell("MyStrategy")
      .asset("USDC", { chain: 1, address: "0x..." })
      .assets([
        { symbol: "DAI", chain: 1, address: "0x..." },
        { symbol: "USDT", chain: 1, address: "0x..." },
      ]);

    const ir = mySpell.build();
    expect(ir.assets).toHaveLength(3);
    expect(ir.assets[0].symbol).toBe("USDC");
    expect(ir.assets[1].symbol).toBe("DAI");
    expect(ir.assets[2].symbol).toBe("USDT");
  });

  test("adds parameters", () => {
    const mySpell = spell("MyStrategy")
      .param("minAmount", { type: "number", default: 100, min: 10, max: 10000 })
      .param("enabled", { type: "bool", default: true });

    const ir = mySpell.build();
    expect(ir.params).toHaveLength(2);
    expect(ir.params[0].name).toBe("minAmount");
    expect(ir.params[0].default).toBe(100);
    expect(ir.params[1].name).toBe("enabled");
    expect(ir.params[1].default).toBe(true);
  });

  test("adds state", () => {
    const mySpell = spell("MyStrategy")
      .persistentState("counter", "number")
      .ephemeralState("temp", "number");

    const ir = mySpell.build();
    const counter = ir.state.persistent.counter as unknown as { type: string };
    expect(counter.type).toBe("number");
    const temp = ir.state.ephemeral.temp as unknown as { type: string };
    expect(temp.type).toBe("number");
  });

  test("adds steps", () => {
    const mySpell = spell("MyStrategy").step({
      kind: "compute",
      id: "step1",
      assignments: [],
      dependsOn: [],
    });

    const ir = mySpell.build();
    expect(ir.steps).toHaveLength(1);
    expect(ir.steps[0].kind).toBe("compute");
  });

  test("builds as SpellSource", () => {
    const mySpell = spell("MyStrategy")
      .version("1.0.0")
      .description("Test")
      .asset("USDC", { chain: 1, address: "0x..." })
      .param("amount", { type: "number", default: 100 });

    const source = mySpell.buildSource();
    expect(source.spell).toBe("my-strategy");
    expect(source.version).toBe("1.0.0");
    expect(source.description).toBe("Test");
    expect(source.assets?.USDC.chain).toBe(1);
    const amountParam = source.params?.amount as { default?: unknown };
    expect(amountParam.default).toBe(100);
  });
});

describe("ActionBuilder", () => {
  test("creates an action step", () => {
    const swapAction: Action = {
      type: "swap",
      venue: "uniswap_v3",
      assetIn: "USDC",
      assetOut: "DAI",
      amount: literal(100),
      mode: "exact_in",
    };
    const actionStep = action(swapAction);

    const step = actionStep.build();
    expect(step.kind).toBe("action");
    expect(step.action.type).toBe("swap");
  });

  test("sets constraints", () => {
    const swapAction: Action = {
      type: "swap",
      venue: "uniswap_v3",
      assetIn: "USDC",
      assetOut: "DAI",
      amount: literal(100),
      mode: "exact_in",
    };
    const actionStep = action(swapAction)
      .constraints({
        maxSlippageBps: 50,
        deadline: 3600,
      })
      .outputBinding("result");

    const step = actionStep.build();
    expect(step.constraints.maxSlippageBps).toBe(50);
    expect(step.outputBinding).toBe("result");
  });

  test("sets skill", () => {
    const swapAction: Action = {
      type: "swap",
      venue: "uniswap_v3",
      assetIn: "USDC",
      assetOut: "DAI",
      amount: literal(100),
      mode: "exact_in",
    };
    const actionStep = action(swapAction).skill("uniswap_v3");

    const step = actionStep.build();
    expect(step.skill).toBe("uniswap_v3");
  });
});

describe("ConditionalBuilder", () => {
  test("creates a conditional step", () => {
    const condition = binary(binding("balance"), ">", literal(1000));

    const conditionalStep = conditional(condition).then("step1").else("step2");

    const step = conditionalStep.build();
    expect(step.kind).toBe("conditional");
    expect(step.condition.kind).toBe("binary");
    expect(step.thenSteps).toEqual(["step1"]);
    expect(step.elseSteps).toEqual(["step2"]);
  });
});

describe("LoopBuilder", () => {
  test("creates a repeat loop", () => {
    const loopStep = repeat(10, 100).body("step1").body("step2");

    const step = loopStep.build();
    expect(step.kind).toBe("loop");
    expect(step.loopType.type).toBe("repeat");
    if (step.loopType.type === "repeat") {
      expect(step.loopType.count).toBe(10);
    }
    expect(step.bodySteps).toEqual(["step1", "step2"]);
  });

  test("creates a for loop", () => {
    const loopStep = forLoop("asset", binding("assets"), 100).body("processAsset");

    const step = loopStep.build();
    expect(step.kind).toBe("loop");
    expect(step.loopType.type).toBe("for");
    if (step.loopType.type === "for") {
      expect(step.loopType.variable).toBe("asset");
      expect(step.loopType.source.kind).toBe("binding");
    }
  });

  test("creates an until loop", () => {
    const loopStep = until(binding("done"), 100);

    const step = loopStep.build();
    expect(step.kind).toBe("loop");
    expect(step.loopType.type).toBe("until");
    if (step.loopType.type === "until") {
      expect(step.loopType.condition.kind).toBe("binding");
    }
  });

  test("sets parallel execution", () => {
    const loopStep = repeat(10, 100).body("step1").parallel();

    const step = loopStep.build();
    expect(step.parallel).toBe(true);
  });
});

describe("ParallelBuilder", () => {
  test("creates a parallel step", () => {
    const parallelStep = parallel("parallel1")
      .branch("branch1", ["step1", "step2"])
      .branch("branch2", ["step3"])
      .join({ type: "all" })
      .onFail("continue");

    const step = parallelStep.build();
    expect(step.kind).toBe("parallel");
    expect(step.branches).toHaveLength(2);
    expect(step.join.type).toBe("all");
    expect(step.onFail).toBe("continue");
  });

  test("sets timeout", () => {
    const parallelStep = parallel("parallel1").branch("branch1", ["step1"]).timeout(60);

    const step = parallelStep.build();
    expect(step.timeout).toBe(60);
  });
});

describe("ComputeBuilder", () => {
  test("creates a compute step", () => {
    const computeStep = compute("compute1")
      .assign("balance", binding("wallet.balance"))
      .assign("rate", call("get_apy", [binding("asset")]));

    const step = computeStep.build();
    expect(step.kind).toBe("compute");
    expect(step.assignments).toHaveLength(2);
    expect(step.assignments[0].variable).toBe("balance");
    expect(step.assignments[0].expression.kind).toBe("binding");
    expect(step.assignments[1].variable).toBe("rate");
    expect(step.assignments[1].expression.kind).toBe("call");
  });
});

describe("WaitBuilder", () => {
  test("creates a wait step", () => {
    const waitStep = wait(3600);

    const step = waitStep.build();
    expect(step.kind).toBe("wait");
    expect(step.duration).toBe(3600);
  });
});

describe("EmitBuilder", () => {
  test("creates an emit step", () => {
    const emitStep = emit("rebalanced").data("asset", binding("asset")).data("gain", literal(0.05));

    const step = emitStep.build();
    expect(step.kind).toBe("emit");
    expect(step.event).toBe("rebalanced");
    expect(step.data.asset.kind).toBe("binding");
    expect(step.data.gain.kind).toBe("literal");
  });
});

describe("HaltBuilder", () => {
  test("creates a halt step", () => {
    const haltStep = halt("Insufficient balance");

    const step = haltStep.build();
    expect(step.kind).toBe("halt");
    expect(step.reason).toBe("Insufficient balance");
  });
});

describe("TryBuilder", () => {
  test("creates a try block", () => {
    const tryBlockStep = tryBlock("try1")
      .tryStep("step1")
      .tryStep("step2")
      .catchBlock({
        errorType: "tx_reverted",
        action: "skip",
      })
      .catchBlock({
        errorType: "*",
        action: "halt",
      })
      .finallyStep("cleanup");

    const step = tryBlockStep.build();
    expect(step.kind).toBe("try");
    expect(step.trySteps).toHaveLength(2);
    expect(step.catchBlocks).toHaveLength(2);
    expect(step.finallySteps).toEqual(["cleanup"]);
  });

  test("creates a catch block with retry", () => {
    const tryBlockStep = tryBlock("try1")
      .tryStep("step1")
      .catchBlock({
        errorType: "slippage_exceeded",
        retry: {
          maxAttempts: 3,
          backoff: "exponential",
          backoffBase: 1000,
          maxBackoff: 30000,
        },
      });

    const step = tryBlockStep.build();
    const retry = step.catchBlocks[0].retry;
    expect(retry).toBeDefined();
    expect(retry?.maxAttempts).toBe(3);
    expect(retry?.backoff).toBe("exponential");
  });
});

describe("AdvisoryBuilder", () => {
  test("creates an advisory step", () => {
    const advisoryStep = advisory("advisor1", "Is this safe?", "decision")
      .context("balance", binding("balance"))
      .context("amount", literal(1000))
      .outputSchema({ type: "boolean" })
      .timeout(60000)
      .fallback(literal(false));

    const step = advisoryStep.build();
    expect(step.kind).toBe("advisory");
    expect(step.advisor).toBe("advisor1");
    expect(step.prompt).toBe("Is this safe?");
    expect(step.outputBinding).toBe("decision");
    expect(step.timeout).toBe(60000);
    expect(step.fallback.kind).toBe("literal");
  });
});

describe("Expression Builders", () => {
  test("creates literal expressions", () => {
    const expr = literal(42);
    expect(expr.kind).toBe("literal");
    expect(expr.value).toBe(42);
  });

  test("creates parameter expressions", () => {
    const expr = param("minAmount");
    expect(expr.kind).toBe("param");
    expect(expr.name).toBe("minAmount");
  });

  test("creates binding expressions", () => {
    const expr = binding("balance");
    expect(expr.kind).toBe("binding");
    expect(expr.name).toBe("balance");
  });

  test("creates binary expressions", () => {
    const expr = binary(binding("balance"), ">", literal(1000));
    expect(expr.kind).toBe("binary");
    expect(expr.op).toBe(">");
    expect(expr.left.kind).toBe("binding");
    expect(expr.right.kind).toBe("literal");
  });

  test("creates call expressions", () => {
    const expr = call("max", [literal(10), literal(20)]);
    expect(expr.kind).toBe("call");
    expect(expr.fn).toBe("max");
    expect(expr.args).toHaveLength(2);
  });

  test("creates array access expressions", () => {
    const expr = arrayAccess(binding("array"), literal(0));
    expect(expr.kind).toBe("array_access");
    expect(expr.array.kind).toBe("binding");
    expect(expr.index.kind).toBe("literal");
  });

  test("creates property access expressions", () => {
    const expr = propertyAccess(binding("obj"), "prop");
    expect(expr.kind).toBe("property_access");
    expect(expr.object.kind).toBe("binding");
    expect(expr.property).toBe("prop");
  });
});

describe("Complex Example", () => {
  test("builds a complete spell", () => {
    const mySpell = spell("YieldOptimizer")
      .version("1.0.0")
      .description("Optimizes yield across lending protocols")
      .assets([
        { symbol: "USDC", chain: 1, address: "0x..." },
        { symbol: "USDT", chain: 1, address: "0x..." },
        { symbol: "DAI", chain: 1, address: "0x..." },
      ])
      .param("minAmount", { type: "number", default: 100 })
      .param("threshold", { type: "number", default: 0.5 })
      .persistentState("counter", "number")
      .step({
        kind: "compute",
        id: "getRates",
        assignments: [
          {
            variable: "rates",
            expression: call("get_apy", [binding("asset")]),
          },
        ],
        dependsOn: [],
      })
      .step({
        kind: "conditional",
        id: "shouldRebalance",
        condition: binary(
          binary(binding("bestRate"), "-", binding("currentRate")),
          ">",
          binding("params.threshold")
        ),
        thenSteps: ["rebalance"],
        elseSteps: [],
        dependsOn: ["getRates"],
      })
      .step({
        kind: "action",
        id: "rebalance",
        action: {
          type: "swap",
          venue: "uniswap_v3",
          assetIn: "USDC",
          assetOut: "DAI",
          amount: binding("amount"),
          mode: "exact_in" as const,
        },
        constraints: {
          maxSlippageBps: 50,
          deadline: 3600,
        },
        outputBinding: "result",
        dependsOn: [],
        onFailure: "revert",
      });

    const ir = mySpell.build();
    expect(ir.id).toBe("yield-optimizer");
    expect(ir.version).toBe("1.0.0");
    expect(ir.assets).toHaveLength(3);
    expect(ir.params).toHaveLength(2);
    expect(ir.steps).toHaveLength(3);
    expect(ir.steps[0].kind).toBe("compute");
    expect(ir.steps[1].kind).toBe("conditional");
    expect(ir.steps[2].kind).toBe("action");
  });
});
