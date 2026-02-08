# DefiHack Prompt-First E2E Runbook

Use this flow to run the demo without hand-writing spell files.
The agent should generate spells from intent-level prompts, then you validate VM and deterministic CLI execution.

## 1) Prompt Pattern (Use This Style)

```text
Create a Grimoire VM spell named <SpellName> and save it to <path>.
Use a snapshot params block, define clear selection rules, include demo data, and emit candidate + decision events.
No side effects.
```

Example:

```text
Create a Grimoire VM spell named MorphoYieldOptimizer and save it to spells/morpho-yield-optimizer-vm.spell.
Use a snapshot params block, ignore markets with TVL < 5,000,000, and recommend switching when the spread over the current market is > 0.5%.
Include a demo snapshot with 3 Morpho USDC markets and emit candidate + recommendation/hold events.
No side effects.
```

## 2) Create DefiHack Spell 1 (Yellow Track)

```text
Create a Grimoire VM spell named YellowSessionTrack and save it to spells/defihack/yellow-session-track.spell.
Focus only on Yellow session lifecycle.
Use params for open payload, two update payloads, and a close payload.
Use venue @yellow and a dedicated skill that routes only to yellow.
On manual trigger: open session, process updates in a loop, then close/settle.
Emit events for open, each update, and close.
No side effects.
```

## 3) Create DefiHack Spell 2 (Liquidity Track)

```text
Create a Grimoire VM spell named LiquidityMeshTrack and save it to spells/defihack/liquidity-mesh-track.spell.
Focus only on Uniswap v4 + LI.FI liquidity routing.
Use params for rebalance amount, min swap out, bridge amount, target chain, min bridge out, and bridge toggle.
Use venues @uniswap_v4 and @lifi.
Define one unified skill for both adapters with default max_slippage 80 bps.
On manual trigger: run 2 cycles; each cycle does one swap and, when enabled, one bridge.
Emit swap event per cycle, bridge event per cycle, and final summary event.
No side effects.
```

## 4) Ask the Agent To Verify Generated Spells

```text
Read spells/defihack/yellow-session-track.spell and spells/defihack/liquidity-mesh-track.spell.
Return a short checklist confirming:
1) syntax is valid Grimoire DSL,
2) expected venues/skills are present,
3) expected events are emitted.
If any gap exists, patch the files.
```

## 5) Run Both In VM Mode

```text
Run spells/defihack/yellow-session-track.spell in the Grimoire VM with trigger manual. Use defaults and no side effects.
Run spells/defihack/liquidity-mesh-track.spell in the Grimoire VM with trigger manual. Use defaults and no side effects.
Return run logs with status, events, and bindings for each spell.
```

VM mode is best-effort and non-deterministic; use it for rehearsal and quick feedback.

## 6) Deterministic CLI E2E

From `packages/cli`:

```bash
cd packages/cli
bun run --filter @grimoirelabs/cli dev compile-all ../../spells/defihack --json

bun run --filter @grimoirelabs/cli dev simulate ../../spells/defihack/yellow-session-track.spell --no-state --json
bun run --filter @grimoirelabs/cli dev simulate ../../spells/defihack/liquidity-mesh-track.spell --no-state --json

HOME=/tmp/grimoire-defihack-yellow bun run --filter @grimoirelabs/cli dev cast ../../spells/defihack/yellow-session-track.spell --dry-run --no-state --json
HOME=/tmp/grimoire-defihack-liquidity bun run --filter @grimoirelabs/cli dev cast ../../spells/defihack/liquidity-mesh-track.spell --dry-run --no-state --json
```

## 7) Optional Determinism Diff Check

```bash
jq -S 'del(.run.run_id, .run.duration_ms, .data.provenance.generated_at)' out1.json > out1.norm.json
jq -S 'del(.run.run_id, .run.duration_ms, .data.provenance.generated_at)' out2.json > out2.norm.json
diff -u out1.norm.json out2.norm.json
```

## 8) Expected Demo Signals

- `YellowSessionTrack`: open event, two update events, close event.
- `LiquidityMeshTrack`: two swap events, two bridge events, final summary event.
