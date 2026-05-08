import { describe, expect, test } from "bun:test";
import type { Address } from "@grimoirelabs/core";
import type { Abi } from "viem";
import { encodeAbiParameters } from "viem";
import {
  readMorphoVaultV2Liquidity,
  redactRpcUrl,
  toMorphoVaultV2LiquiditySpellParams,
  type VaultLiquidityProvider,
} from "./vault-liquidity.js";

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address;
const VAULT = "0xbeef0e0834849aCC03f0089F01f4F1Eeb06873C9" as Address;
const LIQUIDITY_ADAPTER = "0x1111111111111111111111111111111111111111" as Address;
const MORPHO = "0x2222222222222222222222222222222222222222" as Address;

describe("Morpho Vault V2 liquidity", () => {
  test("combines idle assets and liquidity adapter real assets", async () => {
    const provider = mockProvider({
      totalAssets: 110_388_522_785_289n,
      liquidityAdapter: LIQUIDITY_ADAPTER,
      asset: BASE_USDC,
      name: "Steakhouse Prime USDC",
      idleAssets: 0n,
      liquidityAdapterAssets: 109_760_000_000_000n,
      blockNumber: 123n,
      rpcUrl: "https://base-mainnet.g.alchemy.com/v2/super-secret",
    });

    const liquidity = await readMorphoVaultV2Liquidity({
      chainId: 8453,
      vault: VAULT,
      provider,
    });

    expect(liquidity.totalAssets).toBe("110388522785289");
    expect(liquidity.withdrawableLiquidityAssets).toBe("109760000000000");
    expect(liquidity.withdrawableLiquidityBps).toBe(9943);
    expect(liquidity.thresholdReady).toBe(true);
    expect(liquidity.asset).toEqual({
      symbol: "USDC",
      address: BASE_USDC,
      decimals: 6,
    });
    expect(liquidity.source).toEqual({
      kind: "onchain",
      blockNumber: 123,
      rpcUrl: "https://base-mainnet.g.alchemy.com/v2/redacted",
    });
  });

  test("uses only idle assets when the vault has no liquidity adapter", async () => {
    const provider = mockProvider({
      totalAssets: 1_000_000n,
      liquidityAdapter: "0x0000000000000000000000000000000000000000" as Address,
      asset: BASE_USDC,
      name: "Idle Only",
      idleAssets: 250_000n,
      liquidityAdapterAssets: 999_999n,
      blockNumber: 55n,
    });

    const liquidity = await readMorphoVaultV2Liquidity({
      chainId: 8453,
      vault: VAULT,
      provider,
      thresholdBps: 3_000,
    });

    expect(liquidity.withdrawableLiquidityAssets).toBe("250000");
    expect(liquidity.withdrawableLiquidityBps).toBe(2500);
    expect(liquidity.thresholdReady).toBe(false);
    expect(provider.calls.filter((call) => call.functionName === "realAssets")).toHaveLength(0);
  });

  test("caps Morpho Market V1 liquidity adapter assets by available market cash", async () => {
    const provider = mockProvider({
      totalAssets: 1_000_000n,
      liquidityAdapter: LIQUIDITY_ADAPTER,
      asset: BASE_USDC,
      name: "Capped Liquidity",
      idleAssets: 50_000n,
      liquidityAdapterAssets: 900_000n,
      liquidityData: encodeLiquidityData(),
      expectedSupplyAssets: 900_000n,
      morpho: MORPHO,
      morphoAssetBalance: 300_000n,
      blockNumber: 88n,
    });

    const liquidity = await readMorphoVaultV2Liquidity({
      chainId: 8453,
      vault: VAULT,
      provider,
    });

    expect(liquidity.withdrawableLiquidityAssets).toBe("350000");
    expect(liquidity.withdrawableLiquidityBps).toBe(3500);
    expect(liquidity.liquidityAdapterAssets).toBe("300000");
  });

  test("builds spell payload params", async () => {
    const provider = mockProvider({
      totalAssets: 1_000_000n,
      liquidityAdapter: LIQUIDITY_ADAPTER,
      asset: BASE_USDC,
      name: "Steakhouse Prime USDC",
      idleAssets: 10n,
      liquidityAdapterAssets: 490_000n,
      blockNumber: 9n,
    });
    const liquidity = await readMorphoVaultV2Liquidity({ chainId: 8453, vault: VAULT, provider });

    expect(toMorphoVaultV2LiquiditySpellParams(liquidity)).toEqual({
      protocol: "morpho-vault-v2",
      metric: "withdrawable_liquidity_bps",
      vault_name: "Steakhouse Prime USDC",
      vault_address: VAULT,
      asset_symbol: "USDC",
      asset_address: BASE_USDC,
      threshold_bps: 500,
      window_seconds: 86_400,
      withdrawable_liquidity_bps: 4900,
      withdrawable_liquidity_assets: "490010",
      total_assets: "1000000",
      idle_assets: "10",
      liquidity_adapter: LIQUIDITY_ADAPTER,
      liquidity_adapter_assets: "490000",
    });
  });

  test("redacts common RPC URL secret locations", () => {
    expect(redactRpcUrl("https://user:pass@rpc.example/path?apiKey=secret")).toBe(
      "https://redacted:redacted@rpc.example/path?apiKey=redacted"
    );
    expect(redactRpcUrl("not a url")).toBe("redacted");
  });
});

type MockValues = {
  totalAssets: bigint;
  liquidityAdapter: Address;
  asset: Address;
  name: string;
  idleAssets: bigint;
  liquidityAdapterAssets: bigint;
  liquidityData?: `0x${string}`;
  expectedSupplyAssets?: bigint;
  morpho?: Address;
  morphoAssetBalance?: bigint;
  blockNumber: bigint;
  rpcUrl?: string;
};

type MockProvider = VaultLiquidityProvider & {
  calls: Array<{ address: Address; functionName: string }>;
};

function mockProvider(values: MockValues): MockProvider {
  const calls: Array<{ address: Address; functionName: string }> = [];

  return {
    rpcUrl: values.rpcUrl,
    calls,
    async getBlockNumber() {
      return values.blockNumber;
    },
    async readContract<T>(params: {
      address: Address;
      abi: Abi;
      functionName: string;
      args?: readonly unknown[];
    }): Promise<T> {
      calls.push({ address: params.address, functionName: params.functionName });

      if (params.address === VAULT && params.functionName === "totalAssets") {
        return values.totalAssets as T;
      }
      if (params.address === VAULT && params.functionName === "liquidityAdapter") {
        return values.liquidityAdapter as T;
      }
      if (params.address === VAULT && params.functionName === "asset") {
        return values.asset as T;
      }
      if (params.address === VAULT && params.functionName === "name") {
        return values.name as T;
      }
      if (params.address === VAULT && params.functionName === "liquidityData") {
        if (values.liquidityData === undefined) throw new Error("No liquidity data");
        return values.liquidityData as T;
      }
      if (params.address === values.asset && params.functionName === "balanceOf") {
        if (params.args?.[0] === values.morpho) return values.morphoAssetBalance as T;
        return values.idleAssets as T;
      }
      if (params.address === values.liquidityAdapter && params.functionName === "realAssets") {
        return values.liquidityAdapterAssets as T;
      }
      if (
        params.address === values.liquidityAdapter &&
        params.functionName === "expectedSupplyAssets"
      ) {
        return values.expectedSupplyAssets as T;
      }
      if (params.address === values.liquidityAdapter && params.functionName === "morpho") {
        return values.morpho as T;
      }

      throw new Error(`Unexpected read: ${params.address} ${params.functionName}`);
    },
  };
}

function encodeLiquidityData(): `0x${string}` {
  return encodeAbiParameters(
    [
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
    ],
    [
      {
        loanToken: BASE_USDC,
        collateralToken: "0x3333333333333333333333333333333333333333",
        oracle: "0x4444444444444444444444444444444444444444",
        irm: "0x5555555555555555555555555555555555555555",
        lltv: 860000000000000000n,
      },
    ]
  );
}
