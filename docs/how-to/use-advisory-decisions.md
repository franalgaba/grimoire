# How To Use Advisory Decisions In Spells

Use this guide to add AI-backed decision points with explicit contracts and predictable runtime behavior.

## Outcome

After this guide, you can:

- define advisors in a spell
- use `advise` to produce typed decision outputs
- gate value-moving actions using advisory outputs
- run preview, dry-run, and replayed execution safely

## 1. Define an Advisor

Add an `advisors` section:

```spell
advisors: {
  risk: {
    model: anthropic:claude-sonnet-4-20250514
    system_prompt: "Return JSON only."
    skills: [grimoire]
    allowed_tools: [read_file]
    mcp: [docs]
    timeout: 20
    fallback: true
  }
}
```

Notes:

- `model` can be provider-qualified (`provider:model`) or plain model id.
- `skills`, `allowed_tools`, and `mcp` are passed into advisory tooling metadata.

## 2. Add an `advise` Step With Typed Output

Use assignment form only:

```spell
decision = advise risk: "Should we rebalance USDC now?" {
  context: {
    balance: to_number(balance(USDC))
    usdc_weth_price: price(USDC, WETH)
    target_amount: params.amount
  }
  within: execution
  output: {
    type: object
    fields: {
      allow: boolean
      max_slippage_bps: number
      reason: string
    }
  }
  on_violation: reject
  timeout: 20
  fallback: { allow: false, max_slippage_bps: 30, reason: "fallback" }
}
```

Required fields in the `advise` block:

- `output`
- `timeout`
- `fallback`

Recommended for strict validation:

- `context`
- `within`
- `on_violation`

## 3. Drive Logic From The Advisory Output

Use the binding in control flow:

```spell
if decision.allow {
  uniswap_v3.swap(USDC, WETH, params.amount) with (
    max_slippage=decision.max_slippage_bps,
    min_output=params.min_output,
  )
} else {
  emit skipped(reason=decision.reason)
}
```

## 4. Validate In Strict Mode

```bash
grimoire validate spells/my-strategy.spell --strict
```

`--strict` turns advisory warnings (for example missing `context` or `within`) into failures.

## 5. Preview Advisory Behavior

```bash
grimoire simulate spells/my-strategy.spell --chain 1
```

Runtime behavior:

- If advisory model execution succeeds, the model output is schema-validated and bound.
- If advisory model execution fails, fallback is evaluated and used.
- If schema validation fails and `on_violation: reject`, the step fails.
- If schema validation fails and `on_violation: clamp`, runtime attempts schema coercion; if coercion still fails, the step fails.

## 6. Run Deterministically With Advisory Replay

Replay uses advisory outputs recorded in a prior run ledger:

```bash
grimoire cast spells/my-strategy.spell \
  --dry-run \
  --chain 1 \
  --key-env PRIVATE_KEY \
  --rpc-url <rpc> \
  --advisory-replay <runId>
```

```bash
grimoire cast spells/my-strategy.spell \
  --chain 1 \
  --key-env PRIVATE_KEY \
  --rpc-url <rpc> \
  --advisory-replay <runId>
```

Replay requirements:

- state persistence must be enabled (do not pass `--no-state`)
- replay run must have advisory outputs for the same advisory step IDs

## 7. Inspect Advisory Events

```bash
grimoire history <spell-id>
grimoire log <spell-id> <run-id>
```

Look for:

- `advisory_started`
- `advisory_model_used`
- `advisory_tool_execution_start|update|end`
- `advisory_completed`
- `advisory_failed`

## Troubleshooting

- `Inline advisory expressions (**...**) are no longer supported`
  - use `decision = advise ... { ... }` and branch on `decision`
- `--advisory-replay requires state persistence`
  - remove `--no-state`
- `Advisory output violated schema`
  - align model/fallback output with declared `output` schema
- `Advisory step ... enables clamp but has no clamp_constraints`
  - add `clamp_constraints` when using `on_violation: clamp`
