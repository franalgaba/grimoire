# IR schema reference

The compiler emits `SpellIR`, the executable form of a spell.

```ts
interface SpellIR {
  id: string;
  version: string;
  trigger: Trigger;
  assets: AssetDef[];
  params: ParamDef[];
  aliases: VenueAlias[];
  steps: Step[];
  guards: GuardDef[];
}
```

## Step types

- `ComputeStep`
- `ActionStep`
- `ConditionalStep`
- `LoopStep`
- `EmitStep`
- `HaltStep`
- `WaitStep`

## ActionStep

```ts
interface ActionStep {
  kind: "action";
  id: string;
  action: Action;
  constraints: ActionConstraints;
  onFailure: "revert" | "skip" | "halt" | "catch";
}
```

## Trigger types

- manual
- schedule (cron)
- condition (poll)
- any (composite)
