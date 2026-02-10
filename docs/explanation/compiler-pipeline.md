# Compiler pipeline

The compiler transforms `.spell` source into executable IR.

```
Source (.spell)
  → Tokenizer
  → Parser
  → AST
  → Transformer
  → SpellSource
  → IR Generator
  → SpellIR
  → Type Checker
  → Validator
```

## Notes

- The tokenizer is brace-aware and emits LBRACE/RBRACE tokens.
- The transformer normalizes sections and maps method calls to actions.
- The IR generator validates step structure and compiles expressions.
- The type checker infers expression types and reports type mismatches as errors that block compilation. Arithmetic between `bigint` and `number` requires explicit conversion via `to_number()` or `to_bigint()`. Comparisons auto-promote across numeric types.
- The validator checks structural IR constraints (e.g. required fields, valid trigger types).
