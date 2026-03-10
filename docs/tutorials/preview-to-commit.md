# Tutorial: Preview to Commit Flow

This tutorial shows how `cast` uses the preview/commit model for irreversible actions.

Prerequisite: complete `docs/tutorials/quickstart-users-and-agents.md`.

## Goal

Run a spell through:

1. preview (`simulate`/receipt)
2. dry-run cast
3. live cast commit

## 1. Pick a Spell With Actions

Use an existing example, e.g.:

- `spells/uniswap-swap-execute.spell`

## 2. Validate

```bash
grimoire validate spells/uniswap-swap-execute.spell
```

## 3. Preview With `simulate`

```bash
grimoire simulate spells/uniswap-swap-execute.spell --chain 1
```

What happens:

- runtime executes all logic in preview mode
- action steps become planned actions in receipt
- receipt status is `ready` or `rejected`

## 4. Dry-Run Cast

```bash
grimoire cast spells/uniswap-swap-execute.spell \
  --dry-run \
  --chain 1 \
  --key-env PRIVATE_KEY \
  --rpc-url <rpc>
```

Dry-run still performs preview but skips irreversible submission.

## 5. Live Cast Commit

```bash
grimoire cast spells/uniswap-swap-execute.spell \
  --chain 1 \
  --key-env PRIVATE_KEY \
  --rpc-url <rpc>
```

Live mode does:

- preview
- commit planned actions if preview receipt is `ready`

## 6. Review Results

```bash
grimoire history <spell-id>
grimoire log <spell-id> <run-id>
```

Look for:

- preview lifecycle events
- action submission/confirmation events
- commit status

## Alternative: Client-Side Signing With `buildTransactions()`

When the signer is not available server-side (browser wallets, Privy SDK, multisig), use the `buildTransactions()` API instead of `commit()`.

### Flow

```ts
import { compile, preview, buildTransactions, signReceipt } from "@grimoirelabs/core";
import { adapters } from "@grimoirelabs/venues";

// 1. Compile and preview (server-side)
const compiled = compile(sourceText);
const previewResult = await preview({
  spell: compiled.ir,
  vault: vaultAddress,
  chain: 1,
  adapters,
});

const receipt = previewResult.receipt;

// 2. Sign the receipt for cross-process integrity
const integrity = signReceipt(receipt, process.env.RECEIPT_SECRET);
// Persist receipt + integrity, send to client

// 3. Build unsigned transactions (can be same or different process)
const buildResult = await buildTransactions({
  receipt,
  walletAddress: signerAddress,
  adapters,
  receiptSecret: process.env.RECEIPT_SECRET,
  receiptIntegrity: integrity,
});

// 4. Sign and broadcast each transaction client-side
for (const step of buildResult.transactions) {
  for (const builtTx of step.builtTransactions) {
    await wallet.sendTransaction(builtTx.tx);
  }
}
```

### When to use `buildTransactions()` vs `commit()`

| Scenario | Use |
|---|---|
| Server holds private key | `commit()` |
| Browser wallet / Privy SDK | `buildTransactions()` |
| Multisig proposal builder | `buildTransactions()` |
| Offchain-only venues (Hyperliquid, Polymarket) | `commit()` (offchain adapters have no signable calldata) |

### Cross-process receipts

When preview and build happen in different processes or requests, use `signReceipt()` at preview time and pass `receiptSecret` + `receiptIntegrity` to `buildTransactions()`. Without this, cross-process receipts are rejected to prevent tampering.

## Notes

- If no key is available, `cast` falls back to simulation mode.
- If a spell has no irreversible actions, commit phase is skipped.
