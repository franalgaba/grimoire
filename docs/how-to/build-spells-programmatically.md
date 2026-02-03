# Build spells programmatically

The builders API lets you create spells in TypeScript instead of `.spell` files. This is useful for dynamic strategy generation, testing, and integration with external systems.

## 1) Import the builders

```ts
import {
  spell,
  compute,
  action,
  conditional,
  emit,
  halt,
  wait,
  repeat,
  forLoop,
  until,
  tryBlock,
  advisory,
  parallel,
  pipeline,
  literal,
  binding,
  binary,
  call,
} from "@grimoirelabs/core";
```

## 2) Create a basic spell

Use the `spell()` function to start building. Chain methods to add configuration:

```ts
const mySpell = spell("YieldOptimizer")
  .version("1.0.0")
  .description("Rebalances yield across lending protocols")
  .asset("USDC", { chain: 1, address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" })
  .asset("DAI", { chain: 1, address: "0x6B175474E89094C44Da98b954EedeAC495271d0F" })
  .param("minAmount", { type: "number", default: 100, min: 10, max: 10000 })
  .param("threshold", { type: "number", default: 0.5 })
  .persistentState("runCount", "number")
  .trigger({ type: "manual" });
```

## 2.5) Add skills and advisors (optional)

```ts
mySpell
  .skill("dex", {
    type: "swap",
    adapters: ["uniswap_v3", "uniswap_v4"],
    defaultConstraints: { maxSlippage: 50 },
  })
  .advisor("risk", {
    model: "anthropic:sonnet",
    systemPrompt: "Be conservative.",
    defaultTimeout: 30,
    defaultFallback: true,
    rateLimit: { maxCallsPerRun: 10, maxCallsPerHour: 100 },
  });
```

## 3) Add steps with expressions

Build expressions using `literal()`, `binding()`, `binary()`, `call()`, and `param()`:

```ts
const computeStep = compute("getRates")
  .assign("balance", call("balance", [literal("USDC")]))
  .assign("apy", call("get_apy", [literal("aave_v3"), literal("USDC")]))
  .build();

const checkStep = conditional(
  binary(binding("balance"), ">", binding("params.minAmount"))
)
  .then("rebalance")
  .else("skip")
  .build();

mySpell.step(computeStep).step(checkStep);
```

## 4) Add action steps

Pass an `Action` object to the `action()` builder:

```ts
const swapStep = action({
  type: "swap",
  venue: "uniswap_v3",
  assetIn: "USDC",
  assetOut: "DAI",
  amount: binding("balance"),
  mode: "exact_in",
})
  .skill("uniswap_v3")
  .constraints({ maxSlippageBps: 50, deadline: 3600 })
  .outputBinding("swapResult")
  .build();
```

## 5) Add error handling

Wrap steps in try/catch blocks with retry policies:

```ts
const safeTx = tryBlock("safe-swap")
  .tryStep(swapStep.id)
  .catchBlock({
    errorType: "slippage_exceeded",
    retry: {
      maxAttempts: 3,
      backoff: "exponential",
      backoffBase: 1000,
      maxBackoff: 30000,
    },
  })
  .catchBlock({
    errorType: "*",
    action: "halt",
  })
  .build();
```

## 6) Add loops

Three loop types are available:

```ts
// Repeat N times
const repeatLoop = repeat(10, 100).body("processStep").build();

// For-each over a collection
const forEachLoop = forLoop("asset", binding("assets"), 100)
  .body("processAsset")
  .parallel()
  .build();

// Until a condition is met
const untilLoop = until(binding("done"), 50).body("checkStep").build();
```

## 6.5) Pipelines and advisory steps

```ts
const pipelineStep = pipeline(binding("assets"))
  .filter("isGood") // step id
  .map("transform") // step id
  .build();

const advisoryStep = advisory("risk", "Is this trade safe?", "decision")
  .outputSchema({ type: "boolean" })
  .timeout(20)
  .fallback(literal(true))
  .build();
```

## 7) Build and execute

Call `.build()` to get a `SpellIR` object, then pass it to `execute()`:

```ts
import { execute } from "@grimoirelabs/core";

const ir = mySpell.build();

const result = await execute({
  spell: ir,
  vault: "0x...",
  chain: 1,
  simulate: true,
  params: { minAmount: 500 },
});

console.log(result.success);
console.log(result.metrics.stepsExecuted);
```

## 8) Build as SpellSource (optional)

If you need the raw source format (for the IR generator pipeline):

```ts
const source = mySpell.buildSource();
// source.spell, source.version, source.assets, source.params, etc.
```

## Complete example

```ts
import { spell, compute, action, conditional, emit, literal, binding, binary, execute } from "@grimoirelabs/core";

const successEmit = emit("rebalanced").data("gain", binding("gain")).build();

const strategy = spell("SimpleRebalancer")
  .version("1.0.0")
  .description("Rebalance when rate difference exceeds threshold")
  .param("threshold", { type: "number", default: 0.5 })
  .trigger({ type: "manual" })
  .step(
    compute("calcDiff")
      .assign("rateDiff", literal(0.8))
      .assign("gain", literal(0.3))
      .build()
  )
  .step({
    kind: "conditional",
    id: "shouldRebalance",
    condition: binary(binding("rateDiff"), ">", binding("params.threshold")),
    thenSteps: [successEmit.id],
    elseSteps: [],
    dependsOn: ["calcDiff"],
  })
  .step(successEmit);

const result = await execute({
  spell: strategy.build(),
  vault: "0x0000000000000000000000000000000000000000",
  chain: 1,
  simulate: true,
});
```

## See also

- [Add spells](./add-spells.md)
- [Configure slippage](./configure-slippage.md)
- [CLI cast](./cli-cast.md)
