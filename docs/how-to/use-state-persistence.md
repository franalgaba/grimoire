# How To Use State Persistence

Grimoire CLI persists run state by default via SQLite.

## Default Behavior

`simulate` and `cast` automatically:

1. load prior persistent state
2. execute
3. save final persistent state
4. append run record
5. save run ledger

## Basic Usage

```bash
grimoire simulate spells/test-state-counter.spell
grimoire simulate spells/test-state-counter.spell
```

Second run can observe prior persistent values.

## Custom State Directory

```bash
grimoire simulate spells/test-state-counter.spell --state-dir .grimoire/dev-state
```

Database file location becomes:

- `.grimoire/dev-state/grimoire.db`

## Disable Persistence

```bash
grimoire simulate spells/test-state-counter.spell --no-state
```

This runs with empty persistent state and writes nothing.

## Inspect Persisted Runs

```bash
grimoire history
grimoire history <spell-id>
grimoire log <spell-id> <run-id>
```

## Programmatic Usage

```ts
import { SqliteStateStore, createRunRecord, execute } from "@grimoirelabs/core";

const store = new SqliteStateStore();
const persistentState = (await store.load(spell.id)) ?? {};

const result = await execute({
  spell,
  vault,
  chain,
  persistentState,
  simulate: true,
});

await store.save(spell.id, result.finalState);
await store.addRun(spell.id, createRunRecord(result));
await store.saveLedger(spell.id, result.runId, result.ledgerEvents);
store.close();
```
