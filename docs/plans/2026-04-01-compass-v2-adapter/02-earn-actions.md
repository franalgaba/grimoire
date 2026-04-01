# Task 02: Implement Earn Actions

## What to Build

Implement the Earn product actions: `lend`, `withdraw`, `swap`, and `transfer`. These route to `sdk.earn.*` methods and operate through the user's Earn Account.

## Account Flow

Every Earn action requires an Earn Account. Before executing:

1. Check if Earn Account exists for `(owner, chain)` — use cached state or query `sdk.earn.earnBalances()` (a 404/empty response means no account)
2. If no account exists, prepend a `create_account` transaction via `sdk.earn.earnCreateAccount()`
3. For deposit flows (`lend`), also prepend a `transfer` (EOA → Earn Account) if the tokens aren't already in the account

## Steps

1. Implement `handleEarnManage(action, ctx, sdk)` for lend/withdraw:
   - Map `lend` → `{ action: "DEPOSIT" }` and `withdraw` → `{ action: "WITHDRAW" }`
   - Determine venue type from action context:
     - If `action.vault` is set → `{ type: "VAULT", vault_address: action.vault }`
     - Default → `{ type: "AAVE" }`
   - Call `sdk.earn.earnManage()` with owner=ctx.walletAddress, chain=resolveCompassChain(ctx.chainId)
   - Extract unsigned transaction from response
   - Return as `BuiltTransaction`

2. Implement `handleEarnSwap(action, ctx, sdk)`:
   - Map `assetIn` → `token_in`, `assetOut` → `token_out`, `amount` → `amount_in`
   - Extract slippage from `action.constraints.maxSlippageBps` (convert bps to percentage)
   - Call `sdk.earn.earnSwap()`

3. Implement `handleEarnTransfer(action, ctx, sdk)`:
   - Map to `sdk.earn.earnTransfer()` with token, amount, action (DEPOSIT/WITHDRAW)
   - DEPOSIT = EOA → Earn Account, WITHDRAW = Earn Account → EOA

4. Wire all handlers into `buildAction()` via action type switch

## Acceptance Criteria

- [ ] `lend` calls `earnManage` with DEPOSIT and correct venue type
- [ ] `withdraw` calls `earnManage` with WITHDRAW
- [ ] `swap` calls `earnSwap` with correct token mapping
- [ ] `transfer` calls `earnTransfer` with correct direction
- [ ] Earn Account is auto-created if it doesn't exist (prepended tx)
- [ ] Slippage is converted from basis points to percentage
- [ ] Amount is converted properly (bigint → string)
- [ ] Chain ID is converted to Compass chain name

## Files to Modify

- `packages/venues/src/adapters/compass-v2.ts`

## Dependencies

- Task 01 (scaffold must exist)
