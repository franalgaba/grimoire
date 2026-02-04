# Transition from VM to deterministic execution

This guide shows how to move a spell from VM prototyping (snapshot-driven) to deterministic execution with adapters.

## 1) Keep the spell logic, replace snapshots

VM mode uses `params` snapshots. For deterministic execution you should:

- Keep the same spell logic.
- Remove snapshot-only params when they are no longer needed.
- Replace snapshot-derived values with live queries or deterministic inputs.

Example change:

```spell
# VM version
best_apy = max(params.vault_net_apys)
```

```spell
# Deterministic version (uses live queries)
best_apy = max(
  get_apy(@morpho_blue, USDC),
  get_apy(@aave_v3, USDC)
)
```

## 2) Define venues, assets, and limits

Deterministic runs require concrete venues, assets, and constraints.

```spell
venues:
  aave_v3: @aave_v3
  morpho_blue: @morpho_blue

assets:
  USDC: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48

limits:
  max_per_venue: 50%
```

## 3) Add hard execution constraints

For swaps, define both slippage and a min output (or max input). This prevents loss during execution.

```spell
constraints:
  max_slippage: 50
  min_output: 990000000  # 990 USDC out
```

## 4) Simulate first

Run deterministic logic with adapters in dry-run mode:

```bash
grimoire simulate spells/my-spell.spell --chain 1 --rpc-url <rpc>
```

For actions, use `cast --dry-run` to see the transaction plan without sending:

```bash
grimoire cast spells/my-spell.spell --chain 1 --rpc-url <rpc> --dry-run --key-env PRIVATE_KEY
```

## 5) Execute deterministically

When you are happy with the simulation, execute with `cast`:

```bash
grimoire cast spells/my-spell.spell --chain 1 --rpc-url <rpc> --key-env PRIVATE_KEY
```

## 6) Keep guardrails on

- Use guards to stop execution when balances or conditions are wrong.
- Keep limits and constraints strict.
- Prefer `simulate` before every production change.
