# Approval and multi-transaction flows

Many venues require ERC20 approvals. Grimoire handles this in adapters, not core.

## Pattern

1) Check allowance
2) Build approval tx if needed
3) Build action tx
4) Return `[approval, action]`

## Example (Uniswap)

Uniswap V3 adapter checks allowance and inserts an approval transaction before the swap.

## Example (Morpho Blue)

Morpho Blue adapter includes approval for `lend` and `repay` actions.

## Why in adapters

Keeping approval logic in adapters avoids protocol assumptions in core and supports protocol-specific approval patterns.
