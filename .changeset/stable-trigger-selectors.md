---
"@grimoirelabs/core": minor
"@grimoirelabs/cli": minor
---

Add stable per-handler trigger selectors for multi-handler spells.

`@grimoirelabs/core` now emits `triggerHandlers` in compiled IR, including stable trigger ids, compile-order indexes, labels, source locations, and owned step ids. Runtime preview/execute paths can select a single handler via `selectedTrigger`, and execution results now report the resolved selected trigger.

`@grimoirelabs/cli` now exposes `--trigger-id` and `--trigger-index` on `simulate` and `cast`, adds a native `triggers <spell>` discovery command for stable handler ids, includes `selectedTrigger`, `events`, and `finalState` in JSON output, and fixes the top-level JSON output path so bigint-containing payloads no longer crash the CLI formatter.
