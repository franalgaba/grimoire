---
name: grimoire-lifi
description: Uses the LI.FI venue adapter in Grimoire spells for swap, bridge, and compose_execute flows with runtime constraints.
---

# Grimoire LI.FI Skill

Use the Grimoire CLI to execute LI.FI-backed actions through the `lifi` adapter.

Preferred:

- `grimoire simulate ...`
- `grimoire cast ... --dry-run`

If you installed packages directly, you can use `@grimoirelabs/core` + `@grimoirelabs/venues` programmatically.

## When to use

- You want LI.FI-backed `swap` or `bridge` actions in Grimoire.
- You need custom LI.FI `compose_execute` route requests.
- You want deterministic CLI validation (`simulate` / `cast --dry-run`) of LI.FI flows.

## Prerequisites

- Global CLI: `npm i -g @grimoirelabs/cli`
- No install: `npx -y @grimoirelabs/cli ...`
- Optional env vars:
  - `LIFI_API_URL` (default: `https://li.quest/v1`)
  - `LIFI_API_KEY`
  - `LIFI_INTEGRATOR`

## VM snapshot usage

LI.FI currently does not have a dedicated `grimoire venue lifi ...` metadata CLI. For VM runs, provide static `params:` snapshots in the spell or use snapshots from other venue CLIs as inputs.

## Commands

- `grimoire validate <spell>`
- `grimoire simulate <spell> [--no-state] [--json]`
- `grimoire cast <spell> --dry-run [--no-state] [--json]`

## Examples

```bash
grimoire validate spells/defihack/liquidity-mesh-track.spell
grimoire simulate spells/defihack/liquidity-mesh-track.spell --no-state --json
grimoire cast spells/defihack/liquidity-mesh-track.spell --dry-run --no-state --json
```

## Notes

- `lifi.swap(...)` and `lifi.bridge(...)` are supported natively.
- `lifi.compose_execute(...)` compiles to a custom action.
- `routeRequest.toAddress` defaults to `walletAddress` when omitted.
- `routeRequest.toAddress` must match `walletAddress` unless `allowExternalToAddress: true` is explicitly set.
- For swaps and bridges, set both `max_slippage` and `min_output`.
