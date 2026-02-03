/**
 * Venue adapter types
 */

import type { Action } from "../types/actions.js";
import type { Address } from "../types/primitives.js";
import type { Provider } from "../wallet/provider.js";
import type { BuiltTransaction } from "../wallet/tx-builder.js";

export interface VenueAdapterMeta {
  name: string;
  supportedChains: number[];
  actions: string[];
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
  status?: string;
  raw?: unknown;
}

export type VenueBuildResult = BuiltTransaction | BuiltTransaction[];

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
