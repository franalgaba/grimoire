---
name: grimoire-pendle
description: Fetches Pendle Hosted SDK metadata using the Grimoire venue CLI. Use when you need supported chains, aggregators, markets, assets, or market token details.
---

# Grimoire Pendle Skill

Use this skill to inspect Pendle metadata and preflight Pendle routing configuration before running spells.

Preferred invocations:

- `grimoire venue pendle ...`
- `npx -y @grimoirelabs/cli venue pendle ...` (no-install)
- `bun run packages/cli/src/index.ts venue pendle ...` (repo-local)
- `grimoire-pendle ...` (direct binary from `@grimoirelabs/venues`)

Recommended preflight:

- `grimoire venue doctor --adapter pendle --chain 1 --rpc-url <rpc> --json`

## Commands

- `grimoire venue pendle info [--base-url <url>] [--format <auto|json|table>]`
- `grimoire venue pendle chains [--base-url <url>] [--format <auto|json|table>]`
- `grimoire venue pendle supported-aggregators --chain <id> [--base-url <url>] [--format <auto|json|table>]`
- `grimoire venue pendle markets [--chain <id>] [--active <true|false>] [--base-url <url>] [--format <auto|json|table>]`
- `grimoire venue pendle assets [--chain <id>] [--type <PT|YT|LP|SY>] [--base-url <url>] [--format <auto|json|table>]`
- `grimoire venue pendle market-tokens --chain <id> --market <address> [--base-url <url>] [--format <auto|json|table>]`

## Examples

```bash
grimoire venue pendle info --format table
grimoire venue pendle chains
grimoire venue pendle supported-aggregators --chain 1 --format json
grimoire venue pendle markets --chain 1 --active true --format table
grimoire venue pendle assets --chain 8453 --type PT --format table
grimoire venue pendle market-tokens --chain 8453 --market 0x... --format json
```

## Spell Constraints

When writing Pendle actions in `.spell` files, use `with` clauses:

```spell
pendle.swap(PT_TOKEN, SY_TOKEN, params.amount) with (
  max_slippage=100,
  require_quote=true,
)
```

| Constraint | Type | Description |
|-----------|------|-------------|
| `max_slippage` | integer (bps) | Maximum slippage, validated as integer in `[0, 10000]`, converted to decimal for API |
| `min_output` | integer (wei) | Minimum output amount floor |
| `require_quote` | boolean | Fail if Pendle API quote fails |
| `max_gas` | integer (wei) | Gas estimate cap |

Pendle `swap` only supports `mode: exact_in`. `exact_out` is not supported.

When the Pendle API returns multiple routes, the adapter selects the first (best) route and emits a warning via `onWarning`. This is logged in non-JSON CLI runs.

## PT/YT/SY Token Resolution

Pendle PT, YT, and SY tokens (e.g. `PT_FXSAVE`, `YT_EETH`, `SY_WSTETH`) are **automatically resolved** via the Pendle API at build time. You can use these symbols directly in spells without providing explicit addresses:

```spell
pendle.swap(PT_FXSAVE, USDC, params.amount) with (max_slippage=100)
```

The adapter converts underscore-delimited names (e.g. `PT_FXSAVE`) to the Pendle API format and picks the best match. If multiple expiries exist, the first (nearest) is selected.

To target a specific expiry or disambiguate, use the full 0x address instead:

```spell
pendle.swap(0xb1e926428ebec4421cce1ec6d9ff65d27f4b4bb6, USDC, params.amount)
```

Use `grimoire venue pendle assets --chain <id> --type PT` to discover available tokens and addresses.

## Notes

- Default API base URL is `https://api-v2.pendle.finance/core`.
- Override base URL with `--base-url` or `PENDLE_API_BASE_URL`.
- Use `--format json` for automation and nested payloads.
- Pendle `swap` currently supports `mode: exact_in` only.
- Aggregators are disabled by default in adapter actions unless explicitly enabled.
- For Pendle token outputs (`assetOut`, `outputs`), use bare address literals (`0x...`) and not quoted strings (`\"0x...\"`).
- Quoted address-like token values trigger validator code `QUOTED_ADDRESS_LITERAL`.
- `max_slippage` is validated as integer bps in `[0, 10000]` and converted to decimal (`bps / 10000`) before API requests.
