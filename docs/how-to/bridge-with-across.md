# Bridge with Across

Across bridges use the `bridge` action and the Across adapter in `@grimoire/venues`.

## 1) Configure assets and integrator ID

Across requires token mappings per chain and an integrator ID.

```ts
import { createAcrossAdapter } from "@grimoire/venues";

const across = createAcrossAdapter({
  integratorId: "0x0000",
  assets: {
    USDC: {
      1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      10: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    },
  },
});
```

## 2) Use the bridge action in a spell

`to_chain` can be a literal or an expression (params/state), but it must resolve to a numeric chain id at runtime.

```spell
spell AcrossBridge

  version: "1.0.0"

  assets: [USDC]

  params:
    amount: 100000000
    destination_chain: 10

  venues:
    across: @across

  on manual:
    across.bridge(USDC, params.amount, params.destination_chain)
    emit bridge_submitted(asset=USDC, amount=params.amount, to_chain=params.destination_chain)
```

## 3) Execute with adapters

```ts
import { execute } from "@grimoire/core";
import { createAcrossAdapter } from "@grimoire/venues";

await execute({
  spell,
  vault,
  chain: 1,
  executionMode: "execute",
  adapters: [createAcrossAdapter({ integratorId: "0x0000", assets: { /* ... */ } })],
});
```

## See also

- [Action constraints](../reference/action-constraints.md)
- [Venue adapters](../reference/venues.md)
