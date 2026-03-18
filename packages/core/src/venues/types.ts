/**
 * Venue adapter types
 */

import type { Action } from "../types/actions.js";
import type {
  BridgeLifecycleAdapter,
  BridgeLifecycleStatusInput,
  BridgeLifecycleStatusResult,
  CrossChainTrackRole,
} from "../types/cross-chain.js";
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
  /**
   * Cross-chain orchestration context (Phase 1).
   * Present only when action execution is orchestrated across source/destination tracks.
   */
  crossChain?: {
    enabled: boolean;
    runId?: string;
    trackId?: string;
    role?: CrossChainTrackRole;
    stepId?: string;
    actionRef?: string;
    morphoMarketIds?: Record<string, string>;
  };
  /** Optional warning sink for adapter-level warnings. */
  onWarning?: (message: string) => void;
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
  bridgeLifecycle?: BridgeLifecycleAdapter;
  resolveHandoffStatus?: (
    input: BridgeLifecycleStatusInput
  ) => Promise<BridgeLifecycleStatusResult>;
}

export interface VenueRegistry {
  register: (adapter: VenueAdapter) => void;
  registerAll: (adapters: VenueAdapter[]) => void;
  get: (name: string) => VenueAdapter | undefined;
  list: () => VenueAdapterMeta[];
}

/**
 * Manifest describing a venue plugin — used by both built-in and external venues.
 */
export interface VenueManifest {
  /** Canonical venue name, e.g. "aave", "gmx" */
  name: string;
  /** Optional aliases, e.g. ["aave-v3"] */
  aliases?: string[];
  /** Absolute path to the CLI entry point (.ts or .js) */
  cli: string;
  /** Absolute path to the adapter module (default export = VenueAdapter) */
  adapter?: string;
}
