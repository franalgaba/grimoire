# SPEC-001: Migrate from Whitespace-Significant to Brace-Delimited Syntax

**Status:** Draft
**Date:** 2026-02-09
**Motivation:** [grimoire-analysis.md](./grimoire-analysis.md) — Issue #1: Whitespace-Significant Syntax

---

## Problem Statement

The `.spell` format currently uses Python-style 2-space indentation as its structural delimiter. Every section header, control flow block, trigger body, parallel branch, pipeline stage, and nested config block relies on INDENT/DEDENT tokens emitted by the tokenizer.

This is the single worst property of the language for agent authorship:

1. **Token efficiency** — LLMs reason about whitespace poorly. Spaces are low-entropy tokens that consume context without carrying semantic weight. A 4-level-deep nested block wastes 8 space tokens per line on structure that a single `{` would convey.

2. **Surgical edits break** — When an agent inserts a line into an indented block, it must get the exact whitespace right. Agents routinely disregard indentation, emit markers, or rely on formatters to fix it. We don't have a formatter. Every indentation error is a hard parse failure.

3. **Multi-DEDENT ambiguity** — Jumping from indent level 3 back to level 0 emits 3 separate DEDENT tokens. The tokenizer must validate that the landing level matches a previous stack entry. An agent that miscounts spaces gets a cryptic `IndentationError: Indentation does not match any outer level` with no mechanical fix.

4. **Copy-paste fragility** — Spell snippets in documentation, chat messages, GitHub issues, and LLM context windows routinely lose their indentation. A snippet pasted at the wrong level is unparseable. Braces survive copy-paste intact.

5. **Diff instability** — Adding a new branch to a `parallel` block or a new `elif` clause doesn't change the surrounding lines with braces. With indentation, reformatting can cascade.

The article's core argument applies directly: the cost of *writing* code is going down, so we should optimize for *reading and reviewing*. Braces are slightly more verbose to write but unambiguous to read, grep, and machine-edit.

---

## Design Principles

1. **Familiar syntax** — Target Rust/Go curly-brace style. No novel delimiters. Agents have massive training data on `{}` languages.
2. **One way to do it** — No optional braces, no braceless single-statement shorthand. Every block uses `{}`.
3. **Newlines are whitespace** — Newlines separate statements but are not structurally significant. A spell on one line is valid (ugly, but valid).
4. **Semicolons are optional** — Newlines act as statement terminators. Semicolons allowed for multi-statement lines but not required.
5. **Trailing commas everywhere** — Lists, params, constraints all allow trailing commas for diff stability.
6. **Colon retained for labels** — Section headers (`params:`, `venues:`), branch labels (`alpha:`), and trigger declarations (`on manual:`) keep the colon. It introduces the block; the brace wraps it.
7. **Backward-incompatible** — This is a breaking change. No mixed-mode parsing. Old spells must be migrated via an automated `grimoire migrate` command.

---

## Syntax Transformation: Before and After

### Top-Level Spell Structure

```
// BEFORE (indentation)
spell YieldOptimizer

  version: "1.0.0"
  description: "Optimize yield across lending protocols"

  assets: [USDC, USDT, DAI]

  params:
    amount: 1000000
    threshold: 500

  on manual:
    x = params.amount + 1
    emit done(x=x)
```

```
// AFTER (braces)
spell YieldOptimizer {
  version: "1.0.0"
  description: "Optimize yield across lending protocols"

  assets: [USDC, USDT, DAI]

  params: {
    amount: 1000000
    threshold: 500
  }

  on manual: {
    x = params.amount + 1
    emit done(x=x)
  }
}
```

**Rules:**
- `spell Name {` opens the top-level block
- Inline values (`version: "1.0.0"`, `assets: [...]`) remain single-line — no braces needed for scalar/array values
- Section headers with sub-items (`params:`, `venues:`, etc.) use `{ }` to wrap their contents
- Trigger blocks (`on manual:`, `on hourly:`) use `{ }` for their body

### Section Headers

```
// Params (simple)
params: {
  amount: 1000000
  threshold: 500
}

// Params (typed)
params: {
  amount: {
    type: amount
    asset: USDC
    default: 1.5 USDC
  }
  slippage: {
    type: bps
    default: 50 bps
  }
}

// Venues
venues: {
  swap: @uniswap_v3
  lending: @aave_v3
}

// State
state: {
  persistent: {
    run_count: 0
    total_amount: 0
  }
  ephemeral: {
    temp_value: 0
  }
}

// Limits
limits: {
  max_allocation: 50%
  min_trade_size: 100000
}

// Guards
guards: {
  positive_amount: params.amount > 0
  max_cap: params.amount < 1000000
}
```

### Skills and Advisors

```
skills: {
  dex: {
    type: swap
    adapters: [uniswap_v4]
    default_constraints: {
      max_slippage: 50
    }
  }
  lending: {
    type: lending
    adapters: [aave, morpho]
    default_constraints: {
      max_slippage: 50
    }
  }
}

advisors: {
  risk: {
    model: "anthropic:sonnet"
    timeout: 30
    fallback: true
  }
}
```

### Conditionals (if/elif/else)

```
// BEFORE
on manual:
  if params.amount > params.threshold:
    emit large(amount=params.amount)
  elif params.amount > 0:
    emit small(amount=params.amount)
  else:
    emit zero()
```

```
// AFTER
on manual: {
  if params.amount > params.threshold {
    emit large(amount=params.amount)
  } elif params.amount > 0 {
    emit small(amount=params.amount)
  } else {
    emit zero()
  }
}
```

**Rules:**
- `if condition {` — no colon after condition, brace opens block
- `} elif condition {` — elif follows closing brace of previous branch
- `} else {` — else follows closing brace of elif/if
- This is identical to Go syntax

### Loops

```
// for loop
for asset in assets {
  bal = balance(asset)
  emit checked(asset=asset, balance=bal)
}

// repeat loop
repeat 3 {
  total = total + params.start
}

// loop until
loop until counter >= params.limit max 10 {
  counter = counter + 1
}
```

**Rules:**
- `for ... in ... {` — no colon
- `repeat N {` — no colon
- `loop until ... max N {` — no colon
- All loop bodies wrapped in `{ }`

### Try/Catch/Finally

```
// BEFORE
on manual:
  try:
    risky_op()
  catch slippage_exceeded:
    retry:
      max_attempts: 3
      backoff: exponential
      backoff_base: 1000
    action: skip
  catch *:
    action: halt
  finally:
    emit cleanup()
```

```
// AFTER
on manual: {
  try {
    risky_op()
  } catch slippage_exceeded {
    retry: {
      max_attempts: 3
      backoff: exponential
      backoff_base: 1000
    }
    action: skip
  } catch * {
    action: halt
  } finally {
    emit cleanup()
  }
}
```

**Rules:**
- `try {` — no colon
- `} catch ErrorType {` — catch follows closing brace, error type is a label (no colon before brace)
- `} finally {` — finally follows closing brace
- `retry:` keeps its colon because it's a config block (key-value pairs), wrapped in `{ }`

### Parallel Blocks

```
// BEFORE
on manual:
  parallel join=all on_fail=continue:
    alpha:
      a = 1
    beta:
      b = 2
    gamma:
      c = 3
  sum = a + b + c
```

```
// AFTER
on manual: {
  parallel join=all on_fail=continue {
    alpha: {
      a = 1
    }
    beta: {
      b = 2
    }
    gamma: {
      c = 3
    }
  }
  sum = a + b + c
}
```

**Rules:**
- `parallel config {` — no colon before brace
- Branch labels keep colon: `alpha: {`
- Each branch body in `{ }`
- End of parallel block is unambiguous: `}`

### Atomic Blocks

```
// BEFORE
on manual:
  atomic:
    aave.withdraw(USDC, balance)
    morpho.lend(USDC, balance)
```

```
// AFTER
on manual: {
  atomic {
    aave.withdraw(USDC, balance)
    morpho.lend(USDC, balance)
  }
}

// With mode:
atomic revert {
  aave.withdraw(USDC, balance)
  morpho.lend(USDC, balance)
}
```

### Pipelines

```
// BEFORE
result = assets | filter:
  keep = item != "USDC"
| map:
  mapped = index + 1
| reduce(0):
  sum = acc + item

// AFTER
result = assets
  | filter: { keep = item != "USDC" }
  | map: { mapped = index + 1 }
  | reduce(0): { sum = acc + item }
```

**Rules:**
- Pipeline stages use `{ }` for their body
- Single-expression stages can be single-line: `| filter: { keep = item != "USDC" }`
- Multi-statement stages use multi-line braces:
  ```
  | map: {
    x = item * 2
    mapped = x + 1
  }
  ```
- Stage names keep colon because they label the body

### Advisory/Advise Blocks

```
// BEFORE
decision = advise risk: "Assess this trade"
  output:
    type: object
    fields:
      allow:
        type: boolean
      confidence:
        type: number
        min: 0
        max: 1
  timeout: 20
  fallback: true

// AFTER
decision = advise risk: "Assess this trade" {
  output: {
    type: object
    fields: {
      allow: { type: boolean }
      confidence: { type: number, min: 0, max: 1 }
    }
  }
  timeout: 20
  fallback: true
}
```

**Rules:**
- `advise advisor: "prompt" {` — opens config block
- Nested schema uses `{ }` at every level
- Flat fields can be inlined: `allow: { type: boolean }`
- This is the construct that benefits most from braces — the old 6-level indent depth drops to 3-level brace nesting

### Inline Advisory Condition

```
// No change — already inline
if **should we rebalance based on current rates** {
  morpho.lend(USDC, amount)
} else {
  emit skipped()
}
```

### Block Definitions

```
// BEFORE
block add(a, b):
  sum = a + b
  emit added(sum=sum)

// AFTER
block add(a, b) {
  sum = a + b
  emit added(sum=sum)
}
```

### Triggers

```
// Manual
on manual: {
  x = 1
}

// Scheduled
on hourly: {
  emit tick()
}

// Condition
on condition balance(USDC) < 1000 every 1h: {
  emit low_balance()
}

// Event
on event "risk.alert" where severity > 3: {
  emit alert()
}
```

**Rules:**
- All triggers keep the colon (it's a label introducing the block)
- Body always in `{ }`

---

## Formal Grammar Changes

### Tokens Removed
- `INDENT`
- `DEDENT`

### Tokens Added
- None — `LBRACE` (`{`) and `RBRACE` (`}`) already exist in the tokenizer for inline objects and bracket depth tracking

### Token Behavior Changes
- `NEWLINE` becomes a statement separator (like Go/Rust), not a structural token
- `NEWLINE` is ignored inside `{ }` blocks (already true today via `bracketDepth`)
- Semicolons (`;`) are an alternative statement separator

### Grammar Productions (complete list of changes)

Every production that currently uses `COLON NEWLINE INDENT ... DEDENT` changes to one of two patterns:

**Pattern A: Label Block** (sections, triggers, branches)
```
section ::= KEYWORD COLON LBRACE items RBRACE
trigger ::= ON trigger_type COLON LBRACE statements RBRACE
branch  ::= IDENTIFIER COLON LBRACE statements RBRACE
```

**Pattern B: Keyword Block** (control flow)
```
if_stmt     ::= IF expr LBRACE stmts RBRACE (ELIF expr LBRACE stmts RBRACE)* (ELSE LBRACE stmts RBRACE)?
for_stmt    ::= FOR IDENT IN expr LBRACE stmts RBRACE
repeat_stmt ::= REPEAT NUMBER LBRACE stmts RBRACE
until_stmt  ::= LOOP UNTIL expr MAX NUMBER LBRACE stmts RBRACE
try_stmt    ::= TRY LBRACE stmts RBRACE (CATCH pattern LBRACE stmts RBRACE)* (FINALLY LBRACE stmts RBRACE)?
parallel    ::= PARALLEL config LBRACE branches RBRACE
atomic_stmt ::= ATOMIC mode? LBRACE stmts RBRACE
block_def   ::= BLOCK IDENT params? LBRACE stmts RBRACE
advise_stmt ::= IDENT ASSIGN ADVISE IDENT COLON STRING LBRACE advise_opts RBRACE
```

**Difference between A and B:**
- Pattern A (labels) keeps the colon: `params: {` — because the keyword names/labels the block
- Pattern B (control flow) drops the colon: `if x > 0 {` — because the keyword introduces a condition, not a label
- This matches Go convention: `func main() {` vs JSON `"key": {}`

### Complete Production List

| Production | Old | New |
|---|---|---|
| `spell_body` | `spell Name NL INDENT sections DEDENT` | `spell Name LBRACE sections RBRACE` |
| `params_section` | `params: NL INDENT items DEDENT` | `params: LBRACE items RBRACE` |
| `limits_section` | `limits: NL INDENT items DEDENT` | `limits: LBRACE items RBRACE` |
| `venues_section` | `venues: NL INDENT items DEDENT` | `venues: LBRACE items RBRACE` |
| `state_section` | `state: NL INDENT scopes DEDENT` | `state: LBRACE scopes RBRACE` |
| `state_scope` | `persistent: NL INDENT vars DEDENT` | `persistent: LBRACE vars RBRACE` |
| `skills_section` | `skills: NL INDENT skills DEDENT` | `skills: LBRACE skills RBRACE` |
| `skill_item` | `name: NL INDENT props DEDENT` | `name: LBRACE props RBRACE` |
| `skill_constraints` | `default_constraints: NL INDENT props DEDENT` | `default_constraints: LBRACE props RBRACE` |
| `advisors_section` | `advisors: NL INDENT advisors DEDENT` | `advisors: LBRACE advisors RBRACE` |
| `advisor_item` | `name: NL INDENT props DEDENT` | `name: LBRACE props RBRACE` |
| `guards_section` | `guards: NL INDENT guards DEDENT` | `guards: LBRACE guards RBRACE` |
| `assets_section` (metadata) | `assets: NL INDENT assets DEDENT` | `assets: LBRACE assets RBRACE` |
| `asset_metadata` | `USDC: NL INDENT props DEDENT` | `USDC: LBRACE props RBRACE` |
| `trigger_handler` | `on type: NL INDENT stmts DEDENT` | `on type: LBRACE stmts RBRACE` |
| `block_def` | `block name(p): NL INDENT stmts DEDENT` | `block name(p) LBRACE stmts RBRACE` |
| `if_stmt` | `if expr: NL INDENT stmts DEDENT` | `if expr LBRACE stmts RBRACE` |
| `elif_clause` | `elif expr: NL INDENT stmts DEDENT` | `RBRACE elif expr LBRACE stmts` |
| `else_clause` | `else: NL INDENT stmts DEDENT` | `RBRACE else LBRACE stmts` |
| `for_stmt` | `for x in y: NL INDENT stmts DEDENT` | `for x in y LBRACE stmts RBRACE` |
| `repeat_stmt` | `repeat N: NL INDENT stmts DEDENT` | `repeat N LBRACE stmts RBRACE` |
| `until_stmt` | `loop until c max N: NL INDENT stmts DEDENT` | `loop until c max N LBRACE stmts RBRACE` |
| `try_block` | `try: NL INDENT stmts DEDENT` | `try LBRACE stmts RBRACE` |
| `catch_block` | `catch E: NL INDENT stmts DEDENT` | `RBRACE catch E LBRACE stmts` |
| `finally_block` | `finally: NL INDENT stmts DEDENT` | `RBRACE finally LBRACE stmts` |
| `parallel_stmt` | `parallel cfg: NL INDENT branches DEDENT` | `parallel cfg LBRACE branches RBRACE` |
| `parallel_branch` | `name: NL INDENT stmts DEDENT` | `name: LBRACE stmts RBRACE` |
| `atomic_stmt` | `atomic mode: NL INDENT stmts DEDENT` | `atomic mode LBRACE stmts RBRACE` |
| `pipeline_stage` | `\| op: NL INDENT stmts DEDENT` | `\| op: LBRACE stmts RBRACE` |
| `advise_stmt` | `x = advise a: "p" NL INDENT opts DEDENT` | `x = advise a: "p" LBRACE opts RBRACE` |
| `advise_output` | `output: NL INDENT schema DEDENT` | `output: LBRACE schema RBRACE` |
| `retry_block` | `retry: NL INDENT props DEDENT` | `retry: LBRACE props RBRACE` |

---

## Implementation Plan

### Phase 1: Tokenizer

**Remove:**
- `indentStack` tracking (lines 121-129)
- `handleLineStart()` method (lines 191-266)
- `atLineStart` flag
- INDENT/DEDENT token types
- EOF dedent emission
- `IndentationError` class

**Change:**
- `bracketDepth` already tracks `{ }` — this now becomes the primary block mechanism
- NEWLINE tokens emitted only outside braces (statement separation)
- Whitespace (spaces, tabs) is purely cosmetic — skipped, never tracked

**Keep:**
- All other token types unchanged
- `LBRACE` / `RBRACE` already in the tokenizer
- Bracket depth suppression of newlines inside `( )` and `[ ]`

**Estimated diff:** ~120 lines removed from tokenizer, ~10 lines changed.

### Phase 2: Parser

**Systematic replacement** across ~30 methods:

Replace every instance of:
```typescript
this.expect("COLON");
this.expectNewline();
if (this.check("INDENT")) {
  this.advance();
  while (!this.check("DEDENT") && !this.check("EOF")) {
    // parse items
  }
  if (this.check("DEDENT")) this.advance();
}
```

With (Pattern A — labeled blocks):
```typescript
this.expect("COLON");
this.expect("LBRACE");
while (!this.check("RBRACE") && !this.check("EOF")) {
  // parse items
}
this.expect("RBRACE");
```

Or (Pattern B — control flow blocks):
```typescript
// no colon expected
this.expect("LBRACE");
while (!this.check("RBRACE") && !this.check("EOF")) {
  // parse statements
}
this.expect("RBRACE");
```

**Special cases:**
- `if/elif/else` — parser looks for `} elif` and `} else` as continuation tokens
- `try/catch/finally` — parser looks for `} catch` and `} finally`
- `spell` body — `spell Name {` instead of `spell Name NL INDENT`
- Pipeline stages — `| op: { body }` instead of `| op: NL INDENT body DEDENT`

**Remove:**
- `expectNewline()` calls before blocks
- INDENT/DEDENT checks throughout
- `parseStatementBlock()` helper (replace with brace-delimited block parser)

**Estimated diff:** ~200 lines changed across parser methods, net ~50 lines removed.

### Phase 3: Tests

- Rewrite all inline spell strings in test files to use brace syntax
- Rewrite all `.spell` fixture files in `spells/` directory
- Add new tests for:
  - Missing closing brace (clear error message)
  - Extra closing brace
  - Empty blocks `{ }`
  - Single-line blocks `if x > 0 { emit yes() }`
  - Nested braces at 4+ levels
  - Trailing commas in all list contexts
- Remove indentation-specific tests (tab handling, mixed indent errors, multi-dedent)

### Phase 4: Migration Tool

```bash
grimoire migrate <spell-file>        # Migrate single file in-place
grimoire migrate <directory> --dry-run  # Preview changes
grimoire migrate <directory>          # Migrate all .spell files
```

The migrator:
1. Parse the old file with the current (indentation) parser
2. Walk the AST
3. Emit new syntax with braces, preserving comments and blank lines
4. Write back to the file

This is a one-time tool. It can be removed after the migration period.

### Phase 5: Skill & Documentation Updates

- Update all SKILL.md files with new syntax examples
- Update docs/reference/ with new grammar
- Update the VM skill's spell parsing/validation logic
- Update any hardcoded spell examples in agent prompts

### Phase 6: Transformer & IR

**No changes required.** The transformer and IR generator consume AST nodes, not tokens. The AST structure (sections, statements, expressions) is identical — only the delimiters that produce it change. This is the key architectural advantage: indentation is purely a lexical concern that dies at parse time.

---

## Edge Cases and Decisions

### Single-line blocks
Allowed. An agent can write:
```
if balance(USDC) > 0 { emit has_balance() }
```
This is valid. The parser sees `LBRACE`, one statement, `RBRACE`.

### Empty blocks
Allowed with `pass` or empty braces:
```
on daily: { }
on daily: { pass }
```
Both valid. Empty `{ }` is a no-op trigger.

### Semicolons
Optional statement separator within a block:
```
on manual: { x = 1; y = 2; emit done(x=x, y=y) }
```
Semicolons let agents write compact single-line spells when they don't need readability.

### Trailing commas
Allowed in all comma-separated contexts:
```
assets: [USDC, ETH, WETH,]  // OK
params: { amount: 1000, threshold: 500, }  // OK — but params use newline separation
emit done(x=x, y=y,)  // OK
```

### Comments
No change. `#` line comments work identically. They can appear on their own line or at the end of a line, inside or outside braces.

### String literals and multi-line strings
No change. Strings are already bracket-depth-aware. Multi-line strings (if added later) would follow standard rules.

### Colon disambiguation
The colon appears in two contexts:
1. **Label colon** — `params:`, `on manual:`, `alpha:` — introduces a `{ }` block
2. **Value colon** — `amount: 1000`, `type: swap` — key-value pair inside a block

These are unambiguous because:
- A label colon is followed by `{` (possibly with whitespace/newline between)
- A value colon is followed by a value expression

The parser already distinguishes these by context (section header vs. item).

---

## Migration Impact

### What breaks
- Every existing `.spell` file
- Every inline spell string in tests
- Every spell example in documentation and SKILL.md files
- Agent skills that parse or generate spell syntax

### What doesn't break
- The IR format (JSON) — unchanged
- The runtime/interpreter — unchanged
- Venue adapters — unchanged
- State persistence — unchanged
- CLI commands (except `compile`/`validate` which use the parser)

### Risk mitigation
- The `grimoire migrate` tool automates the conversion
- All changes are in the tokenizer + parser — the rest of the stack is untouched
- We can run both test suites (old syntax → migrated → re-parsed) to verify roundtrip correctness

---

## Success Criteria

1. All existing spells compile after automated migration
2. All tests pass with brace syntax
3. An agent (Claude, GPT-4) can write a valid spell from a natural language description without indentation errors
4. Compilation errors for missing/extra braces include the line number and expected context
5. The tokenizer is at least 100 lines shorter than today
6. No INDENT/DEDENT token type exists anywhere in the codebase
