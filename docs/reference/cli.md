# CLI reference

## grimoire-cast

Execute or simulate spells.

```bash
grimoire-cast <spell-file> [options]
```

Options:
- `--chain <id>`
- `--dry-run`
- `--rpc-url <url>`
- `--key-env <ENV_VAR>`
- `--private-key <hex>` (not recommended)
- `--mnemonic <phrase>` (not recommended)
- `--gas-multiplier <float>`
- `--skip-confirm`
- `--json`
- `--verbose`

## grimoire venues

List available adapters and supported chains.

```bash
grimoire venues
```

Options:
- `--json`

## grimoire compile-all

Compile every `.spell` file in a directory (default: `spells/`).

```bash
grimoire compile-all [dir]
```

Options:
- `--fail-fast`
- `--json`

## Venue CLIs

### grimoire-aave

Commands:
- `health`
- `chains`
- `markets --chain <id> [--user <address>]`
- `market --chain <id> --address <market> [--user <address>]`
- `reserve --chain <id> --market <address> --token <address>`

### grimoire-uniswap

Commands:
- `info`
- `routers [--chain <id>]`

### grimoire-morpho-blue

Commands:
- `info`
- `addresses [--chain <id>]`

### grimoire-hyperliquid

Commands:
- `mids`
- `l2-book --coin <symbol>`
- `open-orders --user <address>`
- `meta`
- `spot-meta`
