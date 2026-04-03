/**
 * QueryProvider — pluggable interface for blockchain query functions.
 *
 * Lives in types/ to avoid circular imports — types/ never imports
 * from runtime/, but runtime/expression-evaluator.ts imports from types/.
 */

export interface MetricRequest {
  /** Metric surface id, e.g. "apy", "borrow_apr", "utilization". */
  surface: string;
  /** Venue alias/canonical id. */
  venue: string;
  /** Optional asset symbol/address context. */
  asset?: string;
  /** Optional market/vault selector (venue-specific). */
  selector?: string;
}

export interface QueryProviderMeta {
  name: string;
  supportedQueries: Array<"balance" | "price" | "metric" | "health_factor" | "position" | "debt">;
  /** Metric surfaces supported by queryMetric (e.g. ["apy"]). */
  supportedMetrics?: string[];
  description?: string;
}

export interface QueryProvider {
  meta: QueryProviderMeta;
  queryBalance?: (asset: string, address?: string) => Promise<bigint>;
  queryPrice?: (base: string, quote: string, source?: string) => Promise<number>;
  queryMetric?: (request: MetricRequest) => Promise<number>;
  queryHealthFactor?: (venue: string) => Promise<number>;
  queryPosition?: (venue: string, asset: string) => Promise<unknown>;
  queryDebt?: (venue: string, asset: string) => Promise<bigint>;
}
