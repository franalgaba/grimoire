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
```

## Notes

- The tokenizer is indentation-aware and emits INDENT/DEDENT tokens.
- The transformer normalizes sections and maps method calls to actions.
- The IR generator validates step structure and compiles expressions.
