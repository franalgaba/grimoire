# Run tests and checks

## Unit tests

```bash
bun test                    # Run all tests
bun test --coverage         # Run tests with coverage report
bun test packages/core/     # Test a specific package
```

## Lint and typecheck

```bash
bun run lint                # Check for lint errors (biome)
bun run lint:fix            # Auto-fix lint issues
bun run typecheck           # TypeScript type checking
bun run validate            # Run lint + typecheck + tests
```

## Onchain test suite

The onchain test runner (`scripts/run-onchain-tests.sh`) validates venue adapters end-to-end across 6 phases.

### Phases

| Phase | What it does | Requires |
|-------|-------------|----------|
| 0 | Compile all spells (`spells/` + `@spells/`) | Nothing |
| 1 | Simulate pure-computation spells | Nothing |
| 2 | Simulate feature spells (guards, constraints, onFailure) | Nothing |
| 3 | Cast feature spells (guards, constraints, output binding, onFailure) | `--dry-run` or `--execute` |
| 4 | Cast venue adapter tests (Uniswap V3/V4, Aave V3, Morpho Blue) | `--dry-run` or `--execute` |
| 5 | Multi-chain tests (Across bridge, Arbitrum, Hyperliquid) | `--execute` only |

### Usage

```bash
# Simulate only (no wallet needed):
./scripts/run-onchain-tests.sh

# Dry-run (builds txs, estimates gas, does NOT send):
./scripts/run-onchain-tests.sh --dry-run

# Live execution on Base (recommended — cheap gas):
CHAIN=8453 ./scripts/run-onchain-tests.sh --execute

# Live execution on mainnet:
CHAIN=1 ./scripts/run-onchain-tests.sh --execute

# Skip password prompt via env var:
KEYSTORE_PASSWORD=... ./scripts/run-onchain-tests.sh --execute
```

### Resume from a specific phase

If the test suite fails mid-run, resume from the phase that failed:

```bash
# Skip phases 0-3, start from Phase 4 (venue adapters):
./scripts/run-onchain-tests.sh --execute --start-phase 4

# Skip to Phase 5 (multi-chain) — resumes from last checkpoint:
./scripts/run-onchain-tests.sh --execute --start-phase 5
```

Phase 5 writes checkpoints to `.grimoire/test-suite/checkpoint` after each sub-step. On resume with `--start-phase 5`, completed sub-steps are automatically skipped.

### Recovery mode

If Phase 5 fails mid-way and funds are stranded on Arbitrum or HyperCore:

```bash
./scripts/run-onchain-tests.sh --recover
```

Recovery mode attempts to withdraw from Hyperliquid and bridge any USDC on Arbitrum back to Base.

### Safety

- Phase 5 is automatically skipped if earlier phases have failures (prevents stranding funds after known errors).
- To force Phase 5 after fixing failures: `./scripts/run-onchain-tests.sh --execute --start-phase 5`

### Wallet requirements

- Keystore: `~/.grimoire/keystore.json` (or `KEYSTORE` env var)
- ETH: >= 0.01 ETH on Base (for gas)
- USDC: >= 5 USDC on Base

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CHAIN` | `8453` | Base chain ID |
| `RPC_URL` | (default for chain) | Base RPC URL |
| `ARB_RPC_URL` | (default for chain) | Arbitrum RPC URL |
| `KEYSTORE` | `~/.grimoire/keystore.json` | Keystore file path |
| `KEYSTORE_PASSWORD` | (interactive prompt) | Keystore password |
