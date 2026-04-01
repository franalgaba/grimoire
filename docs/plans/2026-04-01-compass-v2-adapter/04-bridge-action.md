# Task 04: Implement Bridge Action

## What to Build

Implement the CCTP bridge action and the two-phase bridge lifecycle (burn on source chain → mint on destination chain).

## Steps

1. Implement `handleBridge(action, ctx, sdk)`:
   - Map `BridgeAction` to CCTP burn:
     - `action.asset` → validated as USDC (CCTP only supports USDC)
     - `action.amount` → `amount`
     - `ctx.chainId` → `chain` (source)
     - `action.toChain` → `destination_chain`
   - Call `sdk.bridge.cctpBurn()`
   - Extract unsigned transaction and `bridge_id` from response
   - Return `BuiltTransaction` with bridge metadata

2. Implement `resolveHandoffStatus(input)`:
   - Use `sdk.bridge.cctpMint()` or status polling to check bridge completion
   - Map response status to Grimoire lifecycle states:
     - Attestation pending → `"pending"`
     - Attestation ready / minted → `"settled"`
     - Error → `"failed"`
   - Return `BridgeLifecycleStatusResult`

3. Wire `bridgeLifecycle` and `resolveHandoffStatus` into the adapter

## Acceptance Criteria

- [ ] `bridge` action calls `cctpBurn` with correct params
- [ ] Throws if asset is not USDC (CCTP limitation)
- [ ] Bridge ID is included in metadata
- [ ] `resolveHandoffStatus` correctly polls mint status
- [ ] Lifecycle transitions: pending → settled/failed

## Files to Modify

- `packages/venues/src/adapters/compass-v2.ts`

## Dependencies

- Task 01 (scaffold)
- Tasks 02, 03 are NOT dependencies — can be done in parallel
