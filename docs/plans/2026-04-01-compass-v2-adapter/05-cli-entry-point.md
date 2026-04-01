# Task 05: Add CLI Entry Point

## What to Build

Create `packages/venues/src/cli/compass.ts` using the `incur` CLI framework, providing data query commands for vaults, markets, positions, and bridge status.

## Steps

1. Create `packages/venues/src/cli/compass.ts` with:
   - `Cli.create("grimoire-compass", { ... })`
   - `info` command — show adapter capabilities and supported chains
   - `vaults` command — list ERC-4626 yield vaults via `sdk.earn.earnVaults()`
   - `aave-markets` command — list Aave V3 markets via `sdk.earn.earnAaveMarkets()`
   - `pendle-markets` command — list Pendle markets via `sdk.earn.earnPendleMarkets()`
   - `positions` command — show user positions via `sdk.earn.earnPositions()`
   - `balances` command — show account balances via `sdk.earn.earnBalances()`
   - `credit-positions` command — show credit positions via `sdk.credit.creditPositions()`
   - `bridge-status` command — check CCTP bridge status

2. Each command:
   - Defines options via `z.object()` (zod schemas)
   - Returns `c.ok(data, { cta: { commands: [...] } })` with suggested next commands
   - Handles SDK errors with descriptive messages

## Acceptance Criteria

- [ ] CLI starts with `grimoire-compass` or `grimoire venue compass`
- [ ] `info` command shows adapter capabilities
- [ ] `vaults` command lists available yield vaults with APY, TVL
- [ ] `positions` command shows user positions
- [ ] All commands accept `--chain` filter
- [ ] BigInt values are serialized to strings for JSON output

## Files to Modify

- `packages/venues/src/cli/compass.ts` — new file

## Dependencies

- Task 01 (SDK must be installed)
