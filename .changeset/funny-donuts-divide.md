---
"@grimoirelabs/cli": patch
---

Fix `grimoire venue` passthrough argument routing for both positional and structured invocation modes. This includes proper handling of string/array passthrough args and prevents argv fallback from corrupting adapter commands (notably affecting Hyperliquid and Polymarket flows).
