---
"@grimoirelabs/venues": patch
---

Fix Uniswap V3 division by zero when pool quote returns zero output in preview mode

When the pool quoter returns 0 (e.g. preview mode with no real wallet context), the SDK's `priceImpact`, `minimumAmountOut`, and slippage calculations would divide by zero. Now detects zero quotes and uses safe fallbacks — produces a valid preview result with `~0` expected output instead of crashing.
