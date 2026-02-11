# CLI Quick Reference

Use this page for concise command signatures and high-signal options.

Assume `<grimoire-cmd>` is one of:

- `grimoire`
- `npx -y @grimoirelabs/cli`
- `bun run packages/cli/src/index.ts`

## Core Commands

```bash
<grimoire-cmd> init [--force] [--runtime-quickstart]
<grimoire-cmd> compile <spell> [-o <file>] [--pretty]
<grimoire-cmd> compile-all [dir] [--fail-fast] [--json]
<grimoire-cmd> validate <spell> [--strict] [--json]
<grimoire-cmd> simulate <spell> [options]
<grimoire-cmd> cast <spell> [options]
<grimoire-cmd> venues [--json]
<grimoire-cmd> venue <adapter> [args...]
<grimoire-cmd> history [spell] [--limit <n>] [--json] [--state-dir <dir>]
<grimoire-cmd> log <spell> <runId> [--json] [--state-dir <dir>]
```

## Simulate (Preview)

Common options:

- `-p, --params <json>`
- `--chain <id>`
- `--state-dir <dir>`
- `--no-state`
- `--advisor-skills-dir <dir...>`
- `--advisory-pi`
- `--advisory-replay <runId>`
- `--advisory-provider <name>`
- `--advisory-model <id>`
- `--advisory-thinking <off|low|medium|high>`
- `--advisory-tools <none|read|coding>`
- `--advisory-trace-verbose`
- `--pi-agent-dir <dir>`
- `--data-replay <off|auto|runId|snapshotId>`
- `--data-max-age <sec>`
- `--on-stale <fail|warn>`

Important:

- `simulate` does not expose `--rpc-url`.
- For preview against local or forked RPC, use `cast --dry-run` with wallet options and `--rpc-url`.

## Cast (Dry-Run / Live)

Common options:

- `--dry-run`
- `--chain <id>`
- `--key-env <name>`
- `--keystore <path>`
- `--password-env <name>`
- `--rpc-url <url>`
- `--skip-confirm`
- `--state-dir <dir>`
- `--no-state`
- `--advisor-skills-dir <dir...>`
- `--advisory-pi`
- `--advisory-replay <runId>`
- `--advisory-provider <name>`
- `--advisory-model <id>`
- `--advisory-thinking <off|low|medium|high>`
- `--advisory-tools <none|read|coding>`
- `--advisory-trace-verbose`
- `--pi-agent-dir <dir>`

Safety rule:

1. run `cast --dry-run` before live cast for value-moving spells
2. require explicit user confirmation before live cast

Replay rule for advisory-gated execution:

1. use `--advisory-replay <runId>` for dry-run/live consistency
2. do not combine replay with `--no-state`

## Wallet Subcommands

```bash
<grimoire-cmd> wallet generate [--keystore <path>] [--password-env <name>] [--print-key] [--json]
<grimoire-cmd> wallet address [--keystore <path>] [--password-env <name>] [--key-env <name>] [--mnemonic <phrase>] [--json]
<grimoire-cmd> wallet balance [--keystore <path>] [--password-env <name>] [--key-env <name>] [--mnemonic <phrase>] [--chain <id>] [--rpc-url <url>] [--json]
<grimoire-cmd> wallet import [--keystore <path>] [--password-env <name>] [--key-env <name>] [--json]
<grimoire-cmd> wallet wrap --amount <eth> [--chain <id>] [--keystore <path>] [--password-env <name>] [--rpc-url <url>] [--json]
<grimoire-cmd> wallet unwrap --amount <eth> [--chain <id>] [--keystore <path>] [--password-env <name>] [--rpc-url <url>] [--json]
```

## High-Use Environment Variables

- `PRIVATE_KEY`
- `KEYSTORE_PASSWORD`
- `RPC_URL`
- `ENS_RPC_URL`
