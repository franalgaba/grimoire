/**
 * Venue adapter types
 */

import type { Action } from "../types/actions.js";
import type { Address } from "../types/primitives.js";
import type { Provider } from "../wallet/provider.js";
import type { BuiltTransaction } from "../wallet/tx-builder.js";

export type VenueConstraint =
  | "max_slippage"
  | "min_output"
  | "max_input"
  | "deadline"
  | "max_price_impact"
  | "min_liquidity"
  | "require_quote"
  | "require_simulation"
  | "max_gas";

export interface VenueQuoteMetadata {
  expectedIn?: bigint;
  expectedOut?: bigint;
  minOut?: bigint;
  maxIn?: bigint;
  slippageBps?: number;
}

export interface VenueBuildMetadata {
  quote?: VenueQuoteMetadata;
  route?: Record<string, unknown>;
  fees?: Record<string, unknown>;
  warnings?: string[];
}

export interface VenueAdapterMeta {
  name: string;
  supportedChains: number[];
  actions: string[];
  supportedConstraints: VenueConstraint[];
  supportsQuote?: boolean;
  supportsSimulation?: boolean;
  requiredEnv?: string[];
  supportsPreviewCommit?: boolean;
  dataEndpoints?: string[];
  description?: string;
  executionType?: "evm" | "offchain";
}

export interface VenueAdapterContext {
  provider: Provider;
  walletAddress: Address;
  chainId: number;
  vault?: Address;
  /** Execution mode (simulate, dry-run, execute). Undefined when adapters are used directly. */
  mode?: "simulate" | "dry-run" | "execute";
}

export interface OffchainExecutionResult {
  id: string;
  status: string;
  reference?: string;
  raw?: unknown;
}

export type VenueBuildResult =
  | (BuiltTransaction & { metadata?: VenueBuildMetadata })
  | Array<BuiltTransaction & { metadata?: VenueBuildMetadata }>;

export interface VenueAdapter {
  meta: VenueAdapterMeta;
  buildAction?: (action: Action, ctx: VenueAdapterContext) => Promise<VenueBuildResult>;
  executeAction?: (action: Action, ctx: VenueAdapterContext) => Promise<OffchainExecutionResult>;
}

export interface VenueRegistry {
  register: (adapter: VenueAdapter) => void;
  registerAll: (adapters: VenueAdapter[]) => void;
  get: (name: string) => VenueAdapter | undefined;
  list: () => VenueAdapterMeta[];
}
