---
name: grimoire-testing
description: Running Grimoire tests including unit tests and the onchain test suite. Use when you need to run tests, debug test failures, or execute the multi-phase onchain test runner.
---

# Grimoire Testing Skill

## Unit Tests

Run the full test suite:

```bash
bun test
```

Run tests for a specific package or file:

```bash
bun test packages/core/
bun test packages/core/src/compiler/grimoire/parser.test.ts
```

Run with coverage:

```bash
bun test --coverage
```

## Full Validation

Run lint + typecheck + tests:

```bash
bun run validate
```

Individual steps:

```bash
bun run lint        # biome check
bun run typecheck   # tsc --noEmit
bun test            # bun:test
```

## Onchain Test Suite

The onchain test runner (`scripts/run-onchain-tests.sh`) executes spells against live chains in six phases.

### Phases

| Phase | Description | Mode |
|-------|-------------|------|
| 0 | Compile all spells | compile |
| 1 | Simulate pure-computation spells | simulate |
| 2 | Simulate feature spells (state, events) | simulate |
| 3 | Cast feature spells on-chain | cast |
| 4 | Cast venue spells (Aave, Morpho, Uniswap, Across) | cast |
| 5 | Multi-chain bridging (Base -> Arb -> Base) | cast |

### Usage

```bash
# Dry run (phases 0-4, builds txs without sending)
./scripts/run-onchain-tests.sh --dry-run

# Full execution (all phases)
./scripts/run-onchain-tests.sh --execute

# Resume from a specific phase
./scripts/run-onchain-tests.sh --execute --start-phase 3

# Recovery mode (return stranded funds to Base)
./scripts/run-onchain-tests.sh --recover
```

### Required Environment Variables

```bash
KEYSTORE_PASSWORD=<password>     # Keystore file password
RPC_URL=<url>                    # Base RPC endpoint override
ARB_RPC_URL=<url>                # Arbitrum RPC endpoint override
```

### Required Files

- Keystore at `~/.grimoire/keystore.json`
- Spell files in `spells/` and `@spells/`

### Checkpoint System

Phase 5 uses checkpoints stored in `.grimoire/test-suite/checkpoint`. If Phase 5 fails mid-way, re-running with `--start-phase 5` skips completed sub-steps.

### Phase 5 Gating

Phase 5 only runs if all Phase 4 tests passed (or if explicitly started with `--start-phase 5`).

## Test File Conventions

- Test files are `*.test.ts`, colocated with source
- Use `bun:test` imports: `describe`, `test`, `expect`
- Run specific test: `bun test --grep "pattern"`
