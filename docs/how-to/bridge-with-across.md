# How To Bridge With Across

This procedure uses the `across` adapter through a Grimoire spell.

## 1. Define a Bridge Spell

Example:

```spell
spell BridgeUsdcBaseToArb {
  assets: [USDC]

  venues: {
    across: @across
  }

  params: {
    amount: 1000000
  }

  on manual: {
    across.bridge(USDC, params.amount, 42161) with (
      max_slippage=50,
      min_output=990000,
    )
  }
}
```

Notes:

- `to_chain` must resolve to a numeric chain ID for Across runtime path.
- Use both `max_slippage` and `min_output` for safer bridge execution.

## 2. Validate and Preview

```bash
grimoire validate spells/across-bridge.spell
grimoire simulate spells/across-bridge.spell --chain 8453
```

## 3. Dry-Run Cast

```bash
grimoire cast spells/across-bridge.spell \
  --dry-run \
  --chain 8453 \
  --key-env PRIVATE_KEY \
  --rpc-url <base-rpc>
```

## 4. Execute Live

```bash
grimoire cast spells/across-bridge.spell \
  --chain 8453 \
  --key-env PRIVATE_KEY \
  --rpc-url <base-rpc>
```

## 5. Inspect Run and Ledger

```bash
grimoire history
grimoire history <spell-id>
grimoire log <spell-id> <run-id>
```

## Troubleshooting

- `Across adapter requires numeric toChain`: ensure the third arg resolves to number.
- Missing token mapping: use symbols/addresses supported in adapter config for source/destination chains.
- Quote/simulation failures: verify chain RPC, token address, and amount above bridge minimums.
- Stale replayed snapshot data: tune `--data-max-age` or `--on-stale warn`.
