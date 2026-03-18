import type { Address } from "@grimoirelabs/core";

export type FetchFn = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1]
) => ReturnType<typeof fetch>;

export interface PendleAdapterConfig {
  baseUrl?: string;
  supportedChains?: number[];
  slippageBps?: number;
  tokenMap?: Record<number, Record<string, Address>>;
  fetchFn?: FetchFn;
  enableV2Fallback?: boolean;
}

export interface PendleTokenAmount {
  token: string;
  amount: string;
  spender?: string;
}

export interface PendleConvertData {
  aggregatorType?: string;
  priceImpact?: number;
  fee?: Record<string, unknown>;
}

export interface PendleContractParamInfo {
  method?: string;
}

export interface PendleRoute {
  contractParamInfo?: PendleContractParamInfo;
  tx?: {
    to?: string;
    data?: string;
    value?: string;
  };
  outputs?: PendleTokenAmount[];
  data?: PendleConvertData;
}

export interface PendleConvertResponse {
  action?: string;
  inputs?: PendleTokenAmount[];
  requiredApprovals?: PendleTokenAmount[];
  routes?: PendleRoute[];
}

export interface PendleConvertRequest {
  receiver?: string;
  slippage: number;
  enableAggregator: boolean;
  aggregators?: string[];
  inputs: PendleTokenAmount[];
  outputs: string[];
  redeemRewards?: boolean;
  needScale?: boolean;
  additionalData?: string;
  useLimitOrder?: boolean;
}

export interface PendleOptions {
  receiver?: string;
  enableAggregator: boolean;
  aggregators?: string[];
  needScale?: boolean;
  redeemRewards?: boolean;
  additionalData?: string;
  useLimitOrder?: boolean;
}
