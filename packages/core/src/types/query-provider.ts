/**
 * QueryProvider — pluggable interface for blockchain query functions
 * (balance, price, apy, health_factor, position, debt).
 *
 * Lives in types/ to avoid circular imports — types/ never imports
 * from runtime/, but runtime/expression-evaluator.ts imports from types/.
 */

export interface QueryProviderMeta {
  name: string;
  supportedQueries: Array<"balance" | "price" | "apy" | "health_factor" | "position" | "debt">;
  description?: string;
}

export interface QueryProvider {
  meta: QueryProviderMeta;
  queryBalance?: (asset: string, address?: string) => Promise<bigint>;
  queryPrice?: (base: string, quote: string, source?: string) => Promise<number>;
  queryApy?: (venue: string, asset: string) => Promise<number>;
  queryHealthFactor?: (venue: string) => Promise<number>;
  queryPosition?: (venue: string, asset: string) => Promise<unknown>;
  queryDebt?: (venue: string, asset: string) => Promise<bigint>;
}
