---
"@grimoirelabs/core": minor
"@grimoirelabs/cli": minor
---

Ship the flow-driven runtime update across core and CLI, including preview/commit lifecycle, value-flow enforcement, advisory workflow improvements, and branch-wide docs/skills alignment.

Core:

- Add full preview/commit execution lifecycle with receipt-driven settlement flow.
- Add value-flow accounting and drift enforcement primitives for safer settlement decisions.
- Expand runtime/session reporting paths and lifecycle handling.
- Update advisory execution path and related typing/validation behavior.
- Extend compiler/type-check/validator coverage for advisory and flow constraints.

CLI:

- Align `simulate`/`cast` behavior with runtime parity and preview-first flow.
- Add advisory runtime controls and replay-oriented execution paths.
- Improve `grimoire venue <adapter>` resolution for global installs and workspace setups.
- Refresh command behavior/docs wiring for the updated lifecycle.

Docs and skills:

- Rework docs to Diataxis structure and update onboarding/reference flow.
- Update Grimoire skills to match current runtime model, syntax, and advisory workflows.
