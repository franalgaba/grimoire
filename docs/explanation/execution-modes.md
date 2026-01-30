# Execution modes

Grimoire supports multiple execution modes in the runtime/executor.

## Modes

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
