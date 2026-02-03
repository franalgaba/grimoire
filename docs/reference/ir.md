# IR schema reference

The compiler emits `SpellIR`, the executable form of a spell.

```ts
interface SpellIR {
  id: string;
  version: string;
  meta: {
    name: string;
    description?: string;
    author?: Address;
    created: Timestamp;
    hash: string;
  };

  aliases: VenueAlias[];
  assets: AssetDef[];
  skills: SkillDef[];
  advisors: AdvisorDef[];
  params: ParamDef[];
  state: StateSchema;

  steps: Step[];
  guards: GuardDef[];
  triggers: Trigger[];

  sourceMap?: Record<string, { line: number; column: number }>;
}
```

## Skills and advisors

```ts
interface SkillDef {
  name: string;
  type: "swap" | "yield" | "lending" | "staking" | "bridge";
  adapters: string[]; // venue aliases
  defaultConstraints?: { maxSlippage?: number };
}

interface AdvisorDef {
  name: string;
  model: "haiku" | "sonnet" | "opus";
  scope: "read-only";
  systemPrompt?: string;
  skills?: string[];
  allowedTools?: string[];
  defaultTimeout?: number;
  defaultFallback?: boolean;
  rateLimit?: {
    maxCallsPerRun: number;
    maxCallsPerHour: number;
  };
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

At runtime, persistent state is initialized from schema defaults, with any values from `persistentState` taking precedence. After execution, `ExecutionResult.finalState` contains the final persistent state to save back.

## Guards

```ts
type GuardDef = Guard | AdvisoryGuard;

interface Guard {
  id: string;
  check: Expression;
  severity: "warn" | "revert" | "halt";
  message: string;
}

interface AdvisoryGuard {
  id: string;
  advisor: string;
  check: string; // prompt
  severity: "warn" | "pause";
  fallback: boolean;
}
```

## Step types

- `ComputeStep`
- `ActionStep`
- `ConditionalStep`
- `LoopStep`
- `ParallelStep`
- `PipelineStep`
- `TryStep`
- `AdvisoryStep`
- `WaitStep`
- `EmitStep`
- `HaltStep`

## ActionStep

```ts
interface ActionStep {
  kind: "action";
  id: string;
  skill?: string;
  action: Action;
  constraints: ActionConstraints;
  outputBinding?: string;
  onFailure: "revert" | "skip" | "halt" | "catch";
  dependsOn: string[];
}
```

## AdvisoryStep

```ts
interface AdvisoryStep {
  kind: "advisory";
  id: string;
  advisor: string;
  prompt: string;
  context?: Record<string, Expression>;
  outputSchema:
    | { type: "boolean" }
    | { type: "number"; min?: number; max?: number }
    | { type: "enum"; values?: string[] }
    | { type: "string"; minLength?: number; maxLength?: number; pattern?: string }
    | { type: "object"; fields?: Record<string, AdvisoryOutputSchema> }
    | { type: "array"; items?: AdvisoryOutputSchema };
  outputBinding: string;
  timeout: number;
  fallback: Expression;
  dependsOn: string[];
}
```

## TryStep

```ts
interface TryStep {
  kind: "try";
  id: string;
  trySteps: string[];
  catchBlocks: CatchBlock[];
  finallySteps?: string[];
  dependsOn: string[];
}
```

## Trigger types

- manual
- schedule (cron)
- condition (poll)
- event
- any (composite)
