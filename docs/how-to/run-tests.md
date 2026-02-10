# How To Run Tests

This guide covers repo validation, package tests, and onchain suite execution.

## Prerequisites

- Bun installed
- Dependencies installed (`bun install`)

## Fast Local Validation

Run the repo-wide validation script:

```bash
bun run validate
```

This runs:

- `bun run lint`
- `bun run typecheck`
- `bun test`

## Package-Scoped Tests

Examples:

```bash
bun run --filter @grimoirelabs/core test
bun run --filter @grimoirelabs/venues test
bun run --filter @grimoirelabs/cli test
```

## Watch/Coverage

```bash
bun run test:watch
bun run test:coverage
```

## Onchain Test Suite

Script: `scripts/run-onchain-tests.sh`

Simulate only:

```bash
./scripts/run-onchain-tests.sh
```

Dry-run (build tx, no send):

```bash
./scripts/run-onchain-tests.sh --dry-run
```

Live execute (Base default chain):

```bash
CHAIN=8453 ./scripts/run-onchain-tests.sh --execute
```

Resume from phase:

```bash
./scripts/run-onchain-tests.sh --execute --start-phase 4
```

Recovery mode:

```bash
./scripts/run-onchain-tests.sh --recover
```

## Onchain Requirements

Typical requirements from script header:

- keystore file (default `~/.grimoire/keystore.json`)
- funded gas balance
- funded token balances for venue flows

Helpful env vars:

- `KEYSTORE`
- `KEYSTORE_PASSWORD`
- `RPC_URL`
- `ARB_RPC_URL`
- `CHAIN`

## Interpreting Failures

- Compile/validate failures: syntax/type/validator stage issues in spell.
- Runtime preview failures: guard violations, missing adapter assumptions, constraint failures.
- Commit failures: chain execution, drift, wallet/provider, or action execution issues.

For run-level investigation:

```bash
grimoire history <spell-id>
grimoire log <spell-id> <run-id>
```
