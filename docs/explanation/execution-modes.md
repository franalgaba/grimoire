# Execution modes

Grimoire supports multiple execution modes in the runtime/executor.

## Modes

- `simulate`: evaluate steps and emit events without sending transactions.
- `dry-run`: build transactions, show confirmation output, but do not send.
- `execute`: send transactions through the wallet/executor.

## Confirmation behavior

- Testnets auto-confirm unless `skipTestnetConfirmation` is false.
- Mainnet requires explicit confirmation unless `skipConfirm` is provided in the CLI.
