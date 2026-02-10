# Data Provenance and Replay

Data provenance and replay exist to answer two operational questions:

If you are new, start with `docs/explanation/mental-model.md` before this page.

1. "What exact inputs did this run use?"
2. "Can I reproduce or safely re-run this behavior?"

In production strategy systems, those questions matter as much as raw execution success.

## Problem This Solves

Without provenance and replay controls:

- two runs can appear identical but use different input data
- stale snapshots can silently drive decisions
- post-mortems become guesswork instead of evidence-based analysis

Grimoire addresses this by attaching structured data provenance to runs and providing controlled replay modes.

## Operator Controls

Primary CLI controls:

- `--data-replay <off|auto|runId|snapshotId>`
- `--data-max-age <seconds>` (default `3600`)
- `--on-stale <fail|warn>` (default `fail`)

Defaults are mode-sensitive:

- `simulate` / `dry-run`: replay mode defaults to `auto`
- live `cast`: replay mode defaults to `off`

This default split favors reproducibility in planning and freshness in settlement.

## Replay Modes: Mental Model

### `off`

Do not reuse prior data context. Favor latest available inputs.

### `auto`

Let runtime choose replay behavior when previous context exists and policy allows.

### explicit run ID / snapshot ID

Pin to known prior provenance source for deterministic comparison or controlled retry.

## How Replay Resolution Works

When replay is explicit:

1. Runtime resolves prior provenance from persistent history.
2. Replayed `resolved_params` are loaded as base input.
3. Current CLI params override replayed params via deep merge.

This gives deterministic defaults with targeted overrides.

If persistence is disabled (`--no-state`), explicit replay cannot be resolved and is rejected.

## Provenance Manifest

Runtime attaches a structured provenance document (for example `grimoire.runtime.provenance.v1`) to run metadata.

Typical fields include:

- runtime mode
- chain and optional provider/block context
- replay policy and resolved replay source
- param hash and optional snapshot hash
- source entries and staleness summary
- final resolved params used for execution

This turns "what happened?" from narrative into queryable data.

## Snapshot Discovery and Freshness

Runtime discovers snapshot-bearing params recursively (using snapshot markers such as `snapshot_at`).

For each discovered source:

- compute `snapshot_age_sec`
- compare against `data_max_age_sec`
- mark stale/non-stale

Stale handling policy:

- `on_stale=fail`: reject run before risky execution
- `on_stale=warn`: continue but emit explicit warnings

## Why Freshness Policy Must Be Explicit

Freshness tolerance is strategy-specific.

Examples:

- high-frequency swap logic may require very fresh quotes
- slower rebalancing may allow older snapshots

By making freshness a policy input, Grimoire avoids hidden assumptions in runtime behavior.

## Replay vs Drift: Different Safety Layers

Replay controls input determinism.
Drift controls settlement-time safety.

Both are required:

- replay helps reproduce decisions
- drift ensures those decisions are still acceptable now

## Practical Usage Patterns

### Debugging a surprising run

Use explicit replay by run ID, then compare behavior after a minimal param override.

### Promoting strategy changes safely

Run `simulate` with replay-aware settings, then dry-run cast with the same policy envelope.

### Production live execution

Use freshness policy that matches strategy latency tolerance; fail stale by default when risk is high.

## Mental Model Summary

Provenance is the execution memory of the system.
Replay is how you intentionally reuse that memory.
Freshness policy decides when that memory is still trustworthy.
