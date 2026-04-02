# Task 07: Write Tests

## What to Build

Unit tests for the compass_v2 adapter, following existing test patterns (colocated `*.test.ts`, Bun test runner, SDK injection via factory config).

## Steps

1. Create `packages/venues/src/adapters/compass-v2.test.ts`

2. Test structure:
   - Create mock SDK object with mock functions for each namespace (earn, credit, bridge, traditionalInvesting)
   - Inject via `createCompassV2Adapter({ sdk: mockSdk, privateKey: "0x..." })`
   - Create minimal `VenueAdapterContext` with mock provider

3. Test cases:

   **Account auto-management:**
   - First action on a chain prepends `create_account` tx
   - Subsequent actions on same chain skip account creation (cached)
   - Earn actions create Earn Account, Credit actions create Credit Account
   - Account creation for different chains is independent

   **Earn actions:**
   - `lend` → calls `earnManage` with DEPOSIT + AAVE venue type
   - `lend` with vault address → calls `earnManage` with DEPOSIT + VAULT type
   - `withdraw` → calls `earnManage` with WITHDRAW
   - `swap` → calls `earnSwap` with correct token mapping and slippage conversion
   - `transfer` → calls `earnTransfer` with correct direction (DEPOSIT/WITHDRAW)

   **Credit actions:**
   - `supply_collateral` → calls `creditTransfer` with DEPOSIT
   - `withdraw_collateral` → calls `creditTransfer` with WITHDRAW
   - `borrow` → calls `creditBorrow` with correct collateral + borrow token mapping
   - `repay` → calls `creditRepay` with correct params
   - Interest rate mode defaults to VARIABLE

   **Bridge actions:**
   - `bridge` with USDC → calls `cctpBurn` with correct chain mapping
   - `bridge` with non-USDC → throws error

   **Traditional Investing (custom actions):**
   - `custom` action in `buildAction` → returns dummy preview tx (to: zeroAddress)
   - `ti_market_order` via `executeAction` → calls `traditionalInvestingMarketOrder`, returns result
   - `ti_limit_order` via `executeAction` → calls `traditionalInvestingLimitOrder`, returns result
   - First TI trade triggers auto-setup (enable_unified_account + approve_builder_fee)
   - Second TI trade skips setup (cached)
   - `ti_setup` explicitly triggers setup
   - `ti_set_leverage` calls `traditionalInvestingEnsureLeverage`
   - Missing `privateKey` in config → clear error in `executeAction`
   - Unknown TI op → descriptive error

   **Error cases:**
   - Unsupported chain ID → descriptive error
   - Unsupported action type → descriptive error
   - SDK error → propagated with context
   - Missing API key → clear error message

   **Meta validation:**
   - `meta.name` is `"compass_v2"`
   - `meta.supportedChains` contains expected chains
   - `meta.actions` lists all supported types (including `"custom"`)

4. Verify tests pass with `bun test packages/venues/src/adapters/compass-v2.test.ts`

## Acceptance Criteria

- [ ] Account auto-creation flow is tested (first call creates, second skips)
- [ ] All earn action types have at least one test
- [ ] All credit action types have at least one test (both granular and combined)
- [ ] Bridge action has happy path + error tests
- [ ] TI custom action routing in `buildAction` (dummy preview tx)
- [ ] TI `executeAction` per op (market order, limit order, etc.)
- [ ] TI auto-setup flow (first trade triggers, second skips)
- [ ] Missing `privateKey` error in `executeAction`
- [ ] Unknown TI op error
- [ ] Executor hybrid routing test (custom actions routed to `executeAction` on non-offchain adapters)
- [ ] Error cases are covered
- [ ] Meta is validated (includes `"custom"` in actions)
- [ ] All tests pass
- [ ] No real API calls — all SDK methods are mocked

## Files to Modify

- `packages/venues/src/adapters/compass-v2.test.ts` — new file

## Dependencies

- Task 01 (scaffold)
- Task 02 (earn implementation)
- Task 03 (credit implementation)
- Task 04 (bridge implementation)
- Task 08 (traditional investing — for TI test cases)
