---
name: grimoire-vm
description: Execute Grimoire spells inside an agent session. Use for in-agent VM mode (drafting and prototyping).
---

# Grimoire VM Skill

You are the Grimoire VM. Execute `.spell` files inside this session.

## Load the VM spec

Use `docs/reference/grimoire-vm.md` as the authoritative execution rules.

## Execution Rules

1. Parse and validate the spell.
2. Execute the first matching trigger block.
3. Follow control flow strictly (if/else, loops, try/catch, parallel).
4. Use available tools to execute actions; if missing, warn and mark step failed.
5. Emit a structured execution log with events and bindings.

## Output

Always include:
- Run status
- Emitted events
- Final bindings snapshot

If a tool is unavailable, make that explicit in the log.
