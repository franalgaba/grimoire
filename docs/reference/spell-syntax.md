# Spell Syntax Reference

This reference mirrors the brace-delimited parser in `packages/core/src/compiler/grimoire/parser.ts` and tokenizer in `packages/core/src/compiler/grimoire/tokenizer.ts`.

## Top-Level Form

```spell
spell MySpell {
  version: "1.0.0"
  description: "..."

  assets: [USDC, WETH]
  params: { amount: 1000000 }
  venues: { dex: @uniswap_v3 }

  on manual: {
    emit started()
  }
}
```

Required:

- `spell <Identifier> { ... }`

Optional top-level sections:

- `version`
- `description`
- `assets`
- `params`
- `limits`
- `venues`
- `state`
- `skills`
- `advisors`
- `guards`
- `import`
- `block`
- one or more `on ...: { ... }` handlers

## Sections

### `assets`

Forms:

```spell
assets: [USDC, WETH,]
```

```spell
assets: {
  USDC: {
    chain: 8453
    address: "0x..."
    decimals: 6
  }
}
```

Notes:

- Trailing commas in lists are accepted.
- `decimals` is used by transformer unit conversion (`1.5 USDC` style literals).

### `params`

Simple values:

```spell
params: {
  amount: 1000000
  enabled: true
}
```

Extended values:

```spell
params: {
  amount: {
    type: amount
    asset: USDC
    default: 1.5 USDC
    min: 0
    max: 1000000
  }
}
```

### `limits`

```spell
limits: {
  max_single_move: 500000
  approval_required_above: 100000
}
```

Transformer stores these as params prefixed with `limit_`.

### `venues`

```spell
venues: {
  uniswap_v3: @uniswap_v3
  lending: [@aave_v3, @morpho_blue,]
}
```

### `state`

```spell
state: {
  persistent: {
    counter: 0
  }
  ephemeral: {
    temp: 0
  }
}
```

### `skills`

```spell
skills: {
  dex: {
    type: swap
    adapters: [uniswap_v3]
    default_constraints: {
      max_slippage: 50
    }
  }
}
```

### `advisors`

```spell
advisors: {
  risk: {
    model: anthropic:sonnet
    system_prompt: "Return strict JSON"
    skills: [grimoire]
    allowed_tools: [read_file]
    mcp: [docs]
    timeout: 30
    fallback: true
    rate_limit: {
      max_per_run: 10
      max_per_hour: 100
    }
  }
}
```

### `guards`

```spell
guards: {
  enough_balance: balance(USDC) > 1000 with (
    severity="halt",
    message="Insufficient balance",
  )
}
```

Guard metadata keys in `with` clause:

- `severity`: `warn | revert | halt` (advisory guards support `pause` semantics downstream)
- `message`
- `fallback`

## Triggers

Trigger handler form:

```spell
on <trigger>: {
  ...
}
```

Supported trigger kinds:

- `manual`
- `hourly`
- `daily`
- schedule string: `on "0 * * * *": { ... }`
- condition: `on condition <expr> every <seconds>: { ... }`
- event: `on event "EventName" where <expr>: { ... }`

Multiple trigger handlers compile into `trigger.any`.

## Statements

Supported statements in block bodies:

- assignment: `x = expr`
- action/method call: `venue.swap(...)`
- `if / elif / else`
- `for x in expr { ... }`
- `repeat N { ... }`
- `loop until cond max N { ... }`
- `try { ... } catch ... { ... } finally { ... }`
- `parallel ... { branch: { ... } }`
- pipeline: `source | map: { ... } | ...`
- `do blockName(args)`
- `atomic { ... }` and `atomic skip|halt|revert { ... }`
- `emit event(k=v, ...)`
- `halt "reason"`
- `wait 60`
- `pass`
- advisory assignment: `x = advise advisor: "prompt" { ... }`

## Action Routing Syntax

Method calls on venue-like objects compile to action steps.

Examples:

```spell
uniswap_v3.swap(USDC, WETH, params.amount)
aave_v3.lend(USDC, amount)
aave_v3.borrow(USDC, amount, WETH)
morpho_blue.supply_collateral(WETH, amount, "weth-usdc-86")
morpho_blue.withdraw_collateral(WETH, amount, "weth-usdc-86")
across.bridge(USDC, amount, 42161)
```

Optional clauses:

- `using <skill>`
- `with key=value, ...` or multiline `with ( ... )`

Constraint alias normalization in transformer:

- `slippage` -> `max_slippage`
- `min_out` -> `min_output`
- `max_in` -> `max_input`

Morpho market routing:

- `lend`, `withdraw`, `repay` support optional third arg `market_id`.
- `borrow` supports optional fourth arg `market_id` (after collateral).
- `supply_collateral` and `withdraw_collateral` support optional third arg `market_id`.

Address literal formatting (important):

- Use bare address literals when an address-like token value is intended.
- Quoted address-like strings trigger validator error `QUOTED_ADDRESS_LITERAL`.

Good:

```spell
pendle.swap(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48, PT, amount)
pendle.add_liquidity(USDC, amount, [0x..., 0x...])
```

Bad:

```spell
pendle.swap("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", PT, amount)
pendle.add_liquidity(USDC, amount, ["0x...", "0x..."])
```

Typical diagnostic:

- `Detected quoted address literal "0x...". Use bare address literal 0x... (without quotes).`

## Advisory Syntax

Inline advisory expressions (`**...**`) are intentionally unsupported.

Supported statement form:

```spell
decision = advise risk: "Should we rebalance?" {
  context: {
    current_rate: rate
    gas: gas_cost
  }
  within: "execution"
  output: {
    type: object
    fields: {
      allow: boolean
      reason: string
    }
  }
  on_violation: reject
  clamp_constraints: [max_slippage]
  timeout: 20
  fallback: { allow: false, reason: "timeout" }
}
```

Required fields:

- `output`
- `timeout`
- `fallback`

Advisory field reference:

| Field | Required | Type | Notes |
|---|---|---|---|
| `context` | no | object | Runtime expressions passed as named inputs. Missing context emits a validator warning (strict mode fails). |
| `within` | no | string or identifier | Policy scope label. Missing scope emits a validator warning (strict mode fails). |
| `output` | yes | schema | Declares expected advisory output shape and type. |
| `on_violation` | no | `reject` \| `clamp` | Default is `reject`. Omitted policy emits validator warning (strict mode fails). |
| `clamp_constraints` | conditional | list of strings | Required when `on_violation: clamp`. |
| `timeout` | yes | number | Must be positive. |
| `fallback` | yes | expression | Used when advisory handler is unavailable/fails. |

Output schema supports:

| Type | Extra keys |
|---|---|
| `boolean` | none |
| `number` | `min`, `max` |
| `enum` | `values` |
| `string` | `min_length`, `max_length`, `pattern` |
| `object` | `fields` |
| `array` | `items` |

Examples:

```spell
output: boolean
```

```spell
output: {
  type: object
  fields: {
    allow: boolean
    reason: string
    max_slippage_bps: {
      type: number
      min: 1
      max: 500
    }
  }
}
```

Runtime behavior summary:

- handler output (or fallback output) is validated against `output`
- `on_violation: reject` fails the advisory step on schema mismatch
- `on_violation: clamp` attempts schema coercion, then fails if still invalid

For end-to-end usage patterns, see `docs/how-to/use-advisory-decisions.md`.

## Expressions

Operator precedence (highest to lowest):

1. postfix (`.`, `[]`, call)
2. unary (`not`, unary `-`)
3. multiplicative (`* / %`)
4. additive (`+ -`)
5. comparison (`< > <= >=`)
6. equality (`== !=`)
7. logical `and`
8. logical `or`
9. ternary `? :`

Expression forms:

- literals: numbers, booleans, strings, addresses
- percentages: `50%`
- unit literals: `1.5 USDC`, `25 bps`, `5m`, `1h`, `1d`
- arrays: `[a, b,]`
- objects: `{ key: value, ... }` (multiline supported)
- identifiers and keyword-like identifiers in expression context
- property access and indexing
- function calls (`min`, `max`, `balance`, `price`, ...)
  - `price(base, quote)` or `price(base, quote, source?)` where `source` is an optional string (e.g. `"chainlink"`)
  - `balance(asset)` or `balance(asset, address?)` where `address` is an optional address

## Constraints Clause

Supported forms:

```spell
... with max_slippage=50, deadline=300
```

```spell
... with (
  max_slippage=50,
  deadline=300,
  min_output=1000,
)
```

Both forms accept trailing commas.

## Comments and Newlines

- `#` starts a line comment.
- Newlines separate statements inside `{}` blocks.
- Newlines inside `()` and `[]` are suppressed by tokenizer — commas are required as separators in these contexts (e.g. `with (...)`, `emit foo(...)`, array literals).
- Braces `{}` are structural; blocks always use braces.
