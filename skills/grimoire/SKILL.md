---
name: grimoire
description: Core Grimoire CLI for compiling, validating, simulating, and executing .spell files. Use when you need to run any grimoire command.
---

# Grimoire CLI Skill

The Grimoire CLI compiles, validates, simulates, and executes `.spell` strategy files.

## Commands

### grimoire init

Initialize a new `.grimoire` directory with config and examples.

```bash
grimoire init [--force] [--vm]
```

Use `--vm` to scaffold a VM quickstart spell and README.

### grimoire compile

Compile a `.spell` file to IR (intermediate representation).

```bash
grimoire compile <spell> [-o <file>] [--pretty]
```

### grimoire compile-all

Compile every `.spell` file in a directory (default: `spells/`).

```bash
grimoire compile-all [dir] [--fail-fast] [--json]
```

### grimoire validate

Validate a `.spell` file without compiling.

```bash
grimoire validate <spell> [--strict]
```

### grimoire simulate

Simulate spell execution (dry run). State is loaded/saved between runs.

```bash
grimoire simulate <spell> [-p <json>] [--vault <address>] [--chain <id>] [--state-dir <dir>] [--no-state]
  [--advisor-skills-dir <dir>...]
```

### grimoire cast

Execute a spell onchain. Supports dry-run and live modes.

```bash
grimoire cast <spell> [-p <json>] [--vault <address>] [--chain <id>] \
  [--dry-run] [--key-env <name>] [--keystore <path>] [--password-env <name>] \
  [--rpc-url <url>] [--gas-multiplier <n>] [--skip-confirm] [-v] [--json] \
  [--advisor-skills-dir <dir>...] [--state-dir <dir>] [--no-state]
```

### grimoire venues

List available venue adapters and supported chains.

```bash
grimoire venues [--json]
```

### grimoire venue

Proxy to venue metadata CLIs bundled in `@grimoirelabs/venues`.

```bash
grimoire venue <adapter> [args...]
```

### grimoire history

View execution history for spells.

```bash
grimoire history              # list all spells with state
grimoire history <spellId>    # runs for a specific spell
grimoire history <spellId> --limit 5 --json
```

### grimoire log

View ledger events for a specific spell run.

```bash
grimoire log <spellId> <runId> [--json] [--state-dir <dir>]
```

### grimoire wallet

Manage wallet operations.

```bash
grimoire wallet generate                          # create new keystore
grimoire wallet address --keystore <path> --password-env <name>
grimoire wallet balance --keystore <path> --password-env <name> --chain <id> --rpc-url <url>
grimoire wallet import --private-key <hex>
grimoire wallet wrap --amount <n> --chain <id> --keystore <path> --password-env <name>
grimoire wallet unwrap --amount <n> --chain <id> --keystore <path> --password-env <name>
```

## Running Locally

All CLI commands can be invoked via:

```bash
bun run packages/cli/src/index.ts <command> [args]
```

## Environment Variables

- `PRIVATE_KEY` - Wallet private key (default for `--key-env`)
- `KEYSTORE_PASSWORD` - Keystore password (default for `--password-env`)
- `RPC_URL` - JSON-RPC endpoint (fallback for `--rpc-url`)

## State Persistence

Simulate and cast automatically load/save spell state to `.grimoire/grimoire.db` (SQLite). Use `--no-state` to disable or `--state-dir` to change the directory.

## Advisor Skills

Use `--advisor-skills-dir <dir>` with `simulate` or `cast` to resolve advisor skills from directories containing `SKILL.md` files. The runtime emits `skills`/`allowedTools` metadata in advisory events for external orchestrators.
