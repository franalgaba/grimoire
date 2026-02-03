# Spell syntax reference

Grimoire spells use an indentation-based syntax (2 spaces).

## Top-level structure

```spell
spell Name

  version: "1.0.0"
  description: "..."

  assets: [USDC, WETH]

  params:
    amount: 100

  skills:
    dex:
      type: swap
      adapters: [uniswap_v3, uniswap_v4]

  advisors:
    risk:
      model: "anthropic:sonnet"
      timeout: 30
      fallback: true

  venues:
    uniswap_v3: @uniswap_v3

  on manual:
    uniswap_v3.swap(USDC, WETH, params.amount)
```

## Sections

- `version`, `description`
- `assets`: symbol list or metadata block
- `params`: parameter map (typed or untyped)
- `limits`: strategy limits
- `venues`: aliases for venue adapters
- `skills`: capability modules for routing + defaults
- `advisors`: AI advisors (metadata + defaults)
- `state`: persistent/ephemeral state
- `guards`: pre-execution checks
- `import`, `block`: reusable blocks and imports
- `on <trigger>`: action blocks

## Triggers

- `on manual:`
- `on hourly:`
- `on daily:`
- `on <cron>:` (schedule)
- `on condition <expr> [every <duration>]:`
- `on event "<event>" [where <expr>]:`

## Actions

Method calls map to action types:

- `deposit`, `supply` → `lend`
- `withdraw` → `withdraw`
- `borrow` → `borrow`
- `repay` → `repay`
- `swap` → `swap`
- `bridge` → `bridge`
- `transfer` → `transfer`
- `claim` → `claim`

Example:

```spell
on manual:
  uniswap_v3.swap(USDC, WETH, params.amount)
  across.bridge(USDC, params.amount, params.destination_chain)
```

`bridge` expects `to_chain` to resolve to a numeric chain id at runtime.

## Constraints

Attach constraints to an action step:

```spell
on manual:
  uniswap_v3.swap(USDC, WETH, params.amount) with max_slippage=50, deadline=300
```

For swaps, you can specify explicit bounds:

```spell
on manual:
  uniswap_v3.swap(USDC, WETH, params.amount) with min_output=990000
```

Additional constraint keys:

- `max_price_impact` (bps)
- `min_liquidity` (raw amount)
- `require_quote` / `require_simulation` (boolean)
- `max_gas` (wei)

## Output binding

Capture action output:

```spell
result = uniswap_v3.swap(USDC, WETH, params.amount)
emit swapped(tx=result)
```

## Expressions

Supports arithmetic, comparison, logical ops, and ternaries:

```spell
x = (params.amount * 2) + 1
if x > 10 and not halted:
  emit done(value=x)
```

## Advisory prompts

```spell
if **is this safe?**:
  emit safe()
```

## Advise statement (structured advisory)

```spell
decision = advise risk: "Is this trade safe?"
  output:
    type: boolean
  timeout: 20
  fallback: true
```

Output schema types: `boolean`, `number`, `enum`, `string`, `object`, `array`.

```spell
decision = advise risk: "Assess trade"
  output:
    type: object
    fields:
      allow:
        type: boolean
      confidence:
        type: number
        min: 0
        max: 1
  timeout: 20
  fallback: true
```

## Using skills (auto-select venues)

```spell
skills:
  dex:
    type: swap
    adapters: [uniswap_v4]
    default_constraints:
      max_slippage: 50

on manual:
  dex.swap(USDC, WETH, params.amount)

# Optional: explicitly apply defaults
on manual:
  dex.swap(USDC, WETH, params.amount) using dex
```

## Typed params and unit literals

```spell
assets:
  USDC:
    decimals: 6

params:
  amount:
    type: amount
    asset: USDC
    default: 1.5 USDC
  slippage:
    type: bps
    default: 50 bps
  interval:
    type: duration
    default: 5m
```

Unit literals require asset decimals to be defined.

## Control flow

- `repeat 3:` — fixed-count loop
- `loop until <cond> max 10:` — loop with safety cap
- `try:` / `catch:` / `finally:` — error handling and retry
- `parallel join=all:` — concurrent branches
- `pipeline` with `| map:` / `| filter:` / `| reduce:` stages
