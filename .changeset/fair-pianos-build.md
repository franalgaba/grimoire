---
"@grimoirelabs/core": minor
"@grimoirelabs/cli": minor
---

Add deterministic spell formatting support and a new `grimoire format` command.

- Add `formatGrimoire()` to core for canonical `.spell` formatting with parser diagnostics.
- Add CLI `format` command with `--write`, `--check`, `--diff`, `--json`, and stdin modes.
- Enforce formatter exit codes for check/parse/usage paths and add formatter test coverage.
