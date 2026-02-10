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

- The tokenizer is brace-aware and emits LBRACE/RBRACE tokens.
- The transformer normalizes sections and maps method calls to actions.
- The IR generator validates step structure and compiles expressions.
