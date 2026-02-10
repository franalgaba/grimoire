# How To Simulate Against A Forked Chain With Anvil

Use this guide to run Grimoire preview logic against a local Anvil fork with repeatable state.

## Outcome

After this guide, you can:

- fork a live EVM chain into local Anvil
- run Grimoire preview on forked state
- repeat runs at a pinned block with persisted Anvil state
- inspect run and ledger output before any live commit

## Prerequisites

- Grimoire CLI available as `grimoire` (or equivalent invocation)
- Foundry installed (`anvil` and `cast` available)
- RPC URL for the chain you want to fork

## Important Runtime Note

`grimoire simulate` does not currently expose `--rpc-url`.

For preview against a custom local RPC (Anvil), use:

- `grimoire cast --dry-run ... --rpc-url <anvil-url>`

`--dry-run` is still preview-only (no commit), but it accepts wallet and provider wiring.

## 1. Set Shared Variables

```bash
export FORK_RPC_URL=...
export CHAIN_ID=1
export ANVIL_RPC_URL=http://127.0.0.1:8545
export KEYSTORE=.grimoire/dev/keystore.json
export KEYSTORE_PASSWORD=dev-only-password
```

Use `CHAIN_ID=8453` for Base forks.

## 2. Start Anvil Fork

Baseline fork:

```bash
anvil \
  --fork-url "$FORK_RPC_URL" \
  --chain-id "$CHAIN_ID" \
  --host 127.0.0.1 \
  --port 8545
```

Recommended reproducible fork (pin block and persist state):

```bash
anvil \
  --fork-url "$FORK_RPC_URL" \
  --chain-id "$CHAIN_ID" \
  --fork-block-number 18000000 \
  --state .grimoire/anvil/state.json \
  --state-interval 60 \
  --host 127.0.0.1 \
  --port 8545
```

Useful optional flags:

- `--compute-units-per-second 100` when your provider enforces rate limits
- `--retries 10` for transient RPC errors
- `--no-rate-limit` when provider policy allows it
- `--fork-header "Authorization: Bearer <token>"` for authenticated endpoints
- `--auto-impersonate` for advanced local debugging workflows

## 3. Prepare Wallet From Anvil Funded Key

Copy a funded private key from Anvil startup output:

```bash
export PRIVATE_KEY=0x...
```

Import it into a local Grimoire keystore:

```bash
grimoire wallet import \
  --key-env PRIVATE_KEY \
  --keystore "$KEYSTORE" \
  --password-env KEYSTORE_PASSWORD
```

Verify wallet on the fork:

```bash
grimoire wallet address \
  --keystore "$KEYSTORE" \
  --password-env KEYSTORE_PASSWORD

grimoire wallet balance \
  --chain "$CHAIN_ID" \
  --rpc-url "$ANVIL_RPC_URL" \
  --keystore "$KEYSTORE" \
  --password-env KEYSTORE_PASSWORD
```

## 4. Validate Spell

```bash
grimoire validate spells/uniswap-swap-execute.spell
```

## 5. Run Forked Preview (Dry-Run)

```bash
grimoire cast spells/uniswap-swap-execute.spell \
  --dry-run \
  --chain "$CHAIN_ID" \
  --rpc-url "$ANVIL_RPC_URL" \
  --keystore "$KEYSTORE" \
  --password-env KEYSTORE_PASSWORD
```

This runs preview against forked state without submitting commits.

## 6. Inspect Results

```bash
grimoire history
grimoire history <spell-id>
grimoire log <spell-id> <run-id>
```

## 7. Optional Debug Controls During Local Testing

Time and mining control:

```bash
cast rpc evm_increaseTime 3600 --rpc-url "$ANVIL_RPC_URL"
cast rpc evm_mine --rpc-url "$ANVIL_RPC_URL"
```

Session snapshot and revert:

```bash
SNAP=$(cast rpc evm_snapshot --rpc-url "$ANVIL_RPC_URL")
cast rpc evm_revert "$SNAP" --rpc-url "$ANVIL_RPC_URL"
```

Account impersonation:

```bash
cast rpc anvil_impersonateAccount 0x... --rpc-url "$ANVIL_RPC_URL"
cast rpc anvil_stopImpersonatingAccount 0x... --rpc-url "$ANVIL_RPC_URL"
```

## Troubleshooting

- `No ... configured for chain ...`
  - align Grimoire `--chain` with Anvil `--chain-id`
- `No password available`
  - set `KEYSTORE_PASSWORD` and pass `--password-env KEYSTORE_PASSWORD`
- `No key provided and no keystore found`
  - import/generate a keystore and pass `--keystore`
- Preview appears to use public RPC instead of Anvil
  - use `cast --dry-run` with both `--rpc-url` and wallet options
- frequent RPC fetch failures while forking
  - tune Anvil with `--compute-units-per-second`, `--retries`, and provider headers

## Security Note

Default Anvil accounts and mnemonic are public knowledge. Use development-only keys and never reuse production secrets.
