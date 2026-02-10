---
"@grimoirelabs/cli": patch
---

Fix Node CLI reliability for common local workflows.

- Allow `grimoire venue <adapter>` to resolve bundled `@grimoirelabs/venues` via package exports-safe entrypoint resolution.
- Make `simulate` and `cast` continue without persisted state (with warning) when Node sqlite backend is unavailable instead of hard-failing.
