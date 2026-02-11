---
"@grimoirelabs/cli": minor
"@grimoirelabs/core": minor
---

Add advisory runtime trace improvements for `simulate` and `cast`, including verbose tracing controls and live event streaming.

CLI:

- Add `--advisory-trace-verbose` to `simulate` and `cast`.
- Expand advisory tracing with prompt/schema visibility, model selection events, and detailed tool/advisory lifecycle logs.
- Improve verbose advisory output handling by coalescing model deltas into joined channel summaries instead of noisy token-per-line logs.
- Strengthen advisory prompt output guidance for primitive schemas (for example boolean output) with explicit shape hints and examples.

Core:

- Add runtime event callback plumbing for preview/commit execution paths so callers can observe ledger events live during execution.
