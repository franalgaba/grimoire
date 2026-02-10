# Grimoire Through the Lens of "A Language For Agents"

First-principles analysis of Grimoire's design decisions against the framework from Armin Ronacher's article on what makes a programming language agent-friendly.

---

## What We're Getting Right

### 1. Greppability & Local Reasoning
The `.spell` format nails this. Venue references are always prefixed (`aave.deposit`, `uniswap_v3.swap`), params are always `params.x`, state is always `state.persistent.y`. An agent grep-scanning a spell file can immediately understand what it's looking at without needing to resolve imports or chase aliases. This aligns directly with the article's praise of Go's `context.Context` pattern.

### 2. Explicit Side Effects — We Independently Arrived at `needs`
The `needs { time, rng }` pattern from the article is almost exactly what our `venues:` and `advisors:` sections do — they declare upfront what external capabilities a spell requires. Our `guards:` section goes further: it declares preconditions that must hold before any side effect fires. An agent reading a spell knows exactly what the blast radius is before line 1 of execution runs.

### 3. Results Over Exceptions
Our error model is typed results with catch blocks matching on classified error types (`slippage_exceeded`, `insufficient_balance`). This is precisely what the article advocates — no hidden exception paths, no agent panic-catching everything. The agent sees `catch slippage_exceeded:` and knows exactly what failure mode it's handling.

### 4. One Command to Rule Them All
`grimoire validate` does lint + compile + semantic checks. `grimoire cast --dry-run` does the full execution path without settlement. The article emphasizes that agents hate multiple failure conditions — our pipeline gives them one verdict: it either compiles and runs or it doesn't.

### 5. No Macros, No Re-exports, No Aliasing
Spells don't have an import system, barrel files, or macro expansion. Every construct is what it looks like. This sidesteps an entire class of problems the article identifies as agent-hostile.

### 6. Dependency-Aware Execution
Steps have explicit `dependsOn` in the IR. The execution graph is topologically ordered. This is the "dependency aware builds" principle applied to runtime — the agent and runtime both know exactly what depends on what.

---

## What's Working Against Us

### 1. Whitespace-Significant Syntax
This is the big one. The article explicitly calls out Python-style indentation as problematic for LLMs — token efficiency of getting whitespace right is tricky, agents intentionally disregard it, and surgical edits become fragile. Our spell syntax uses 2-space indentation as significant structure. Every `if:`, `try:`, `on manual:` block depends on correct indentation.

The irony: we chose the syntax that's most readable to humans reviewing agent output, but hardest for agents to produce correctly. The article suggests braces are better — not Lisp-style stacked parens, but C/Rust/Go-style `{}` blocks.

### 2. Multi-line Constructs and Diff Stability
The article warns about reformatting causing constructs to shift lines. Our spell syntax has several multi-line patterns (constraint lists with `with`, `parallel` blocks with named branches, `advise` blocks with `output:` schemas) that could be sensitive to this. Trailing commas in arrays like `assets: [USDC, USDT, DAI]` — if an agent adds a 4th asset, does it need to reformat? This matters for minimal diffs.

### 3. No LSP — But Also No Explicit Types
The article argues that languages shouldn't split into "with-LSP" and "without-LSP" experiences, which we avoid by not having an LSP at all. But the flip side is that our expressions are dynamically typed at runtime. When an agent writes `sum = params.x + params.y`, it has no structural guarantee that `x` and `y` are numbers. The typed params (`type: amount, asset: USDC`) are a start, but they're optional. The article's point about wanting *more* explicit code (even if verbose) to reduce ambiguity during review applies here.

### 4. Advisory Blocks Are Opaque to Static Analysis
Our `advise` and `**bolded prompt**` syntax is innovative — it marks where AI judgment enters the execution flow. But from the article's "local reasoning" principle, these are black boxes. An agent looking at:

```spell
if **should we rebalance based on current rates**:
  morpho.lend(USDC, amount)
```

...can't reason locally about what happens. The advisory could return anything. The `output:` schema helps constrain this, but it's still a fundamentally non-local construct.

### 5. The "Two Runtimes" Problem
VM mode (in-agent, best-effort) vs. Deterministic CLI (production) is conceptually clean but creates the exact "dev env divergence" the article warns about. A spell that works in VM mode could behave differently in CLI mode — different adapter implementations, different state persistence, different error paths. The article argues agents hate this — they want one execution model, not two.

---

## Where We Should Push Further

### 1. Consider Braces (Seriously)
We could keep the readable, structured look but switch from indentation to explicit delimiters:

```
on manual {
  if balance(USDC) > params.threshold {
    aave.deposit(USDC, balance(USDC)) with slippage=50
  }
}
```

This gives agents structural delimiters to anchor on, makes surgical edits safer, and eliminates an entire class of whitespace bugs. The syntax is still familiar — Rust/Go developers read it instantly.

### 2. Make Types Required, Not Optional
Every param should declare its type. Every binding should have a known type at compile time. The compiler already has the information — make it explicit:

```
params:
  amount: uint256 = 100000
  target_apy: bps = 500
```

This costs the agent a few extra tokens to write but gives every reviewer (human and machine) immediate local understanding.

### 3. Unify the Runtimes
Instead of VM mode vs. CLI mode, consider a single execution model with different *providers* plugged in. The spell always runs the same interpreter — but in "preview" mode the adapters return mock/simulated results, while in "live" mode they hit the chain. The execution semantics should be identical. One runtime, multiple backends.

### 4. Structured Error Messages for Agent Consumption
Our error classifier is good, but compilation errors are still human-formatted strings. Consider making every error machine-parseable:

```json
{"code": "GUARD_FAILED", "guard": "positive_amount", "actual": -500, "expected": "> 0", "line": 12}
```

This lets an agent fix the problem without parsing English. The article's "ideally it either runs or doesn't and there is mechanical fixing" principle taken to its logical end.

### 5. Spell-Level `needs` Declarations
We have `venues:` and `advisors:` but not a unified capability declaration. Consider:

```
spell YieldOptimizer
  needs { aave: lending, uniswap: swap, time, rng }
```

This is the article's `needs { time, rng }` pattern — one place to see everything the spell depends on, making it trivially mockable in tests and instantly greppable for dependency analysis.

### 6. Formatter-Driven Annotation Propagation
The article's most interesting idea: let the formatter add annotations that humans/agents skip writing. If an agent writes a spell without `needs`, the formatter adds it by analyzing the body. If constraints are missing, the formatter adds defaults. This reduces the burden on the agent while keeping the output maximally explicit.

---

## The Bottom Line

Grimoire is already well-aligned with what the article describes as agent-friendly. The core insight — structural constraints over behavioral ones, explicit over implicit, greppable over clever — is sound and already implemented. The biggest tension is between **human readability** (Python-like indentation, clean visual structure) and **agent writability** (braces, explicit types, no whitespace sensitivity). The article's thesis is that the cost of writing code is going down, so we should optimize for reading and reviewing. That actually favors *more* explicit syntax, even if it's slightly more verbose. We're 80% there — the remaining 20% is about removing the few places where agents have to get subtle things right (whitespace, implicit types, runtime divergence) and replacing them with unambiguous structure.
