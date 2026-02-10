# How To Publish

This repository uses Changesets for release workflows after initial bootstrapping.

## Prerequisites

- npm publish permissions for `@grimoirelabs/*`
- clean working tree
- validated build/test

## 1. Validate

```bash
bun install
bun run validate
```

## 2. Create Changeset (normal release flow)

```bash
bunx changeset
```

Commit generated changeset files.

## 3. Version Packages

```bash
bun run version
```

This runs `changeset version` and formats the repo.

## 4. Build

```bash
bun run build
```

## 5. Publish

```bash
bun run release
```

`release` runs build + `changeset publish` with provenance/public access env defaults.

## Initial 0.1.0 Note

Per project policy, initial `0.1.0` publish is manual. After that, use Changesets + CI/release flow.

## Package Entry Points

Published packages:

- `@grimoirelabs/core`
- `@grimoirelabs/venues`
- `@grimoirelabs/cli`

## Post-Publish Checks

- Verify package versions on npm
- Validate CLI install path:

```bash
npm i -g @grimoirelabs/cli@latest
grimoire --version
```
