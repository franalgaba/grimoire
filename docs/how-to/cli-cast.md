# Run spells with the CLI

Use the `grimoire-cast` command to compile and execute spells.

## Simulate execution

```bash
grimoire-cast spells/uniswap-swap-execute.spell --chain 1
```

## Execute with a wallet

```bash
grimoire-cast spells/uniswap-swap-execute.spell \
  --key-env PRIVATE_KEY \
  --rpc-url https://eth.llamarpc.com
```

### Secret handling

Avoid passing secrets as CLI arguments. Prefer environment variables:

```bash
export PRIVATE_KEY=0x...
grimoire-cast spells/uniswap-swap-execute.spell --key-env PRIVATE_KEY
```

## Output modes

- `--json` for machine-readable output
- `--verbose` for full error details

## Useful helpers

List adapters and supported chains:

```bash
grimoire venues
```

Compile all spells:

```bash
grimoire compile-all
```

## See also

- [CLI reference](../reference/cli.md)
- [Execution modes](../explanation/execution-modes.md)
