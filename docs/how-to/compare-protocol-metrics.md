# How To Compare Protocol Metrics Across Venues

Use this guide to compare yields, quote outputs, and offchain prices directly in spells.

## 1. Choose the Metric Surface

Grimoire supports:

- `apy(venue, asset[, selector])`
- `metric(surface, venue[, asset[, selector]])`

Selector format is `k=v` pairs separated by commas (or `;`).

Examples:

- `asset_out=WETH,amount=1000000,fee_tier=3000`
- `to_chain=8453,amount=1000000`
- `token_id=<clobTokenId>`

## 2. Compare Lending APY (Aave vs Morpho)

```spell
spell LendingCompare {
  assets: [USDC]
  params: {
    morpho_market: "wbtc-usdc-1"
  }
  venues: {
    aave: @aave_v3
    morpho: @morpho_blue
  }
  on manual: {
    aave_apy = apy(aave, USDC)
    morpho_apy = apy(morpho, USDC, params.morpho_market)
    edge = morpho_apy - aave_apy
    emit lending_compare_done(aave_apy=aave_apy, morpho_apy=morpho_apy, edge=edge)
  }
}
```

### Compare Morpho vault APY surfaces

Use `apy(morpho, asset[, selector])` for Morpho Blue market APY comparisons.
Use `metric("vault_apy", morpho, asset, selector)` or `metric("vault_net_apy", morpho, asset, selector)` for MetaMorpho vault comparisons.

```spell
spell MorphoVaultCompare {
  assets: [USDC]
  params: {
    vault_a: "vault=0xVaultAddressA"
    vault_b: "vault=0xVaultAddressB"
  }
  venues: {
    morpho: @morpho_blue
  }
  on manual: {
    vault_a_net = metric("vault_net_apy", morpho, USDC, params.vault_a)
    vault_b_net = metric("vault_net_apy", morpho, USDC, params.vault_b)
    edge = vault_a_net - vault_b_net
    emit morpho_vault_compare_done(vault_a_net=vault_a_net, vault_b_net=vault_b_net, edge=edge)
  }
}
```

`vault_apy` / `vault_net_apy` require explicit vault selector (for example `vault=0x...`).

## 3. Compare Quote Output Surfaces (DEX + Bridge)

```spell
spell DexBridgeCompare {
  assets: [USDC, WETH, DAI]
  venues: {
    uni_v3: @uniswap_v3
    uni_v4: @uniswap_v4
    pendle: @pendle
    across: @across
  }
  on manual: {
    v3_out = metric("quote_out", uni_v3, USDC, "asset_out=WETH,amount=1000000,fee_tier=3000")
    v4_out = metric("quote_out", uni_v4, USDC, "asset_out=WETH,amount=1000000,fee_tier=3000")
    pendle_out = metric("quote_out", pendle, USDC, "asset_out=DAI,amount=1000000,slippage_bps=1000")
    across_out = metric("quote_out", across, USDC, "to_chain=8453,amount=1000000")
    emit dex_bridge_compare_done(v3_out=v3_out, v4_out=v4_out, pendle_out=pendle_out, across_out=across_out)
  }
}
```

## 4. Compare Offchain Mid Prices

```spell
spell OffchainCompare {
  assets: [ETH, USDC]
  params: {
    poly_selector: "token_id=<clobTokenId>"
  }
  venues: {
    hyperliquid: @hyperliquid
    polymarket: @polymarket
  }
  on manual: {
    hl_mid = metric("mid_price", hyperliquid, ETH)
    poly_mid = metric("mid_price", polymarket, USDC, params.poly_selector)
    emit offchain_compare_done(hl_mid=hl_mid, poly_mid=poly_mid)
  }
}
```

## 5. Validate and Simulate

```bash
grimoire validate spells/your-compare.spell
grimoire simulate spells/your-compare.spell --chain 1 --rpc-url <rpc-url>
```

If your comparison includes Polymarket, run on Polygon (`--chain 137`) and provide a valid CLOB token id.

## 6. Read the Comparison Results

Use run history and ledger events:

```bash
grimoire history <spell-id>
grimoire log <spell-id> <run-id>
```

Look for `event_emitted` payloads such as `lending_compare_done`, `dex_bridge_compare_done`, or `offchain_compare_done`.

## Troubleshooting

- `Venue 'morpho_blue' does not expose metric surface 'vault_net_apy'`:
  - The spell syntax is valid, but the runtime likely loaded stale packages or a custom adapter set that does not include the newer Morpho vault metric surfaces. Upgrade to a build that includes `@grimoirelabs/venues` `0.12.0+` and `@grimoirelabs/core` `0.20.0+`, or use the repo-local CLI/runtime.
- `Function 'metric' argument 'asset' expects asset, got string`:
  - The 3rd argument must be an asset symbol/address, not a free-form string. Put free-form values in `selector`.
- `Pendle ... swap aggregator failed`:
  - Try a different `asset_out`, amount, or higher `slippage_bps`.
- `Polymarket midpoint unavailable`:
  - Ensure `token_id` is a valid active CLOB token id with an orderbook.
- `Adapter 'hyperliquid' does not support chain ...`:
  - Hyperliquid action execution uses chains `0` or `999`. Metric reads can still be done in comparison spells.
