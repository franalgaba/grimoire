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

  venues:
    uniswap_v3: @uniswap_v3

  on manual:
    uniswap_v3.swap(USDC, WETH, params.amount)
```

## Sections

- `version`, `description`
- `assets`: symbol list
- `params`: parameter map
- `limits`: strategy limits
- `venues`: aliases for venue adapters
- `state`: persistent/ephemeral state
- `on <trigger>`: action blocks

## Triggers

- `on manual:`
- `on hourly:`
- `on daily:`
- `on <cron>:` (schedule)

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
  uniswap_v3.swap(USDC, WETH, params.amount)
  constraints:
    max_slippage: 50
    deadline: 300
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
