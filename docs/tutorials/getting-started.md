# Getting started

This tutorial walks through installing dependencies, running tests, and compiling a spell.

## Prerequisites

- [Bun](https://bun.sh/) runtime
- Git

## 1) Install dependencies

```bash
bun install
```

## 2) Run checks

```bash
bun run lint
bun run typecheck
bun test
```

## 3) Compile a spell

Pick an example spell from `spells/`:

```bash
bun -e "import { compileFile } from './packages/core/src/compiler/index.ts'; const res = await compileFile('spells/simple-swap.spell'); console.log(res.success);"
```

If `success` is `true`, compilation worked.

## Next steps

- Write your first spell: [tutorials/first-spell.md](first-spell.md)
- Execute a spell with venues: [tutorials/execute-with-venues.md](execute-with-venues.md)
