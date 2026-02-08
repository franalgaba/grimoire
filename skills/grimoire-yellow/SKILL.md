---
name: grimoire-yellow
description: Uses the Yellow venue adapter in Grimoire spells for NitroRPC app-session lifecycle execution.
---

# Grimoire Yellow Skill

Use the Grimoire CLI to execute Yellow app-session lifecycle actions through the `yellow` adapter.

Preferred:

- `grimoire simulate ...`
- `grimoire cast ... --dry-run`

If you installed packages directly, you can use `@grimoirelabs/core` + `@grimoirelabs/venues` programmatically.

## When to use

- You need session lifecycle operations in a spell:
  - `session_open`
  - `session_update`
  - `session_close_settle`
  - `session_transfer` helper
- You want deterministic CLI validation (`simulate` / `cast --dry-run`) for Yellow flows.

## Prerequisites

- Global CLI: `npm i -g @grimoirelabs/cli`
- No install: `npx -y @grimoirelabs/cli ...`
- Environment:
  - `YELLOW_RPC_URL` (required)
  - `YELLOW_APP_ID` (recommended)
  - `YELLOW_CHAIN_ID` (optional)

## VM snapshot usage

Yellow currently does not have a dedicated `grimoire venue yellow ...` metadata CLI. For VM runs, provide explicit session payloads in spell `params:`.

## Commands

- `grimoire validate <spell>`
- `grimoire simulate <spell> [--no-state] [--json]`
- `grimoire cast <spell> --dry-run [--no-state] [--json]`

## Examples

```bash
grimoire validate spells/defihack/yellow-session-track.spell
grimoire simulate spells/defihack/yellow-session-track.spell --no-state --json
grimoire cast spells/defihack/yellow-session-track.spell --dry-run --no-state --json
```

## Notes

- Keep Yellow actions in a dedicated spell/skill for failure isolation.
- Typical manual flow is open -> updates loop -> close/settle with emit events.
- Update intents must be one of `operate`, `deposit`, or `withdraw`.
- Session version must increment by exactly 1 for updates.
- Update allocations must be non-empty.
- Signatures must satisfy configured quorum/signer set.
