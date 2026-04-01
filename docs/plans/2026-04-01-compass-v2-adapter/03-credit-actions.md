# Task 03: Implement Credit Actions

## What to Build

Implement the Credit product actions: `supply_collateral`, `withdraw_collateral`, `borrow`, and `repay`. These route to `sdk.credit.*` methods and operate through the user's Credit Account.

## Account Flow

Every Credit action requires a Credit Account. Before executing:

1. Check if Credit Account exists for `(owner, chain)` — use cached state or query `sdk.credit.creditPositions()` (a 404/empty response means no account)
2. If no account exists, prepend a `create_account` transaction via `sdk.credit.creditCreateAccount()`

## Granular Actions (via credit/transfer)

These give spell authors fine-grained control:

### `supply_collateral` → `POST /v2/credit/transfer` (DEPOSIT)
- Moves tokens from EOA into Credit Account
- Maps: `action.asset` → `token`, `action.amount` → `amount`, action="DEPOSIT"

### `withdraw_collateral` → `POST /v2/credit/transfer` (WITHDRAW)
- Moves tokens from Credit Account back to EOA
- Maps: `action.asset` → `token`, `action.amount` → `amount`, action="WITHDRAW"

## Combined Actions (bundled API calls)

These leverage the Compass API's built-in bundling:

### `borrow` → `POST /v2/credit/borrow`
The API bundles: optional swap + collateral supply + borrow into one transaction.

Maps from Grimoire `BorrowAction`:
- `action.asset` → `borrow_token`
- `action.amount` → `borrow_amount`
- `action.collateral` → `collateral_token` AND `token_in` (if no swap needed)
- If the user has a different source token, use custom action args for `token_in`/`amount_in`
- `interest_rate_mode` → default `"VARIABLE"` (Aave V3 deprecated stable)
- Slippage from `action.constraints.maxSlippageBps` (for collateral swap if token_in ≠ collateral_token)

### `repay` → `POST /v2/credit/repay`
The API bundles: repay + collateral withdrawal + optional swap into one transaction.

Maps from Grimoire `RepayAction`:
- `action.asset` → `repay_token`
- `action.amount` → `repay_amount`
- `interest_rate_mode` → default `"VARIABLE"`
- `withdraw_token` / `withdraw_amount` → from custom args or default to 0

## Steps

1. Implement `handleCreditTransfer(action, ctx, sdk)` for supply_collateral/withdraw_collateral
2. Implement `handleCreditBorrow(action, ctx, sdk)` for the combined borrow flow
3. Implement `handleCreditRepay(action, ctx, sdk)` for the combined repay flow
4. Add Credit Account auto-creation logic
5. Wire into `buildAction()` switch

## Acceptance Criteria

- [ ] `supply_collateral` calls `creditTransfer` with DEPOSIT
- [ ] `withdraw_collateral` calls `creditTransfer` with WITHDRAW
- [ ] `borrow` calls `creditBorrow` with correct collateral + borrow token mapping
- [ ] `repay` calls `creditRepay` with correct params
- [ ] Interest rate mode defaults to VARIABLE
- [ ] Slippage is correctly passed for collateral swaps
- [ ] Credit Account is auto-created if it doesn't exist (prepended tx)
- [ ] Unsigned transactions are extracted from SDK responses

## Files to Modify

- `packages/venues/src/adapters/compass-v2.ts`

## Dependencies

- Task 01 (scaffold)
- Task 02 is NOT a dependency — can be done in parallel
