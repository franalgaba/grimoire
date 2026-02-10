---
"@grimoirelabs/core": minor
---

Migrate .spell DSL from indentation-based to brace-delimited syntax (SPEC-001). Spells now use `{` / `}` for all blocks instead of Python-style 2-space indentation. This is a breaking change to the language surface — all existing `.spell` files must be updated to use braces. The AST, transformer, IR, and runtime are unchanged.
