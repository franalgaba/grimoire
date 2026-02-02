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

## Minimum bridge amounts

Across enforces per-token minimum bridge amounts to cover relayer fees. Amounts below these thresholds will fail with "Sent amount is too low relative to fees":

| Token | Minimum | Raw (6 decimals) |
|-------|---------|-------------------|
| USDC | ~$1.00 | 1000000 |
| WETH | ~0.002 ETH | 2000000000000000 |

These are approximate and vary by route and network conditions. When in doubt, use larger amounts.

## See also

- [Action constraints](../reference/action-constraints.md)
- [Venue adapters](../reference/venues.md)
