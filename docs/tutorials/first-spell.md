# Write your first spell

This tutorial builds a minimal spell and runs it in either VM mode or the deterministic runtime.

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

## 2) Run the spell

### VM mode (in-agent)

```
Run spells/hello-world.spell in the Grimoire VM with trigger manual. Use defaults and no side effects.
```

### Deterministic runtime (CLI)

```bash
grimoire simulate spells/hello-world.spell --chain 1
```

### Optional: programmatic (local)

If you want to run directly from source:

```bash
bun -e "import { compileFile, execute } from './packages/core/src/index.ts'; const res = await compileFile('spells/hello-world.spell'); if (res.success) { const exec = await execute({ spell: res.ir, vault: '0x0000000000000000000000000000000000000000', chain: 1, executionMode: 'simulate' }); console.log(exec.success); }"
```

## Next steps

- Learn spell execution with adapters: [execute-with-venues.md](execute-with-venues.md)
- Look up syntax details: [spell-syntax.md](../reference/spell-syntax.md)
