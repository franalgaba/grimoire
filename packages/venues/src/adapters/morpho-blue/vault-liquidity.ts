import type { Address, Provider } from "@grimoirelabs/core";
import type { Abi } from "viem";
import { decodeAbiParameters, encodeAbiParameters, getAddress, keccak256, zeroAddress } from "viem";
import { tryResolveTokenByAddress } from "../../shared/token-registry.js";

const MORPHO_VAULT_V2_ABI = [
  {
    inputs: [],
    name: "totalAssets",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "liquidityAdapter",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "liquidityData",
    outputs: [{ name: "", type: "bytes" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "asset",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "name",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
] as const satisfies Abi;

const ERC20_METADATA_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
] as const satisfies Abi;

const LIQUIDITY_ADAPTER_ABI = [
  {
    inputs: [],
    name: "realAssets",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "morpho",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "marketId", type: "bytes32" }],
    name: "expectedSupplyAssets",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const satisfies Abi;

const MARKET_PARAMS_ABI = [
  {
    type: "tuple",
    components: [
      { name: "loanToken", type: "address" },
      { name: "collateralToken", type: "address" },
      { name: "oracle", type: "address" },
      { name: "irm", type: "address" },
      { name: "lltv", type: "uint256" },
    ],
  },
] as const;

export interface VaultLiquidityProvider {
  readonly rpcUrl?: string;
  getBlockNumber(): Promise<bigint>;
  readContract<T>(params: {
    address: Address;
    abi: Abi;
    functionName: string;
    args?: readonly unknown[];
  }): Promise<T>;
}

export interface MorphoVaultV2Liquidity {
  chainId: number;
  vault: Address;
  vaultName: string;
  asset: {
    symbol: string;
    address: Address;
    decimals: number;
  };
  totalAssets: string;
  withdrawableLiquidityAssets: string;
  withdrawableLiquidityBps: number;
  thresholdReady: boolean;
  idleAssets: string;
  liquidityAdapter: Address;
  liquidityAdapterAssets: string;
  source: {
    kind: "onchain";
    blockNumber: number;
    rpcUrl: string;
  };
}

export interface ReadMorphoVaultV2LiquidityOptions {
  chainId: number;
  vault: string;
  provider: VaultLiquidityProvider | Provider;
  thresholdBps?: number;
}

export function toMorphoVaultV2LiquiditySpellParams(
  liquidity: MorphoVaultV2Liquidity,
  thresholdBps = 500,
  windowSeconds = 86_400
): Record<string, string | number> {
  return {
    protocol: "morpho-vault-v2",
    metric: "withdrawable_liquidity_bps",
    vault_name: liquidity.vaultName,
    vault_address: liquidity.vault,
    asset_symbol: liquidity.asset.symbol,
    asset_address: liquidity.asset.address,
    threshold_bps: thresholdBps,
    window_seconds: windowSeconds,
    withdrawable_liquidity_bps: liquidity.withdrawableLiquidityBps,
    withdrawable_liquidity_assets: liquidity.withdrawableLiquidityAssets,
    total_assets: liquidity.totalAssets,
    idle_assets: liquidity.idleAssets,
    liquidity_adapter: liquidity.liquidityAdapter,
    liquidity_adapter_assets: liquidity.liquidityAdapterAssets,
  };
}

export async function readMorphoVaultV2Liquidity(
  options: ReadMorphoVaultV2LiquidityOptions
): Promise<MorphoVaultV2Liquidity> {
  const vault = normalizeAddress(options.vault, "vault");
  const thresholdBps = options.thresholdBps ?? 500;
  const provider = options.provider;

  const [blockNumber, totalAssets, liquidityAdapterRaw, assetRaw, vaultName, liquidityData] =
    await Promise.all([
      provider.getBlockNumber(),
      provider.readContract<bigint>({
        address: vault,
        abi: MORPHO_VAULT_V2_ABI,
        functionName: "totalAssets",
      }),
      provider.readContract<Address>({
        address: vault,
        abi: MORPHO_VAULT_V2_ABI,
        functionName: "liquidityAdapter",
      }),
      provider.readContract<Address>({
        address: vault,
        abi: MORPHO_VAULT_V2_ABI,
        functionName: "asset",
      }),
      readOptionalString(provider, vault, MORPHO_VAULT_V2_ABI, "name", "unknown"),
      readOptionalBytes(provider, vault, MORPHO_VAULT_V2_ABI, "liquidityData"),
    ]);

  const assetAddress = normalizeAddress(assetRaw, "asset");
  const liquidityAdapter = normalizeAddress(liquidityAdapterRaw, "liquidityAdapter");
  const [idleAssets, assetMetadata, liquidityAdapterAssets] = await Promise.all([
    provider.readContract<bigint>({
      address: assetAddress,
      abi: ERC20_METADATA_ABI,
      functionName: "balanceOf",
      args: [vault],
    }),
    readAssetMetadata(provider, options.chainId, assetAddress),
    liquidityAdapter === zeroAddress
      ? Promise.resolve(0n)
      : readLiquidityAdapterWithdrawableAssets(
          provider,
          assetAddress,
          liquidityAdapter,
          liquidityData
        ),
  ]);

  const withdrawableLiquidityAssets = minBigint(totalAssets, idleAssets + liquidityAdapterAssets);
  const withdrawableLiquidityBps =
    totalAssets === 0n ? 0 : Number((withdrawableLiquidityAssets * 10_000n) / totalAssets);

  return {
    chainId: options.chainId,
    vault,
    vaultName,
    asset: {
      symbol: assetMetadata.symbol,
      address: assetAddress,
      decimals: assetMetadata.decimals,
    },
    totalAssets: totalAssets.toString(),
    withdrawableLiquidityAssets: withdrawableLiquidityAssets.toString(),
    withdrawableLiquidityBps,
    thresholdReady: withdrawableLiquidityBps >= thresholdBps,
    idleAssets: idleAssets.toString(),
    liquidityAdapter,
    liquidityAdapterAssets: liquidityAdapterAssets.toString(),
    source: {
      kind: "onchain",
      blockNumber: Number(blockNumber),
      rpcUrl: redactRpcUrl(provider.rpcUrl),
    },
  };
}

export function redactRpcUrl(rpcUrl?: string): string {
  if (!rpcUrl) return "redacted";

  try {
    const url = new URL(rpcUrl);
    url.username = url.username ? "redacted" : "";
    url.password = url.password ? "redacted" : "";

    const segments = url.pathname.split("/");
    const secretSegmentIndex = segments.findIndex(
      (segment) => segment === "v2" || segment === "key"
    );
    if (secretSegmentIndex >= 0 && segments[secretSegmentIndex + 1]) {
      segments[secretSegmentIndex + 1] = "redacted";
      url.pathname = segments.join("/");
    }

    for (const key of ["apiKey", "apikey", "key", "token"]) {
      if (url.searchParams.has(key)) url.searchParams.set(key, "redacted");
    }

    return url.toString();
  } catch {
    return "redacted";
  }
}

async function readAssetMetadata(
  provider: VaultLiquidityProvider | Provider,
  chainId: number,
  assetAddress: Address
): Promise<{ symbol: string; decimals: number }> {
  const known = tryResolveTokenByAddress(assetAddress, chainId);
  if (known) return { symbol: known.symbol, decimals: known.decimals };

  const [symbol, decimals] = await Promise.all([
    readOptionalString(provider, assetAddress, ERC20_METADATA_ABI, "symbol", assetAddress),
    provider.readContract<number>({
      address: assetAddress,
      abi: ERC20_METADATA_ABI,
      functionName: "decimals",
    }),
  ]);

  return { symbol, decimals };
}

async function readOptionalString(
  provider: VaultLiquidityProvider | Provider,
  address: Address,
  abi: Abi,
  functionName: string,
  fallback: string
): Promise<string> {
  try {
    return await provider.readContract<string>({ address, abi, functionName });
  } catch {
    return fallback;
  }
}

async function readOptionalBytes(
  provider: VaultLiquidityProvider | Provider,
  address: Address,
  abi: Abi,
  functionName: string
): Promise<`0x${string}` | undefined> {
  try {
    return await provider.readContract<`0x${string}`>({ address, abi, functionName });
  } catch {
    return undefined;
  }
}

async function readLiquidityAdapterWithdrawableAssets(
  provider: VaultLiquidityProvider | Provider,
  assetAddress: Address,
  liquidityAdapter: Address,
  liquidityData: `0x${string}` | undefined
): Promise<bigint> {
  const realAssets = await provider.readContract<bigint>({
    address: liquidityAdapter,
    abi: LIQUIDITY_ADAPTER_ABI,
    functionName: "realAssets",
  });

  if (!liquidityData || liquidityData === "0x") return realAssets;

  try {
    const marketParams = decodeMorphoMarketParams(liquidityData);
    const marketId = getMorphoMarketId(marketParams);
    const [marketSupplyAssets, morpho] = await Promise.all([
      provider.readContract<bigint>({
        address: liquidityAdapter,
        abi: LIQUIDITY_ADAPTER_ABI,
        functionName: "expectedSupplyAssets",
        args: [marketId],
      }),
      provider.readContract<Address>({
        address: liquidityAdapter,
        abi: LIQUIDITY_ADAPTER_ABI,
        functionName: "morpho",
      }),
    ]);
    const morphoBalance = await provider.readContract<bigint>({
      address: assetAddress,
      abi: ERC20_METADATA_ABI,
      functionName: "balanceOf",
      args: [morpho],
    });
    return minBigint(marketSupplyAssets, morphoBalance);
  } catch {
    return realAssets;
  }
}

type MorphoMarketParams = {
  loanToken: Address;
  collateralToken: Address;
  oracle: Address;
  irm: Address;
  lltv: bigint;
};

function decodeMorphoMarketParams(data: `0x${string}`): MorphoMarketParams {
  const [params] = decodeAbiParameters(MARKET_PARAMS_ABI, data) as readonly [MorphoMarketParams];
  return params;
}

function getMorphoMarketId(params: MorphoMarketParams): `0x${string}` {
  return keccak256(encodeAbiParameters(MARKET_PARAMS_ABI, [params]));
}

function minBigint(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

function normalizeAddress(value: string, label: string): Address {
  try {
    return getAddress(value) as Address;
  } catch {
    throw new Error(`Invalid ${label} address: ${value}`);
  }
}
