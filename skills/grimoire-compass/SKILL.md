---
name: grimoire-compass
description: Fetches Compass Labs V2 market data and manages Earn, Credit, Bridge, and Traditional Investing operations using the Grimoire venue CLI. Use when you need ERC-4626 vault discovery, Aave market data via Compass, earn/credit positions, or TI opportunities.
---

# Grimoire Compass Skill

Use this skill to query Compass Labs V2 market data and build DeFi transactions across Earn, Credit, Bridge, and Traditional Investing products.

Preferred invocations:

- `grimoire venue compass ...`
- `npx -y @grimoirelabs/cli venue compass ...` (no-install)
- `bun run packages/cli/src/index.ts venue compass ...` (repo-local)
- `grimoire-compass ...` (direct binary from `@grimoirelabs/venues`)

Required environment:

- `COMPASS_API_KEY` — Compass Labs API key (required for all commands except `info`)

## Commands

- `grimoire venue compass info` — show adapter info and supported chains
- `grimoire venue compass aave-markets --chain <id>` — list Aave V3 earn markets
- `grimoire venue compass vaults --chain <id> [--asset <symbol>] [--order-by <field>] [--direction <asc|desc>] [--min-tvl <usd>] [--min-liquidity <usd>] [--limit <n>]` — list ERC-4626 yield vaults with filtering
- `grimoire venue compass positions --owner <address> --chain <id>` — show earn positions
- `grimoire venue compass balances --owner <address> --chain <id>` — show earn account balances
- `grimoire venue compass credit-positions --owner <address> --chain <id>` — show credit positions
- `grimoire venue compass ti-opportunities --chain <id>` — list Traditional Investing assets
- `grimoire venue compass ti-positions --owner <address> --chain <id>` — show TI positions

## Examples

```bash
grimoire venue compass info
grimoire venue compass aave-markets --chain 1
grimoire venue compass vaults --chain 8453 --asset USDC --order-by tvl --direction desc
grimoire venue compass vaults --chain 8453 --min-tvl 1000000 --limit 5
grimoire venue compass positions --owner 0x1234...abcd --chain 1
grimoire venue compass balances --owner 0x1234...abcd --chain 8453
grimoire venue compass credit-positions --owner 0x1234...abcd --chain 1
```

## Supported Chains

| Chain | ID |
|-------|-----|
| Ethereum | 1 |
| Base | 8453 |
| Arbitrum | 42161 |

## Products

### Earn (Aave V3 + ERC-4626 Vaults)

Deposit, withdraw, swap, and transfer across Aave markets and ERC-4626 vaults.

```spell
compass_v2.deposit(USDC, params.amount)
compass_v2.withdraw(USDC, params.amount)
```

Pass `--vault <address>` to target an ERC-4626 vault instead of Aave. Discover vaults with `grimoire venue compass vaults --chain <id>`.

### Credit (Borrow/Repay)

Supply collateral, borrow, and repay on Compass credit markets.

```spell
compass_v2.supply_collateral(WETH, params.amount)
compass_v2.borrow(USDC, params.amount)
compass_v2.repay(USDC, params.amount)
```

### Bridge (CCTP)

Bridge USDC cross-chain via Circle CCTP.

```spell
compass_v2.bridge(USDC, params.amount)
```

Requires numeric `toChain` in the spell action. Only USDC is supported.

### Traditional Investing (Offchain)

Perpetual futures on stocks, commodities, and forex via Hyperliquid. Uses offchain `executeAction` with EIP-712 signing.

Custom action ops: `ti_market_order`, `ti_limit_order`, `ti_cancel_order`, `ti_deposit`, `ti_withdraw`, `ti_setup`, `ti_set_leverage`.

Requires `privateKey` in adapter config. First trade auto-triggers account setup (enable unified account + approve builder fee).

## Spell Constraints

Compass V2 supports `max_slippage` constraint for swap and borrow actions.

## Account Management

The adapter auto-creates Earn and Credit accounts on first interaction. The account-creation transaction is prepended to the action's transaction list.

## Amount Format

All amounts are passed as raw integer values (wei-scale). The adapter converts to string for the Compass API.

## Notes

- Hybrid adapter: EVM transactions for Earn/Credit/Bridge, offchain execution for Traditional Investing.
- Vault detection is automatic via `--vault` flag on `grimoire cast`.
- Prefer `--format json` in automation; default output is human-readable.
