# How To Use Wallet Commands End To End

Use this guide to run the full wallet workflow with Grimoire CLI.

## Outcome

After this guide, you can:

- create or import a keystore
- resolve wallet address and balance
- wrap and unwrap ETH and WETH
- use the same wallet for `cast --dry-run` and live `cast`

## 1. Set Shared Variables

```bash
export KEYSTORE=.grimoire/dev/keystore.json
export KEYSTORE_PASSWORD=dev-only-password
export RPC_URL=http://127.0.0.1:8545
export CHAIN=1
```

## 2. Create Or Import Wallet

Generate a new wallet:

```bash
grimoire wallet generate \
  --keystore "$KEYSTORE" \
  --password-env KEYSTORE_PASSWORD
```

Or import an existing private key:

```bash
export PRIVATE_KEY=0x...

grimoire wallet import \
  --key-env PRIVATE_KEY \
  --keystore "$KEYSTORE" \
  --password-env KEYSTORE_PASSWORD
```

## 3. Check Address And Balance

```bash
grimoire wallet address \
  --keystore "$KEYSTORE" \
  --password-env KEYSTORE_PASSWORD

grimoire wallet balance \
  --chain "$CHAIN" \
  --rpc-url "$RPC_URL" \
  --keystore "$KEYSTORE" \
  --password-env KEYSTORE_PASSWORD
```

## 4. Wrap And Unwrap ETH

Wrap:

```bash
grimoire wallet wrap \
  --amount 0.01 \
  --chain "$CHAIN" \
  --rpc-url "$RPC_URL" \
  --keystore "$KEYSTORE" \
  --password-env KEYSTORE_PASSWORD
```

Unwrap:

```bash
grimoire wallet unwrap \
  --amount 0.01 \
  --chain "$CHAIN" \
  --rpc-url "$RPC_URL" \
  --keystore "$KEYSTORE" \
  --password-env KEYSTORE_PASSWORD
```

Notes:

- `wrap` and `unwrap` require ETH-native chains.
- Default chain for wrap and unwrap is `8453`; pass `--chain` explicitly when needed.

## 5. Run Dry-Run And Live Cast With Same Wallet

Dry-run:

```bash
grimoire cast spells/uniswap-swap-execute.spell \
  --dry-run \
  --chain "$CHAIN" \
  --rpc-url "$RPC_URL" \
  --keystore "$KEYSTORE" \
  --password-env KEYSTORE_PASSWORD
```

Live execution:

```bash
grimoire cast spells/uniswap-swap-execute.spell \
  --chain "$CHAIN" \
  --rpc-url "$RPC_URL" \
  --keystore "$KEYSTORE" \
  --password-env KEYSTORE_PASSWORD
```

## 6. Optional JSON Output For Automation

Most wallet subcommands support `--json`, for example:

```bash
grimoire wallet balance \
  --chain "$CHAIN" \
  --rpc-url "$RPC_URL" \
  --keystore "$KEYSTORE" \
  --password-env KEYSTORE_PASSWORD \
  --json
```

## Troubleshooting

- `Keystore not found`
  - generate or import wallet first, or fix `--keystore` path
- `No password available`
  - set `KEYSTORE_PASSWORD` or pass `--password-env <name>`
- `WETH only exists on ETH-native chains`
  - switch to an ETH-native chain (`1`, `8453`, `10`, `42161`)
