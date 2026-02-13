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
<grimoire-cmd> venue doctor [--chain <id>] [--adapter <name>] [--rpc-url <url>] [--json]
<grimoire-cmd> history [spell] [--limit <n>] [--json] [--state-dir <dir>]
<grimoire-cmd> log <spell> <runId> [--json] [--state-dir <dir>]
```

## Venue Doctor (Preflight)

Use before venue metadata calls or strategy execution:

```bash
<grimoire-cmd> venue doctor --adapter uniswap --chain 1 --rpc-url <rpc> --json
```

Checks:

- adapter registration
- required env vars
- chain support
- RPC reachability

Tip:

- In `--json` output, confirm `rpcUrl` is the endpoint actually used.

## Simulate (Preview)

Common options:

- `-p, --params <json>`
- `--chain <id>`
- `--rpc-url <url>`
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

1. `simulate` supports `--rpc-url` for explicit per-run RPC selection.
2. RPC resolution order is `--rpc-url`, then `RPC_URL_<chainId>`, then `RPC_URL`.

## Anvil Quickstart

Use only for EVM venues. Do not use for `hyperliquid` (offchain).

Start forked local node:

```bash
anvil \
  --fork-url "$FORK_RPC_URL" \
  --chain-id "$CHAIN_ID" \
  --fork-block-number "$FORK_BLOCK" \
  --state .grimoire/anvil/state.json \
  --host 127.0.0.1 \
  --port 8545
```

Run preview against Anvil:

```bash
<grimoire-cmd> simulate <spell> --chain "$CHAIN_ID" --rpc-url http://127.0.0.1:8545
```

Preflight endpoint and env:

```bash
<grimoire-cmd> venue doctor --adapter uniswap --chain "$CHAIN_ID" --rpc-url http://127.0.0.1:8545 --json
```

Optional Foundry Cast preflight against Anvil:

```bash
cast chain-id --rpc-url http://127.0.0.1:8545
cast block-number --rpc-url http://127.0.0.1:8545
```

## Venue Output Formats

Use `--format json` for scripts and nested payloads (for example `hyperliquid meta`).

- `auto`: table only for flat TTY-friendly outputs, otherwise JSON
- `table`: compact summary for nested arrays/objects
- `json`: full payload, stable for automation

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

## Foundry Cast (RPC/Tx Diagnostics)

Use Foundry `cast` for endpoint/signer/transaction debugging around Grimoire runs.
Prefer explicit `--rpc-url` and JSON mode (`--json`) for automation.
These checks are EVM-only and are not applicable to offchain venues such as `hyperliquid`.

High-value quickchecks:

```bash
cast chain-id --rpc-url "$RPC_URL"
cast block-number --rpc-url "$RPC_URL"
cast balance "$ADDRESS" --rpc-url "$RPC_URL"
cast nonce "$ADDRESS" --rpc-url "$RPC_URL"
cast receipt "$TX_HASH" --rpc-url "$RPC_URL"
cast decode-error "$REVERT_DATA"
```

Signer hygiene:

- prefer `--keystore` + `--password-env` over raw `--private-key`
- if using `--private-key`, keep it in env vars and avoid shell history leaks

For expanded patterns and Anvil debug RPC calls, use `references/cast-cheatsheet.md`.

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
