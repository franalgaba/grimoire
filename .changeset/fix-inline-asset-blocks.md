---
"@grimoirelabs/core": patch
---

Fix parser to accept inline single-line asset blocks

The asset block parser required a newline after each field inside nested braces,
which rejected the natural single-line form that agents produce:

```spell
assets: {
  USDC: { chain: 8453 }
  cbBTC: { chain: 8453 }
}
```

The closing `}` is now accepted as an implicit field terminator, so both
single-line and multi-line inner blocks parse correctly.
