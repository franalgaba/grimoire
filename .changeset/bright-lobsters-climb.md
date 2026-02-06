---
"@grimoirelabs/cli": minor
"@grimoirelabs/core": minor
---

Add Pi-backed advisory execution with auto model resolution and deterministic replay.

- CLI: enable advisory by default when a model is configured (spell, CLI flags, or Pi defaults), keep `--advisory-pi` as force mode, and add replay-first resolution behavior.
- Core: extend advisory handler interfaces for step-level traceability (`stepId`, `emit`) and emit advisory/tool trace ledger events for audit and replay.
- Docs/skills: clarify VM vs deterministic runtime and document the exploration -> record -> replay -> execute workflow.
