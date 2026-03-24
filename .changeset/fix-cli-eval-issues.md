---
"@grimoirelabs/core": patch
"@grimoirelabs/venues": patch
---

Fix CLI issues identified by platform eval (30% → estimated 55%+ pass rate)

- **Expression parser**: Accept `.5` as `0.5` in inline expressions (matches main tokenizer behavior)
- **Uniswap V3**: Guard `min_output` slippage computation when pool returns zero quote — falls through to default slippage instead of throwing
- **Morpho Blue**: Add Ethereum mainnet default markets (cbBTC/USDC, WBTC/USDC, wstETH/WETH) so Morpho operations on chain 1 no longer fail with "market not configured"
- **Morpho Blue**: Resolve lend ambiguity when multiple markets share the same loan token — auto-selects first match with warning instead of throwing
- **Token registry**: Add wstETH to Ethereum SHARED_TOKENS (WBTC and cbBTC already covered by Uniswap default list)
