---
"@grimoirelabs/core": minor
---

Add diff-stable syntax features (SPEC-002). Constraint clauses now support a parenthesized multi-line form `with (slippage=50, deadline=300,)` so adding or removing a constraint touches exactly one line. Object literals in expressions support multi-line layout with trailing commas. Trailing commas are formalized across all comma-separated contexts (arrays, function args, emit data, constraints, block params). No changes to tokenizer, AST, transformer, IR, or runtime.
