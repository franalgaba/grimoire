# Grimoire CLI Reference

This page documents the `grimoire` CLI surface from `packages/cli/src/index.ts` and command implementations in `packages/cli/src/commands/*`.

## Command Summary

- `grimoire init`
- `grimoire compile <spell>`
- `grimoire compile-all [dir]`
- `grimoire validate <spell>`
- `grimoire simulate <spell>`
- `grimoire cast <spell>`
- `grimoire venues`
- `grimoire venue [adapter] [args...]`
- `grimoire venue doctor [--chain <id>] [--adapter <name>] [--rpc-url <url>] [--json]`
- `grimoire history [spell]`
- `grimoire log <spell> <runId>`
- `grimoire wallet <subcommand>`

## `init`

Initialize `.grimoire` scaffolding.

```bash
grimoire init [--force] [--runtime-quickstart]
```

Options:

- `--force`: overwrite if `.grimoire` already exists.
- `--runtime-quickstart`: create `runtime-quickstart` spell and readme instead of `example-swap`.

Creates:

- `.grimoire/config.yaml`
- `.grimoire/aliases/default.yaml`
- `.grimoire/spells/...`

## `compile`

Compile a single `.spell` file to IR JSON.

```bash
grimoire compile <spell> [-o <file>] [--pretty]
```

Options:

- `-o, --output <file>`: write IR JSON to file.
- `--pretty`: pretty JSON output.

Exit code:

- `0` on success
- `1` on compile errors or IO failures

## `compile-all`

Compile every `.spell` under a directory recursively.

```bash
grimoire compile-all [dir] [--fail-fast] [--json]
```

Defaults:

- `dir`: `spells`

Options:

- `--fail-fast`: stop on first failure.
- `--json`: emit machine-readable per-file result list.

Exit code:

- `0` when all files compile
- `1` when any file fails or no spell files found

## `validate`

Compile + validate a spell, including advisory summaries.

```bash
grimoire validate <spell> [--strict] [--json]
```

Options:

- `--strict`: treat warnings as failures.
- `--strict` also fails on venue constraint capability warnings inferred from bundled adapters (for example applying `min_liquidity` to `uniswap_v3`).
- `--json`: emit validation payload.

JSON includes:

- `success`
- `strict`
- `spell` metadata
- `errors`
- `warnings`
- `advisory_summaries`

Exit code:

- `0` when valid
- `1` on errors (or warnings in strict mode)

## `simulate`

Run preview-mode execution (no irreversible commit).

```bash
grimoire simulate <spell> [options]
```

Core options:

- `-p, --params <json>`: parameter override JSON
- `--vault <address>`: vault address (default `0x000...000`)
- `--chain <id>`: EVM chain id (default `1`)
- `--rpc-url <url>`: explicit RPC URL override for preview adapter context
- `--json`: JSON output

RPC resolution order:

1. `--rpc-url <url>`
2. `RPC_URL_<chainId>` (for example `RPC_URL_1`)
3. `RPC_URL`

Advisory options:

- `--advisor-skills-dir <dir...>`
- `--advisory-pi`
- `--advisory-replay <runId>`
- `--advisory-provider <name>`
- `--advisory-model <id>`
- `--advisory-thinking <off|low|medium|high>`
- `--advisory-tools <none|read|coding>`
- `--advisory-trace-verbose` (adds prompt/schema, tool payloads, and model text/thinking deltas to live trace)
- `--pi-agent-dir <dir>`

Data replay/freshness options:

- `--data-replay <mode>` where mode is `off`, `auto`, run ID, or snapshot ID
- `--data-max-age <sec>` (default `3600`)
- `--on-stale <fail|warn>` (default `fail`)

ENS options:

- `--ens-name <name>`
- `--ens-rpc-url <url>`

State options:

- `--state-dir <dir>`
- `--no-state`

Behavior notes:

- Uses `execute({ simulate: true })`, which internally runs `preview()`.
- Loads and saves persistent state by default via `SqliteStateStore`.
- If `--advisory-replay` is set, advisory outputs are loaded from a prior run ledger.
- Advisory lifecycle logs are shown live in non-JSON mode; use `--advisory-trace-verbose` for detailed traces.
- `--json` suppresses live advisory trace lines to keep output valid JSON.

## `cast`

Run spell through preview, then optionally commit transactions.

```bash
grimoire cast <spell> [options]
```

Core options:

- `-p, --params <json>`
- `--vault <address>`
- `--chain <id>`
- `--dry-run`
- `--json`
- `-v, --verbose`

Wallet/key options:

- `--private-key <key>`
- `--key-env <name>`
- `--keystore <path>`
- `--password-env <name>`

Execution options:

- `--rpc-url <url>`
- `--gas-multiplier <n>`
- `--skip-confirm`

Advisory/data/ENS/state options are the same family as `simulate`.

Runtime mode selection in command logic:

- `simulate`: no key available and not `--dry-run`
- `dry-run`: `--dry-run`
- `execute`: key available and no `--dry-run`

Behavior notes:

- Always runs preview first.
- Commits only when mode is `execute`, a wallet exists, and receipt has planned actions.
- Hyperliquid adapter is key-configured dynamically in wallet paths.

## `venues`

List registered venue adapter metadata.

```bash
grimoire venues [--json]
```

Table columns:

- `Name`
- `Exec` (`evm` or `offchain`)
- `Actions`
- `Chains`
- `Constraints`
- `Quote`
- `Sim`
- `Preview/Commit`
- `Env`
- `Endpoints`
- `Description`

## `venue`

Proxy to per-venue CLIs in `@grimoirelabs/venues`.

```bash
grimoire venue <adapter> [args...]
```

Primary adapters supported by proxy mapping:

- `aave` (`aave-v3` alias)
- `uniswap` (`uniswap-v3`, `uniswap-v4` aliases)
- `morpho-blue` (`morpho` alias)
- `hyperliquid`

This command forwards args to `grimoire-aave`, `grimoire-uniswap`, etc.

## `venue doctor`

Run venue environment and connectivity diagnostics.

```bash
grimoire venue doctor [--chain <id>] [--adapter <name>] [--rpc-url <url>] [--json]
```

Checks:

- adapter registration
- required environment variables
- adapter chain support (when `--chain` is provided)
- RPC reachability via block-number fetch (when `--chain` is provided)

Offchain adapter note:

- For offchain adapters such as `hyperliquid`, prefer `grimoire venue doctor --adapter hyperliquid --json` (omit `--chain`) to skip EVM RPC reachability checks.

Adapter filter aliases:

- `aave`, `aave-v3`
- `uniswap`, `uniswap-v3`, `uniswap-v4`
- `morpho`, `morpho-blue`
- `hyperliquid`
- `across`

Exit code:

- `0` when all checks pass (or are skipped)
- `1` when any check fails or arguments are invalid

## `history`

Inspect persisted run history.

```bash
grimoire history [spell] [--limit <n>] [--json] [--state-dir <dir>]
```

Modes:

- No `spell`: list spells with persisted state.
- With `spell`: list runs plus session ledger and P&L rollups.

## `log`

Inspect ledger events for one run.

```bash
grimoire log <spell> <runId> [--json] [--state-dir <dir>]
```

Outputs chronological ledger entries with event-specific formatting.

## `wallet`

Wallet management and ETH/WETH helpers.

```bash
grimoire wallet <subcommand>
```

Subcommands:

- `generate`: create new wallet + encrypted keystore
- `address`: print resolved address
- `balance`: query native balance
- `import`: import existing private key into keystore
- `wrap`: wrap native ETH to WETH (ETH-native chains only)
- `unwrap`: unwrap WETH to native ETH

Common options include:

- `--keystore <path>`
- `--password-env <name>`
- `--key-env <name>` (where applicable)
- `--chain <id>` and `--rpc-url <url>` for chain operations
- `--json`

## Exit Code Conventions

Most commands use:

- `0` success
- `1` validation/compile/runtime/user-input failure

For automation, prefer `--json` plus exit status.
