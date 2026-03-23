---
"@grimoirelabs/core": patch
"@grimoirelabs/cli": patch
"@grimoirelabs/venues": patch
---

Upgrade all package dependencies to latest versions

Core: ethers ^6.16.0, viem ^2.47.6, yaml ^2.8.3, zod ^4.3.6, typescript ^5.9.3

CLI: incur ^0.3.8, chalk ^5.6.2, ora ^9.3.0, viem ^2.47.6, pi-coding-agent 0.62.0, typescript ^5.9.3
- Fix `AuthStorage` constructor change: `new AuthStorage(path)` → `AuthStorage.create(path)`

Venues: viem ^2.47.6, incur ^0.3.8, @aave/client ^0.9.2, @across-protocol/app-sdk ^0.5.0,
@morpho-org/blue-sdk ^5.20.0, @morpho-org/blue-sdk-viem ^4.6.0, @nktkas/hyperliquid ^0.32.1,
@polymarket/clob-client 5.8.0, @uniswap/default-token-list ^18.10.0, @uniswap/sdk-core ^7.12.2,
@uniswap/v3-sdk 3.29.1, @ethersproject/wallet 5.8.0
- Remove `"LiquidationMarket"` from Hyperliquid order TIF type (dropped in SDK 0.32.1)
- Pin @uniswap/v3-sdk to 3.29.1 (3.29.2 uses workspace:* for sdk-core, breaks external installs)
