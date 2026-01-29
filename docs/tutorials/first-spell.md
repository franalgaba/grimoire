# Write your first spell

This tutorial builds a minimal spell and compiles it.

## 1) Create a new spell

Create `spells/hello-world.spell`:

```spell
spell HelloWorld

  version: "1.0.0"
  description: "Simple compute + emit"

  params:
    x: 1
    y: 2

  on manual:
    sum = params.x + params.y
    emit done(sum=sum)
```

## 2) Compile the spell

```bash
bun -e "import { compileFile } from './packages/core/src/compiler/index.ts'; const res = await compileFile('spells/hello-world.spell'); console.log(res.success, res.errors);"
```

## 3) Execute in simulation mode

```bash
bun -e "import { compileFile, execute } from './packages/core/src/index.ts'; const res = await compileFile('spells/hello-world.spell'); if (res.success) { const exec = await execute({ spell: res.ir, vault: '0x0000000000000000000000000000000000000000', chain: 1, executionMode: 'simulate' }); console.log(exec.success); }"
```

## Next steps

- Learn spell execution with adapters: [execute-with-venues.md](execute-with-venues.md)
- Look up syntax details: [reference/spell-syntax.md](../reference/spell-syntax.md)
