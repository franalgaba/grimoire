# Grimoire DSL Specification

A complete reference for the Grimoire `.spell` language. This document is self-contained — any LLM or developer can use it to author valid spell files.

---

## Overview

Grimoire is a domain-specific language for defining onchain DeFi strategies. Spells are written in `.spell` files using **Python-like indentation** (2-space indent). They compile to an intermediate representation (IR) and execute against venue adapters (Aave, Uniswap, Morpho, Hyperliquid, Across).

---

## Spell Structure

Every spell follows this top-level structure. All sections except `spell <Name>` and at least one `on <trigger>:` block are optional.

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
      model: "<provider:model>"
      system_prompt: "<text>"
      skills: [<advisor_skill>, ...]
      allowed_tools: [<tool_id>, ...]
      mcp: [<mcp_id>, ...]
      timeout: <seconds>
      fallback: <bool>
      rate_limit:
        max_per_run: <n>
        max_per_hour: <n>

  state:
    persistent:
      <key>: <default_value>
    ephemeral:
      <key>: <default_value>

  guards:
    <id>: <expression>

  import "<path>" [as <alias>]

  block <name>(<arg>, ...):
    <statements>

  on <trigger>:
    <statements>
```

---

## Indentation

- Use **2 spaces** per indent level (tabs are converted to 2 spaces).
- Block bodies (triggers, if/else, for, atomic) must be indented one level deeper than their parent.
- Sections inside `spell` are indented once (2 spaces).
- Trigger bodies are indented twice (4 spaces from the left margin).

---

## Comments

Single-line comments start with `#`:

```
# This is a comment
amount = 100  # inline comment
```

No block comments.

---

## Literals

### Numbers

Integer or decimal. Supports duration suffixes:

| Suffix | Multiplier | Example |
|--------|-----------|---------|
| `s` | 1 | `30s` = 30 |
| `m` | 60 | `5m` = 300 |
| `h` | 3600 | `1h` = 3600 |
| `d` | 86400 | `7d` = 604800 |

```
amount: 100000
threshold: 0.5
timeout: 5m
```

### Strings

Single or double quoted. Supports escape sequences `\n`, `\t`, `\r`, `\\`, `\"`, `\'`:

```
description: "Yield optimizer strategy"
label: 'hello world'
```

### Booleans

```
true
false
```

### Addresses

Hex-prefixed EVM addresses:

```
vault: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
```

### Percentages

Converted to decimals at parse time:

```
50%      # becomes 0.5
0.3%     # becomes 0.003
25%      # becomes 0.25
```

### Arrays

```
assets: [USDC, ETH, DAI]
```

---

## Sections

### `spell <Name>`

Required. Declares the spell name (PascalCase by convention):

```
spell YieldOptimizer
```

### `version`

Semantic version string:

```
version: "1.0.0"
```

### `description`

Human-readable description:

```
description: "Optimizes yield across lending protocols"
```

### `assets`

Token symbols the spell interacts with:

```
assets: [USDC, ETH, WETH, DAI]
```

Block form with metadata:

```
assets:
  USDC:
    chain: 1
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
    decimals: 6
  ETH:
    decimals: 18
```

### `params`

Named parameters with default values. Params are immutable during execution and can be overridden at runtime:

```
params:
  amount: 100000
  threshold: 0.5
  min_trade: 50000
  label: "default"
```

Access via `params.<key>` in expressions.

Typed params (block form):

```
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

### `limits`

Named limits/caps. Accessible as `limit_<key>` in expressions:

```
limits:
  max_allocation: 1000000
  min_trade_size: 100000
  max_slippage: 50
  max_per_venue: 50%
```

### `venues`

Map aliases to venue adapters. Use `@` prefix for adapter references:

```
venues:
  dex: @uniswap_v3
  lending: @aave_v3
  bridge: @across
```

Group multiple adapters under one alias:

```
venues:
  lending: [@aave_v3, @morpho_blue]
  swap: @uniswap_v3
```

**Available adapters:**

| Adapter | Category | Actions |
|---------|----------|---------|
| `@aave_v3` | Lending | deposit, withdraw, borrow, repay |
| `@morpho_blue` | Lending | lend, withdraw |
| `@uniswap_v3` | DEX | swap |
| `@uniswap_v4` | DEX | swap |
| `@hyperliquid` | Perps | open_long, open_short, close_position, spot_buy |
| `@across` | Bridge | bridge |

### `skills`

Skills define reusable capability modules for routing and defaults. Use `using <skill>` on an action to apply it.

```
skills:
  dex:
    type: swap
    adapters: [uniswap_v3, uniswap_v4]
    default_constraints:
      max_slippage: 50
```

- `type` is informational (used for validation and tooling).
- `adapters` is a list of **venue aliases**.
- `default_constraints` are merged into the action if the action does not specify them.

### `advisors`

Advisors define AI judgement defaults and metadata for tooling.

```
advisors:
  risk:
    model: "anthropic:sonnet"
    system_prompt: "Be conservative and concise."
    skills: [web-search]
    allowed_tools: [web.search, x.search]
    mcp: [company-kb, market-data]
    timeout: 30
    fallback: true
    rate_limit:
      max_per_run: 10
      max_per_hour: 100
```

Notes:
- Use quotes for namespaced model IDs (e.g. `"anthropic:sonnet"`).
- `skills` here refers to **advisor skills** (Agent Skills directories), not the spell `skills` section.
- `allowed_tools`, `skills`, and `mcp` are emitted in advisory ledger events for external orchestrators.
- The runtime calls external advisory when configured (spell model, CLI model/provider, or Pi defaults). If no model is available, it uses `fallback`.

### `state`

Declare persistent and ephemeral state variables with initial values:

```
state:
  persistent:
    run_count: 0
    total_deposited: 0
  ephemeral:
    temp_value: 0
    current_rate: 0
```

- **Persistent** state survives across runs (SQLite-backed).
- **Ephemeral** state resets to initial values each run.

Access and mutate directly by name in the trigger body:

```
on manual:
  run_count = run_count + 1
  temp_value = params.amount * 2
```

### `guards`

Pre-conditions checked before execution. If a guard fails, execution halts:

```
guards:
  max_amount: params.amount < 1000000
  positive_amount: params.amount > 0
```

You can attach metadata with `with`:

```
guards:
  max_amount: params.amount < 1000000 with severity="halt", message="Too large"
  safety_check: **is this safe?** with severity="warn", fallback=true
```

Guards can use advisory prompts:

```
guards:
  safety_check: **is the market stable enough to proceed**
```

---

## Triggers

One or more `on <trigger>:` blocks define when the spell executes:

| Trigger | Description |
|---------|-------------|
| `on manual:` | Only when explicitly invoked |
| `on hourly:` | Scheduled hourly execution |
| `on daily:` | Scheduled daily execution |
| `on <cron>:` | Scheduled by cron expression |
| `on condition <expr> [every <duration>]:` | Condition-based polling trigger |
| `on event "<event>" [where <expr>]:` | External event trigger |

Multiple triggers in one spell:

```
on hourly:
  hourly_count = hourly_count + 1
  emit hourly_tick(count=hourly_count)

on daily:
  daily_count = daily_count + 1
  emit daily_tick(count=daily_count)
```

Condition trigger example:

```
on condition price(ETH) > params.threshold every 5m:
  emit price_check(threshold=params.threshold)
```

Event trigger example:

```
on event "base.block" where block.number % 100 == 0:
  emit checkpoint(block=block.number)
```

---

## Expressions

### Arithmetic

```
a + b       # addition
a - b       # subtraction
a * b       # multiplication
a / b       # division
a % b       # modulo
```

### Comparison

```
a == b      # equal
a != b      # not equal
a < b       # less than
a > b       # greater than
a <= b      # less or equal
a >= b      # greater or equal
```

### Logical

```
a and b     # logical AND
a or b      # logical OR
not a       # logical NOT
```

### Ternary

```
result = condition ? value_if_true : value_if_false
```

### Property Access

```
params.amount
state.persistent.counter
obj.field
```

### Array Access

```
assets[0]
rates[i]
```

### Parentheses

```
result = (a + b) * c
```

---

## Built-in Functions

| Function | Description | Example |
|----------|-------------|---------|
| `min(a, b)` | Minimum of two values | `min(rate_a, rate_b)` |
| `max(a, b)` | Maximum of two values | `max(0, balance - fee)` |
| `abs(n)` | Absolute value | `abs(price_diff)` |
| `sum(arr)` | Sum array elements | `sum(rates)` |
| `avg(arr)` | Average array elements | `avg(rates)` |

### Async Functions (Blockchain Queries)

| Function | Description |
|----------|-------------|
| `balance(asset, [address])` | Query token balance |
| `price(base, quote)` | Query token price |
| `get_apy(venue, asset)` | Query yield APY |
| `get_health_factor(venue)` | Query lending health factor |
| `get_position(venue, asset)` | Query position info |
| `get_debt(venue, asset)` | Query debt amount |

---

## Statements

### Assignment

```
variable = expression
```

Examples:

```
rate = 0.05
diff = best_rate - current_rate
label = params.amount > 1000 ? "large" : "small"
```

### Action Calls

Call venue methods using adapter aliases (the `@...` references) or a skill name:

```
aave_v3.deposit(USDC, params.amount)
uniswap_v3.swap(USDC, ETH, params.amount)
across.bridge(USDC, params.amount, 42161)
```

**All action signatures:**

```
# Lending
<venue>.deposit(asset, amount)
<venue>.withdraw(asset, amount)
<venue>.borrow(asset, amount)
<venue>.repay(asset, amount)
<venue>.lend(asset, amount)

# Swaps
<venue>.swap(asset_in, asset_out, amount)

# Bridge
<venue>.bridge(asset, amount, to_chain)

# Perps (Hyperliquid)
<venue>.open_long(asset, amount, leverage)
<venue>.open_short(asset, amount, leverage)
<venue>.close_position(asset)
<venue>.spot_buy(asset, amount)
```

### Using Skills (Auto-select Venues)

If the action’s venue matches a skill name, the runtime auto-selects the first matching adapter from that skill (a validator warning is emitted). You can still attach a skill explicitly with `using`.

```
skills:
  dex:
    type: swap
    adapters: [uniswap_v4]
    default_constraints:
      max_slippage: 50

on manual:
  dex.swap(USDC, ETH, params.amount)

on manual:
  dex.swap(USDC, ETH, params.amount) using dex
```

### Output Binding

Capture the return value of an action:

```
result = uniswap_v3.swap(USDC, ETH, params.amount)
emit swapped(output=result)
```

### Action Constraints

Attach constraints to an action using `with`:

```
uniswap_v3.swap(USDC, ETH, params.amount) with slippage=50, deadline=300
```

**Available constraint keys (spell syntax):**

| Key | Type | Description |
|-----|------|-------------|
| `slippage` / `max_slippage` | number | Max slippage in basis points |
| `deadline` | number | Transaction deadline in seconds |
| `min_output` | number/expr | Exact-in swaps: minimum output |
| `max_input` | number/expr | Exact-out swaps: maximum input |
| `max_price_impact` | number | Max price impact in basis points |
| `min_liquidity` | number/expr | Minimum available liquidity |
| `require_quote` | boolean/expr | Require a quote before execution |
| `require_simulation` | boolean/expr | Require a simulation before execution |
| `max_gas` | number/expr | Max gas cost (wei) |

All listed ActionConstraints fields are parsed from `.spell` files.

### Conditionals

```
if condition:
  ...
elif other_condition:
  ...
else:
  ...
```

Conditions can be expressions or advisory prompts (optionally `via <advisor>`):

```
if params.amount > params.threshold:
  emit large_trade(amount=params.amount)
elif params.amount > params.min_amount:
  emit medium_trade(amount=params.amount)
else:
  emit small_trade(amount=params.amount)
```

### For Loops

Iterate over arrays:

```
for asset in assets:
  emit checked(asset=asset)
```

Loop index is available via the `index` variable in the IR, but typically tracked manually:

```
for asset in assets:
  counter = counter + 1
  emit checked(asset=asset, index=counter)
```

### Repeat Loops

Repeat a fixed number of times:

```
repeat 3:
  emit tick()
```

### Loop Until

Loop until a condition is met (with a safety cap):

```
loop until done == true max 10:
  emit checking()
```

### Try / Catch / Finally

```
try:
  uniswap_v3.swap(USDC, ETH, params.amount)
catch slippage_exceeded:
  retry:
    max_attempts: 3
    backoff: exponential
    backoff_base: 1000
catch *:
  action: halt
finally:
  emit completed()
```

### Parallel

Run branches concurrently and join:

```
parallel join=all on_fail=abort:
  left:
    emit a()
  right:
    emit b()
```

Join types: `all`, `first`, `best` (with `metric`/`order`), `any` (with `count`), `majority`.

### Pipeline

Functional pipelines transform arrays. Stage bodies run with `item` and `index` bound (and `acc` for reduce):

```
filtered = assets | filter:
  keep = item != "USDT"
| map:
  out = item
```

### Blocks and Imports

Define reusable blocks and invoke them with `do`:

```
block add(a, b):
  sum = a + b
  emit added(sum=sum)

on manual:
  do add(2, 3)
```

Imports can bring in blocks from other `.spell` files:

```
import "blocks/common.spell" as common

on manual:
  do common.add(2, 3)
```

Imported blocks are namespaced by their import alias (or file stem if no alias).

### Atomic Blocks

Group operations for all-or-nothing execution:

```
atomic:
  aave_v3.withdraw(USDC, balance)
  morpho_blue.lend(USDC, balance)
```

With failure modes:

```
atomic revert:
  aave_v3.deposit(USDC, params.amount)
  aave_v3.deposit(USDC, params.amount)
```
Failure modes: `revert` (default), `skip`, `halt`.

### Emit

Emit a named event with key-value data. Events are recorded in the ledger:

```
emit event_name(key1=value1, key2=value2)
```

Examples:

```
emit swap_executed(asset=USDC, amount=params.amount)
emit rebalanced(gain=best_rate - current_rate)
emit counter_updated(run_count=run_count, total=total_amount)
```

### Halt

Stop execution with a reason string:

```
halt "Amount exceeds safety limit"
```

Typically used inside a conditional:

```
if params.amount > limit_max_allocation:
  halt "Exceeds max allocation"
```

### Wait

Pause execution for a number of seconds:

```
wait 3600       # wait 1 hour
wait 5          # wait 5 seconds
wait 5m         # wait 5 minutes (using duration suffix)
```

### Pass

No-op placeholder:

```
if condition:
  pass
else:
  emit something()
```

---

## Advisory AI

Use `**prompt**` to defer a decision to an AI advisor. The prompt is wrapped in double asterisks and can optionally specify an advisor with `via`:

```
if **should we swap ETH to USDC given current market conditions** via risk:
  uniswap_v3.swap(ETH, USDC, params.amount)
  emit ai_approved_swap(amount=params.amount)
else:
  emit ai_rejected_swap(reason="advisory_declined")
```

Advisory prompts return a boolean decision. They can be used anywhere a condition is expected.

### Advise statement (structured output)

```
decision = advise risk: "Rate this trade's risk level"
  output:
    type: enum
    values: [low, medium, high]
  timeout: 30
  fallback: "medium"
```

Output schema types:
- `boolean`
- `number` (optional `min` / `max`)
- `enum` (required `values`)
- `string` (optional `min_length` / `max_length` / `pattern`)
- `object` (use `fields`)
- `array` (use `items`)

Example object schema:

```
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

Note: the runtime calls external advisory when configured (spell model, CLI model/provider, or Pi defaults). If no model is available, it uses `fallback`. You can supply an external advisory handler (see Core API `onAdvisory`) to execute agent judgments; skills/allowed tools/mcp are emitted for external orchestrators.

---

## Amount Conventions

Amounts in spells are **raw token amounts** (smallest unit) unless you use unit literals:

| Token | Decimals | Raw Amount | Human Amount |
|-------|----------|-----------|--------------|
| USDC | 6 | `100000` | 0.1 USDC |
| USDC | 6 | `1000000` | 1.0 USDC |
| ETH/WETH | 18 | `1000000000000000` | 0.001 ETH |
| ETH/WETH | 18 | `200000000000000` | 0.0002 ETH |
| DAI | 18 | `1000000000000000000` | 1.0 DAI |

Venue adapters handle any necessary conversions internally.

Unit literals (require asset `decimals` in the `assets` section):

```
assets:
  USDC:
    decimals: 6

params:
  amount: 1.5 USDC   # → 1500000
```

---

## Complete Examples

### Simple Swap

```
spell SimpleSwap

  version: "1.0.0"
  description: "Swap ETH to USDC on Uniswap V4"

  assets: [ETH, USDC]

  params:
    amount: 200000000000000

  venues:
    dex: @uniswap_v4

  on manual:
    uniswap_v4.swap(ETH, USDC, params.amount)
    emit swap_complete(amount=params.amount)
```

### Lending with Guards

```
spell SafeDeposit

  version: "1.0.0"
  description: "Deposit USDC to Aave with safety guards"

  assets: [USDC]

  params:
    amount: 100000

  guards:
    positive: params.amount > 0
    max_cap: params.amount < 10000000

  venues:
    lending: @aave_v3

  on manual:
    aave_v3.deposit(USDC, params.amount)
    emit deposited(amount=params.amount)
```

### DCA Strategy with State

```
spell DCAStrategy

  version: "1.0.0"
  description: "Weekly dollar-cost average into ETH"

  assets: [USDC, ETH]

  params:
    buy_amount: 1000000

  venues:
    dex: @uniswap_v3

  state:
    persistent:
      total_bought: 0
      total_spent: 0

  on daily:
    dex.swap(USDC, ETH, params.buy_amount) with max_slippage=100

    total_bought = total_bought + 1
    total_spent = total_spent + params.buy_amount
    emit bought(count=total_bought, spent=total_spent)
```

### Multi-Venue Rebalance

```
spell LendingRebalance

  version: "1.0.0"
  description: "Rebalance lending position between Aave and Morpho"

  assets: [USDC]

  params:
    amount: 1000000
    threshold: 0.5

  venues:
    aave: @aave_v3
    morpho: @morpho_blue

  on hourly:
    if **should we rebalance based on current rates**:
      atomic:
        aave_v3.withdraw(USDC, params.amount)
        morpho_blue.lend(USDC, params.amount)
      emit rebalanced(amount=params.amount)
    else:
      emit skipped(reason="advisory_declined")
```

### Cross-Chain Bridge

```
spell BridgeToArbitrum

  version: "1.0.0"
  description: "Bridge USDC from Base to Arbitrum"

  assets: [USDC]

  params:
    amount: 3000000
    destination_chain: 42161

  venues:
    bridge: @across

  on manual:
    across.bridge(USDC, params.amount, params.destination_chain)
    emit bridge_submitted(asset=USDC, amount=params.amount, to_chain=params.destination_chain)
```

### Conditional Multi-Step

```
spell ConditionalTrader

  version: "1.0.0"
  description: "Swap with size-based routing"

  assets: [ETH, USDC]

  params:
    amount: 200000000000000
    large_threshold: 1000000000000000
    slippage_normal: 50
    slippage_large: 100

  venues:
    dex: @uniswap_v4

  on manual:
    if params.amount > params.large_threshold:
      uniswap_v4.swap(ETH, USDC, params.amount) with slippage=params.slippage_large
      emit large_swap(amount=params.amount)
    else:
      uniswap_v4.swap(ETH, USDC, params.amount) with slippage=params.slippage_normal
      emit normal_swap(amount=params.amount)
```

### Perps Trading

```
spell PerpLong

  version: "1.0.0"
  description: "Open a leveraged long on Hyperliquid"

  assets: [ETH]

  params:
    size: 50
    leverage: 3

  venues:
    perps: @hyperliquid

  on manual:
    hyperliquid.open_long(ETH, params.size, params.leverage)
    emit position_opened(asset=ETH, size=params.size, leverage=params.leverage)
```

### Loop with State Tracking

```
spell AssetScanner

  version: "1.0.0"
  description: "Scan all assets and emit status events"

  assets: [USDC, ETH, WETH, DAI]

  state:
    persistent:
      scan_count: 0
    ephemeral:
      assets_checked: 0

  on hourly:
    scan_count = scan_count + 1
    for asset in assets:
      assets_checked = assets_checked + 1
      emit asset_status(asset=asset, scan=scan_count, index=assets_checked)
    emit scan_complete(total=assets_checked, scan_number=scan_count)
```

### Elif Chain with Limits

```
spell TieredTrader

  version: "1.0.0"
  description: "Route trades by size tier"

  assets: [USDC, ETH]

  params:
    amount: 500000

  limits:
    tier1_cap: 100000
    tier2_cap: 500000
    tier3_cap: 1000000

  venues:
    dex: @uniswap_v3

  on manual:
    if params.amount > limit_tier3_cap:
      halt "Amount exceeds maximum tier"
    elif params.amount > limit_tier2_cap:
      uniswap_v3.swap(USDC, ETH, params.amount) with slippage=150
      emit tier3_swap(amount=params.amount)
    elif params.amount > limit_tier1_cap:
      uniswap_v3.swap(USDC, ETH, params.amount) with slippage=100
      emit tier2_swap(amount=params.amount)
    else:
      uniswap_v3.swap(USDC, ETH, params.amount) with slippage=50
      emit tier1_swap(amount=params.amount)
```

---

## Syntax Quick Reference

| Feature | Syntax | Example |
|---------|--------|---------|
| Spell declaration | `spell Name` | `spell YieldOptimizer` |
| Version | `version: "x.y.z"` | `version: "1.0.0"` |
| Description | `description: "text"` | `description: "My strategy"` |
| Assets | `assets: [A, B]` | `assets: [USDC, ETH]` |
| Params | `key: value` | `amount: 100000` |
| Limits | `key: value` | `max_slippage: 50` |
| Skills | `skills:` | `skills: ...` |
| Advisors | `advisors:` | `advisors: ...` |
| Venue ref | `@name` | `@aave_v3` |
| Percentage | `N%` | `50%` (= 0.5) |
| Duration | `Ns/m/h/d` | `5m` (= 300) |
| Trigger | `on trigger:` | `on hourly:` |
| If/elif/else | `if cond:` | `if x > 0:` |
| For loop | `for x in y:` | `for asset in assets:` |
| Repeat loop | `repeat N:` | `repeat 3:` |
| Loop until | `loop until cond max N:` | `loop until done max 10:` |
| Try/catch | `try:` | `try: ... catch *:` |
| Parallel | `parallel ...:` | `parallel join=all:` |
| Pipeline | `expr | map:` | `items | map:` |
| Block | `block name():` | `block add(a,b):` |
| Do | `do name()` | `do add(1,2)` |
| Atomic | `atomic:` | Transaction batching |
| Emit | `emit name(k=v)` | `emit done(x=1)` |
| Halt | `halt "reason"` | `halt "too risky"` |
| Wait | `wait N` | `wait 3600` |
| Advisory | `**prompt**` | `if **is this safe**:` |
| Advise | `x = advise advisor:` | `decision = advise risk: "..."` |
| Ternary | `a ? b : c` | `x > 0 ? x : 0` |
| Constraints | `with k=v` | `with slippage=50` |
| Using skill | `using name` | `swap(...) using dex` |
| Output binding | `v = action()` | `r = dex.swap(...)` |
| Logical ops | `and`, `or`, `not` | `if a > 0 and b < 10:` |
| Comment | `# text` | `# Calculate rate` |
| State access | `variable` | `run_count = run_count + 1` |
| Param access | `params.key` | `params.amount` |
| Limit access | `limit_key` | `limit_max_allocation` |

---

## Common Patterns

### Guard + Action

```
if params.amount > limit_max:
  halt "Exceeds limit"
aave_v3.deposit(USDC, params.amount)
```

### Conditional Action with Fallback

```
if params.amount > params.threshold:
  uniswap_v3.swap(USDC, ETH, params.amount)
  emit swapped(amount=params.amount)
else:
  emit skipped(reason="below_threshold")
```

### Accumulate State Across Runs

```
state:
  persistent:
    total: 0

on daily:
  total = total + params.increment
  emit updated(total=total)
```

### Atomic Rebalance

```
atomic:
  aave_v3.withdraw(USDC, amount)
  morpho_blue.lend(USDC, amount)
```

### AI-Gated Execution

```
if **market conditions are favorable for this trade**:
  uniswap_v3.swap(ETH, USDC, params.amount)
else:
  emit ai_declined()
```
