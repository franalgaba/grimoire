# Task 01: Install SDK & Scaffold Adapter

## What to Build

Set up the foundation: install the `@compass-labs/api-sdk` dependency and create the adapter file with factory pattern, meta declaration, chain mapping, config types, and account management helpers.

## Steps

1. Add `@compass-labs/api-sdk` to `packages/venues/package.json` dependencies
2. Run `bun install` to fetch the SDK
3. Create `packages/venues/src/adapters/compass-v2.ts` with:

### Core scaffold
- `CompassV2AdapterConfig` interface (apiKey, sdk, supportedChains, gasSponsorship, privateKey)
- `createCompassV2Adapter(config)` factory function
- `compassV2Adapter` default singleton
- `VenueAdapterMeta` declaration
- Stub `buildAction` that throws "not yet implemented" per action type
- Stub `executeAction` that throws "not yet implemented" (for Traditional Investing)

### Chain mapping
- `COMPASS_CHAIN_MAP`: `{ 1: "ethereum", 8453: "base", 42161: "arbitrum" }`
- `resolveCompassChain(chainId: number)` helper — throws if unsupported

### Account management
- `CompassAccountCache` — simple Map keyed by `"${walletAddress}:${chainId}:${product}"` storing boolean (account exists)
- `ensureAccount(product: "earn" | "credit", ctx, sdk)` — checks cache, queries API if unknown, returns `BuiltTransaction | null` for account creation
- Product type inference: `getProductType(action)` — maps action types to "earn" or "credit"
- `tiSetupCache` — simple Map keyed by `"${walletAddress}:${chainId}"` storing boolean (TI setup complete)
- `ensureTradFiSetup(ctx)` — enables unified account + approves builder fee on first call, cached thereafter

## Acceptance Criteria

- [ ] `@compass-labs/api-sdk` is installed and importable
- [ ] `createCompassV2Adapter()` returns a valid `VenueAdapter`
- [ ] `compassV2Adapter` singleton exists with `COMPASS_API_KEY` env var
- [ ] `meta.name` is `"compass_v2"`
- [ ] `meta.supportedChains` is `[1, 8453, 42161]`
- [ ] `meta.actions` lists: `["lend", "withdraw", "swap", "transfer", "supply_collateral", "withdraw_collateral", "borrow", "repay", "bridge", "custom"]`
- [ ] `meta.requiredEnv` includes `"COMPASS_API_KEY"`
- [ ] Chain mapping correctly converts chain IDs to Compass API strings
- [ ] Account cache and ensureAccount helper are implemented
- [ ] TI setup cache and ensureTradFiSetup helper are implemented
- [ ] `privateKey` is accepted in `CompassV2AdapterConfig`
- [ ] Stub `executeAction` exists (throws "not yet implemented")

## Files to Modify

- `packages/venues/package.json` — add dependency
- `packages/venues/src/adapters/compass-v2.ts` — new file

## Dependencies

None — this is the first task.
