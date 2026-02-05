# Execution modes

Grimoire has two **execution environments** that run the same spell syntax, plus separate **modes** inside the deterministic runtime.

## Execution environments (VM vs deterministic runtime)

- **VM mode (in-agent, best-effort)**: a spell is interpreted inside an agent session. This is ideal for prototyping, reviews, and dry runs with snapshot data. It does **not** bundle adapters or guarantee determinism, and tool availability depends on the host agent.
- **Deterministic runtime (CLI)**: a spell is compiled to IR and executed by the external runtime with adapters, explicit constraints, and persistent state. This is the mode for reproducible simulation and onchain safety.

### VM mode and the CLI

You can use the CLI in VM mode **only** to fetch metadata or snapshots (for example, `--format spell` outputs a `params:` block). This does not make VM execution deterministic; the spell still runs inside the agent session.

For VM semantics, see the [Grimoire VM spec](../reference/grimoire-vm.md).

## Deterministic runtime modes (CLI)

Within the external runtime/executor, Grimoire supports multiple execution modes:

- `simulate`: evaluate steps and emit events without sending transactions.
- `dry-run`: build transactions, show confirmation output, but do not send.
- `execute`: send transactions through the wallet/executor.

## Confirmation behavior

- Testnets auto-confirm unless `skipTestnetConfirmation` is false.
- Mainnet requires explicit confirmation unless `skipConfirm` is provided in the CLI.

## State persistence across modes

All execution modes produce an `ExecutionResult` with `finalState` and `ledgerEvents`. State persistence works identically regardless of execution mode:

1. State is loaded from the `StateStore` before execution.
2. The loaded state is passed as `persistentState` to `execute()`.
3. After execution, `finalState` is saved back to the store.
4. A `RunRecord` and ledger entries are stored for history/debugging.

To disable state persistence, use the `--no-state` CLI flag. To use a custom storage location, use `--state-dir <dir>`.
