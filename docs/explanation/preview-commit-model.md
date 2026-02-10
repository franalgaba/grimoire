# Preview/Commit Model

The preview/commit lifecycle is the core safety mechanism in Grimoire.

If you are new, start with `docs/explanation/mental-model.md` before this page.

If you remember one idea:

Preview decides what should happen. Commit decides whether it is still safe to do it now.

## Why Two Phases Exist

Value-moving strategy execution has two distinct risks:

1. Logic risk: did the strategy select acceptable actions?
2. Timing risk: are those actions still acceptable at settlement time?

Preview addresses logic risk.
Commit addresses timing risk.

Combining both in one step would hide this distinction and reduce auditability.

## Phase 1: Preview

`preview()` executes full spell logic in simulation/planning mode.

Preview does all of the following:

- runs control flow (conditions, loops, advisory points, guards)
- plans irreversible actions instead of directly settling them
- evaluates constraints and limits
- computes value-flow/accounting outputs
- produces drift-sensitive assumptions for later checks
- emits a typed receipt with status (`ready` or `rejected`)

No irreversible movement should occur during preview.

## Preview Output: The Receipt

The receipt is the bridge between planning and settlement.

It captures:

- planned action set
- evaluated constraint outcomes
- value deltas and accounting summaries
- drift keys and policy-relevant assumptions
- metadata needed to prove receipt identity

Receipt status:

- `ready`: plan is internally consistent and policy-compliant
- `rejected`: constraints/policies blocked execution

In practice, `rejected` is often the expected safe outcome when constraints are tight.

## Phase 2: Commit

`commit()` consumes a valid `ready` receipt and attempts settlement.

Commit checks before sending value-moving actions:

- receipt identity and status validity
- receipt provenance in issued-receipt registry
- commit-time drift against preview assumptions
- policy compatibility at current time

Only after these gates pass does settlement proceed.

Commit output typically includes:

- submission artifacts (for example tx hashes)
- execution outcomes
- drift check results
- final run/ledger state

## `execute()` Convenience API

`execute()` wraps the lifecycle with mode-aware behavior:

- `simulate` and `dry-run`: preview only
- `execute` mode with valid wallet and planned actions: preview + commit path

This allows one entry API while keeping phase semantics explicit.

## Constraint Enforcement in Preview

Constraint checks happen before commit by design.

Typical constraints:

- `max_single_move`
- `approval_required_above`
- `max_value_at_risk`
- `max_slippage`
- `max_gas`
- `allowed_venues`
- `rebalance_cooldown`

Constraint violations reject the receipt early, which is cheaper and safer than failing late.

## Drift Enforcement in Commit

Even a good preview can become unsafe by commit time due to market and state change.

Commit drift checks compare preview assumptions against current data classes:

- balances
- quote/output expectations
- rates/prices
- gas environment

If tolerance is exceeded, commit rejects (for example `DRIFT_EXCEEDED`), requiring a fresh preview.

## Approval and Policy Gating

Preview can classify a plan as requiring explicit approval.

This enables a predictable policy split:

- small, bounded actions can proceed automatically if policy allows
- larger actions are paused for operator approval

The runtime remains enforcement-focused; approval UX is orchestrator-specific.

## Common User Confusions

### "Why did preview pass but commit fail?"

Usually drift or time-sensitive assumptions changed between phases.

### "Why preview on dry-run?"

Dry-run is still a policy and feasibility check. It intentionally validates plan quality before live execution.

### "Why can receipt be rejected even with valid syntax?"

Syntax validity only means "parsable and well-typed." Policy validity is decided during preview.

## Operational Best Practices

1. Always inspect preview outcomes before live commit.
2. Keep constraints explicit, especially slippage and value-at-risk bounds.
3. Treat drift failures as normal market reality, not runtime instability.
4. Use replay/provenance controls for reproducible investigations.
5. Persist run history and ledger for every production strategy run.

## Mental Model Summary

Preview/commit is not overhead. It is the runtime contract that makes strategy execution inspectable, enforceable, and safe enough to operate repeatedly.
