# How To Add a Venue

This guide covers two paths for contributing a new venue adapter to Grimoire:

- **In-repo**: add files inside the monorepo (for core contributors)
- **External package**: publish an npm package (for third-party contributors)

Both paths use the same `VenueManifest` contract for discovery. Once wired, `grimoire venue <name>` and `grimoire venues` pick up the new venue automatically.

## Prerequisites

- Familiarity with the `VenueAdapter` interface (see `docs/reference/venues.md`)
- For in-repo: local clone with `bun install` and `bun run build` passing
- For external: an npm-publishable package

---

## Path A: In-Repo Venue

### 1. Create the Adapter

Create `packages/venues/src/adapters/my-venue.ts`:

```ts
import type { VenueAdapter } from "@grimoirelabs/core";

export const myVenueAdapter: VenueAdapter = {
  meta: {
    name: "my_venue",
    supportedChains: [1, 8453],
    actions: ["swap"],
    supportedConstraints: ["max_slippage"],
    executionType: "evm",
    description: "My venue adapter",
  },
  async buildAction(action, ctx) {
    // Build and return BuiltTransaction(s)
    throw new Error("Not implemented");
  },
};
```

The `meta` object drives CLI listing, constraint validation, and doctor checks. Fill in every field that applies.

### 2. Register in the Adapter Bundle

Add your adapter to the `adapters` array in `packages/venues/src/index.ts`:

```ts
import { myVenueAdapter } from "./adapters/my-venue.js";

export const adapters: VenueAdapter[] = [
  // ... existing adapters
  myVenueAdapter,
];
```

Also add the named export so consumers can import it directly.

### 3. Create the CLI

Create `packages/venues/src/cli/my-venue.ts`. Use [`incur`](https://github.com/grimoirelabs/incur) to define commands:

```ts
import Cli from "incur";

const cli = Cli.create("grimoire-my-venue", "My Venue CLI");

cli.command("info", "Show venue info", {}, () => {
  console.log(JSON.stringify({ name: "my_venue", chains: [1, 8453] }, null, 2));
});

cli.serve();
```

### 4. Update Discovery Aliases (Optional)

If your venue needs aliases (e.g. `grimoire venue mv` should resolve to `my-venue`), add an entry to `BUILTIN_ALIAS_MAP` in `packages/venues/src/discovery.ts`:

```ts
const BUILTIN_ALIAS_MAP: Record<string, string[]> = {
  // ... existing entries
  "my-venue": ["mv"],
};
```

Also add the CLI-to-adapter mapping in `CLI_TO_ADAPTER_MAP`:

```ts
const CLI_TO_ADAPTER_MAP: Record<string, string[]> = {
  // ... existing entries
  "my-venue": ["my-venue"],
};
```

### 5. Verify

```bash
bun run build
bun test
grimoire venues              # should list my_venue
grimoire venue my-venue info # should run the CLI
grimoire venue doctor        # should include my_venue in checks
```

---

## Path B: External npm Package

External packages are auto-discovered when installed in a project that uses `@grimoirelabs/cli`.

### 1. Create the Package

```bash
mkdir grimoire-venue-gmx
cd grimoire-venue-gmx
npm init -y
```

### 2. Add the Grimoire Manifest

In `package.json`, add a `"grimoire"` field:

```json
{
  "name": "grimoire-venue-gmx",
  "version": "1.0.0",
  "grimoire": {
    "type": "venue",
    "name": "gmx",
    "aliases": ["gmx-v2"],
    "cli": "./dist/cli.js",
    "adapter": "./dist/adapter.js"
  }
}
```

Fields:

| Field | Required | Description |
|-------|----------|-------------|
| `type` | yes | Must be `"venue"` |
| `name` | no | Canonical name (defaults to package name minus `grimoire-venue-` prefix) |
| `aliases` | no | Alternative names for `grimoire venue <alias>` |
| `cli` | yes | Relative path to CLI entry point |
| `adapter` | no | Relative path to adapter module (default or named `adapter` export) |

### 3. Implement the Adapter

Export a `VenueAdapter` as the default export from your adapter module:

```ts
// src/adapter.ts
import type { VenueAdapter } from "@grimoirelabs/core";

const gmxAdapter: VenueAdapter = {
  meta: {
    name: "gmx",
    supportedChains: [42161],
    actions: ["swap"],
    supportedConstraints: ["max_slippage"],
    executionType: "evm",
    description: "GMX perpetuals adapter",
  },
  async buildAction(action, ctx) {
    // ...
  },
};

export default gmxAdapter;
```

### 4. Implement the CLI

Create a CLI entry point that the Grimoire CLI will spawn as a subprocess:

```ts
// src/cli.ts
import Cli from "incur";

const cli = Cli.create("grimoire-gmx", "GMX Venue CLI");

cli.command("markets", "List GMX markets", {}, async () => {
  // Fetch and display market data
});

cli.serve();
```

### 5. Publish and Install

```bash
npm publish
```

Then in any Grimoire project:

```bash
npm install grimoire-venue-gmx
```

### 6. Verify

```bash
grimoire venues              # should list gmx
grimoire venue gmx markets   # should run the CLI
grimoire venue doctor        # should include gmx in checks
```

---

## Naming Conventions

| Convention | Example |
|------------|---------|
| npm package | `grimoire-venue-gmx` or `@myorg/grimoire-venue-gmx` |
| Adapter `meta.name` | `gmx` (snake_case for multi-word: `my_venue`) |
| CLI filename (in-repo) | `packages/venues/src/cli/gmx.ts` |
| Adapter filename (in-repo) | `packages/venues/src/adapters/gmx.ts` |

## Discovery Order

1. Built-in venues from `@grimoirelabs/venues` are discovered first
2. External `grimoire-venue-*` packages are scanned from `node_modules`
3. On name collision, the external package wins (allows overriding built-ins)

## Adapter Interface Quick Reference

```ts
interface VenueAdapter {
  meta: VenueAdapterMeta;
  buildAction?(action: Action, ctx: VenueAdapterContext): Promise<VenueBuildResult>;
  executeAction?(action: Action, ctx: VenueAdapterContext): Promise<OffchainExecutionResult>;
}
```

- `buildAction` — for EVM venues that produce transactions
- `executeAction` — for offchain venues (APIs, order books)
- Implement one or both depending on your venue's execution type

See `docs/reference/venues.md` for the full type definitions and constraint matrix.
