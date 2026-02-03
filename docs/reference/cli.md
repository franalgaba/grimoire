# CLI reference

## grimoire init

Initialize a new `.grimoire` directory with config, aliases, and example spell.

```bash
grimoire init [options]
```

Options:
- `-f, --force` — overwrite existing files

## grimoire compile

Compile a `.spell` file to IR.

```bash
grimoire compile <spell> [options]
```

Options:
- `-o, --output <file>` — output file for IR JSON
- `--pretty` — pretty print JSON output

## grimoire compile-all

Compile every `.spell` file in a directory (default: `spells/`).

```bash
grimoire compile-all [dir]
```

Options:
- `--fail-fast` — stop after the first failure
- `--json`

## grimoire validate

Validate a `.spell` file.

```bash
grimoire validate <spell> [options]
```

Options:
- `--strict` — treat warnings as errors

## grimoire simulate

Simulate spell execution (dry run). State is automatically loaded and saved between runs.

```bash
grimoire simulate <spell> [options]
```

Options:
- `-p, --params <json>` — parameters as JSON
- `--vault <address>` — vault address
- `--chain <id>` — chain ID (default: 1)
- `--advisor-skills-dir <dir>` — directory to resolve advisor skills (repeatable)
- `--state-dir <dir>` — directory for state database (default: `.grimoire/`)
- `--no-state` — disable state persistence

## grimoire cast

Execute a spell. Supports simulation, dry-run, and live execution modes. State is automatically loaded and saved between runs.

```bash
grimoire cast <spell> [options]
```

Options:
- `-p, --params <json>` — parameters as JSON
- `--vault <address>` — vault address
- `--chain <id>` — chain ID (default: 1)
- `--dry-run` — simulate without executing
- `--key-env <name>` — env var containing private key (default: `PRIVATE_KEY`)
- `--private-key <hex>` — private key directly (not recommended)
- `--keystore <path>` — keystore file path (default: `~/.grimoire/keystore.json`)
- `--password-env <name>` — env var containing keystore password (default: `KEYSTORE_PASSWORD`)
- `--rpc-url <url>` — RPC URL (or set `RPC_URL` env var)
- `--gas-multiplier <n>` — gas price multiplier (default: 1.1)
- `--skip-confirm` — skip confirmation prompt
- `-v, --verbose` — show verbose output
- `--json` — machine-readable output
- `--advisor-skills-dir <dir>` — directory to resolve advisor skills (repeatable)
- `--state-dir <dir>` — directory for state database (default: `.grimoire/`)
- `--no-state` — disable state persistence

## grimoire history

View execution history for spells.

```bash
# List all spells with saved state
grimoire history

# Show run history for a specific spell
grimoire history <spellId>
```

Options:
- `--limit <n>` — maximum number of runs to show (default: 20)
- `--json` — output as JSON
- `--state-dir <dir>` — directory for state database

## grimoire log

View ledger events for a specific spell run.

```bash
grimoire log <spellId> <runId>
```

Options:
- `--json` — output as JSON
- `--state-dir <dir>` — directory for state database

## grimoire venues

List available adapters and supported chains.

```bash
grimoire venues
```

Options:
- `--json`

## grimoire wallet

Manage wallet operations (wrap/unwrap ETH, generate keystore).

```bash
# Generate a new keystore
grimoire wallet generate

# Wrap ETH to WETH
grimoire wallet wrap --amount 0.01 --chain 8453 --keystore ~/.grimoire/keystore.json --password-env KEYSTORE_PASSWORD

# Unwrap WETH to ETH
grimoire wallet unwrap --amount 0.01 --chain 8453 --keystore ~/.grimoire/keystore.json --password-env KEYSTORE_PASSWORD
```

Options:
- `--amount <n>` — amount in ETH
- `--chain <id>` — chain ID
- `--keystore <path>` — keystore file path
- `--password-env <name>` — env var containing keystore password
- `--rpc-url <url>` — RPC URL

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
