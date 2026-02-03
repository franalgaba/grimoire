# Publish packages (initial release)

Grimoire uses Changesets for ongoing releases. The initial `0.1.0` publish is done manually.

## Prerequisites

- npm account with access to the `@grimoire` scope
- Node + npm available locally

## Manual publish (one-time)

```bash
# Install deps and build packages
bun install
bun run build

# Publish in dependency order
cd packages/core
npm publish --access public --provenance

cd ../venues
npm publish --access public --provenance

cd ../cli
npm publish --access public --provenance
```

## After the initial release

Use Changesets + CI for future versions:

```bash
bunx changeset
```

Push the changes to `main`. The release workflow publishes with provenance via npm trusted publishing.
