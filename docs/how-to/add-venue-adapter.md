# Add a new venue adapter

Venue adapters live in `@grimoire/venues`, keeping core protocol-agnostic.

## 1) Create the adapter file

Create `packages/venues/src/<venue>.ts`:

```ts
import type { VenueAdapter } from "@grimoire/core";

export function createMyAdapter(): VenueAdapter {
  return {
    meta: {
      name: "my_venue",
      supportedChains: [1],
      actions: ["swap"],
      description: "My venue adapter",
    },
    async buildAction(action, ctx) {
      // build transactions here
      return {
        tx: { to: "0x...", data: "0x", value: 0n },
        description: "My venue swap",
        action,
      };
    },
  };
}
```

## 2) Export it

Edit `packages/venues/src/index.ts` and add your adapter to the `adapters` array and exports.

## 3) Write tests

Add `packages/venues/src/<venue>.test.ts` to cover:

- happy path
- approval path (if ERC20 approvals required)
- unsupported action errors

## 4) Update docs

Add a reference entry in [reference/venues.md](../reference/venues.md).

## See also

- [Venue adapter model](../explanation/venue-adapters.md)
- [Approval flows](../explanation/approval-flows.md)
