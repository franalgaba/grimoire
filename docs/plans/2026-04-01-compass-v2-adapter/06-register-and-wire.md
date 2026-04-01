# Task 06: Register & Wire Up

## What to Build

Register the adapter in the venues package barrel export, update discovery maps, and add the CLI bin entry.

## Steps

1. Update `packages/venues/src/index.ts`:
   - Import `compassV2Adapter` and `createCompassV2Adapter`
   - Add `compassV2Adapter` to the `adapters` array
   - Add both to the named exports

2. Update `packages/venues/src/shared/discovery.ts`:
   - Add to `BUILTIN_ALIAS_MAP`:
     ```typescript
     compass: ["compass-v2", "compass_v2"],
     ```
   - Add to `CLI_TO_ADAPTER_MAP`:
     ```typescript
     compass: ["compass-v2"],
     ```
   - Add `"compass"` to `KNOWN_CLI_ENTRIES` (automatic via the maps above)

3. Update `packages/venues/package.json`:
   - Add bin entry: `"grimoire-compass": "src/cli/compass.ts"`

## Acceptance Criteria

- [ ] `compassV2Adapter` is in the default `adapters` array
- [ ] `createCompassV2Adapter` is exported from package
- [ ] `grimoire venues` lists compass_v2
- [ ] `grimoire venue compass info` works
- [ ] Discovery finds the adapter by name and aliases

## Files to Modify

- `packages/venues/src/index.ts`
- `packages/venues/src/shared/discovery.ts`
- `packages/venues/package.json`

## Dependencies

- Task 01 (adapter file must exist)
- Task 05 (CLI file must exist for bin entry)
