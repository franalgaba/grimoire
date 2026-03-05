---
"@grimoirelabs/core": minor
"@grimoirelabs/cli": minor
---

Add `--trigger` CLI option for selective trigger execution in multi-trigger spells

Multi-trigger spells now tag each step with its trigger handler index during compilation, producing a `triggerStepMap` in the IR. The new `--trigger <type>` option on `grimoire cast` filters execution to only the steps belonging to the matched trigger handler (e.g., `--trigger manual`, `--trigger hourly`). Unknown trigger names error with the list of available triggers.
