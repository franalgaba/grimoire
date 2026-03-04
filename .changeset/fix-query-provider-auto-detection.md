---
"@grimoirelabs/cli": patch
---

Auto-create provider when spells use query functions (`balance()`, `price()`) in guards or expressions, even without explicit `--rpc-url`. Adds `spellUsesQueryFunctions()` static analysis to detect query function calls in spell IR. Documents delimiter rules (commas required inside `()`, newlines inside `{}`) and adds guidance to prefer `price()`/`balance()` over advisory for data fetching.
