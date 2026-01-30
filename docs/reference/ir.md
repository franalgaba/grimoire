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
  state: StateSchema;
}
```

## StateSchema

Persistent and ephemeral state definitions. Persistent state survives across runs when used with a `StateStore`.

```ts
interface StateSchema {
  persistent: Record<string, StateField>;
  ephemeral: Record<string, StateField>;
}

interface StateField {
  key: string;
  initialValue: unknown;
}
```

At runtime, persistent state is initialized from schema defaults, with any values from `persistentState` (loaded from the store) taking precedence. After execution, `ExecutionResult.finalState` contains the final persistent state to save back.

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
