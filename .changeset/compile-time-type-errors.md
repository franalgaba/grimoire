---
"@grimoirelabs/core": minor
---

Add compile-time type errors and conversion builtins (SPEC-003 Phase 2). Type checker now produces errors that block compilation instead of warnings. Added `to_number()` and `to_bigint()` conversion builtins so spells can explicitly handle the bigint/number boundary — the common DeFi pattern `to_number(balance(X)) * price(X, Y)` is now well-typed. Updated 8 fixture `.spell` files with explicit `to_number()` calls where `balance()` results are used in arithmetic with `number` values.
