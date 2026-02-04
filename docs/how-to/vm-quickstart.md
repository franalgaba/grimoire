# VM quickstart (snapshot-driven)

This guide shows how to prototype a spell entirely inside the Grimoire VM using snapshot data.

## 1) Generate a snapshot

If you want a scaffold with a starter spell, run:

```bash
grimoire init --vm
```

Then open `.grimoire/spells/vm-quickstart/spell.spell`.

Use the venue CLI to pull a snapshot and emit VM-ready params:

```bash
npx -y @grimoirelabs/cli venue morpho-blue vaults --chain 8453 --asset USDC --min-tvl 5000000 --format spell
```

This prints a `params:` block you can paste into a spell.

## 2) Create a VM spell

Create a file `spells/vm-vault-snapshot.spell`:

```spell
spell VmVaultSnapshot

  description: "Compute a yield spread from a Morpho vault snapshot"

  params:
    snapshot_at: ""
    snapshot_source: ""
    vault_names: []
    vault_addresses: []
    vault_net_apys: []
    vault_tvl_usd: []

  on manual:
    best_apy = max(params.vault_net_apys)
    avg_apy = avg(params.vault_net_apys)
    spread = best_apy - avg_apy

    emit vault_snapshot_summary(
      snapshot_at=params.snapshot_at,
      best_apy=best_apy,
      avg_apy=avg_apy,
      spread=spread
    )
```

Replace the `params:` block with the snapshot you generated in step 1 (the output already includes `params:`).

## 3) Run in the VM

Using the Grimoire VM skill (agent session), ask:

```
Run spells/vm-vault-snapshot.spell in the Grimoire VM with trigger manual. Use defaults and no side effects.
```

The VM will emit a `vault_snapshot_summary` event with the computed spread.

## 4) Refresh data

When you want fresh inputs, rerun the snapshot command and replace the `params:` block again.
