---
name: grimoire-spell
description: Reference for writing Grimoire .spell files. Use when authoring, debugging, or understanding the Grimoire DSL syntax, triggers, actions, constraints, and state.
---

# Grimoire Spell Authoring Skill

For the full DSL specification see `docs/reference/grimoire-dsl-spec.md`.

Spells are `.spell` files using a Python-like indentation-based syntax (2-space indent).

## Spell Structure

```
spell <Name>

  version: "<semver>"
  description: "<text>"

  assets: [<TOKEN>, ...]

  params:
    <key>: <value>

  limits:
    <key>: <value>

  venues:
    <alias>: @<adapter>
    <group>: [@<adapter1>, @<adapter2>]

  skills:
    <name>:
      type: <swap|yield|lending|staking|bridge>
      adapters: [<alias>, ...]
      default_constraints:
        max_slippage: <bps>

  advisors:
    <name>:
      model: <haiku|sonnet|opus>
      timeout: <seconds>
      fallback: <bool>
      mcp: [<mcp_id>, ...]

  guards:
    <id>: <expression>

  import "<path>" [as <alias>]

  block <name>(<arg>, ...):
    <steps>

  state:
    persistent:
      <key>: <default>
    ephemeral:
      <key>: <default>

  on <trigger>:
    <steps>
```

## Triggers

- `on manual:` - Execute only when explicitly invoked
- `on hourly:` - Schedule hourly execution
- `on daily:` - Schedule daily execution
- `on <cron>:` - Cron schedule
- `on condition <expr> [every <duration>]:` - Polling trigger
- `on event "<event>" [where <expr>]:` - External event trigger

## Actions

Venue methods called on adapter aliases:

```
venue.deposit(asset, amount)
venue.withdraw(asset, amount)
venue.borrow(asset, amount)
venue.repay(asset, amount)
venue.swap(from_asset, to_asset, amount)
venue.bridge(asset, amount, to_chain)
venue.open_long(asset, amount, leverage)
venue.open_short(asset, amount, leverage)
venue.close_position(asset)
venue.spot_buy(asset, amount)
```

Use a skill name as the action target to auto-select a venue from the skill’s adapters (or attach a skill explicitly with `using`):

```
skills:
  dex:
    type: swap
    adapters: [uniswap_v4]

on manual:
  dex.swap(USDC, ETH, params.amount)

on manual:
  dex.swap(USDC, ETH, params.amount) using dex
```

## Action Constraints

Attach slippage/deadline constraints per action using `with`:

```
venue.swap(ETH, USDC, amount) with max_slippage=50, deadline=300
```

For swaps, you can also set explicit bounds:

```
venue.swap(ETH, USDC, amount) with min_output=990000
venue.swap(ETH, USDC, amount) with max_input=1010000
```

Additional constraint keys:
- `max_price_impact` (bps)
- `min_liquidity` (raw amount)
- `require_quote` / `require_simulation` (boolean)
- `max_gas` (wei)

## Control Flow

```
# Conditionals
if condition:
  ...
elif other:
  ...
else:
  ...

# Loops
for item in collection:
  ...
repeat 3:
  ...
loop until done == true max 10:
  ...

# Try/catch
try:
  ...
catch *:
  action: halt

# Parallel branches
parallel join=all on_fail=abort:
  left:
    ...
  right:
    ...

# Pipelines
filtered = items | filter:
  keep = item != "USDT"
| map:
  out = item

# Blocks
block add(a, b):
  sum = a + b

do add(1, 2)

# Ternary
result = condition ? value_a : value_b
```

## Expressions

- Arithmetic: `+`, `-`, `*`, `/`, `%`
- Comparison: `==`, `!=`, `<`, `>`, `<=`, `>=`
- Logical: `and`, `or`, `not`
- Property access: `obj.prop`, `params.key`
- Function calls: `max(a, b)`, `min(x, y)`, `abs(n)`, `sum(arr)`, `avg(arr)`
- Percentages: `50%` (converts to `0.5`)
- Unit literals: `1.5 USDC`, `50 bps` (requires asset decimals for asset units)

## Special Statements

```
emit event_name(key=value, ...)   # Emit a ledger event
halt "reason"                      # Stop execution with reason
wait 3600                          # Wait N seconds
```

## Atomic Blocks

Group operations for all-or-nothing execution:

```
atomic:
  venue.withdraw(USDC, amount)
  venue.deposit(USDC, amount)
```

Failure modes: `atomic revert:` (default), `atomic skip:`, `atomic halt:`.

## Advisory AI

Use `**prompt**` for AI-assisted decisions (optionally `via <advisor>`):

```
if **gas costs justify rebalancing** via risk:
  venue.withdraw(asset, balance)
```

Structured advisory with `advise`:

```
decision = advise risk: "Rate this trade"
  output:
    type: enum
    values: [low, medium, high]
  timeout: 20
  fallback: "medium"
```

Output schema types: `boolean`, `number`, `enum`, `string`, `object`, `array`.

## State

- `persistent:` - Survives across runs (SQLite-backed)
- `ephemeral:` - Reset each run
- Access via the declared variable names (e.g., `run_count = run_count + 1`)

## Output Binding

Capture action return values:

```
result = venue.swap(ETH, USDC, amount)
emit swapped(tx=result)
```

## Supported Venue Adapters

| Adapter | Actions |
|---------|---------|
| `@aave_v3` | deposit, withdraw, borrow, repay |
| `@morpho_blue` | lend, withdraw |
| `@uniswap_v3` | swap |
| `@uniswap_v4` | swap |
| `@hyperliquid` | open_long, open_short, close_position, spot_buy |
| `@across` | bridge |

## Example

```
spell DCAStrategy

  version: "1.0.0"
  description: "Weekly DCA into ETH"

  assets: [USDC, ETH]

  params:
    buy_amount: 100000000

  venues:
    dex: @uniswap_v3

  state:
    persistent:
      total_bought: 0

  on daily:
    dex.swap(USDC, ETH, params.buy_amount) with max_slippage=100

    total_bought = total_bought + 1
    emit bought(count=total_bought)
```
