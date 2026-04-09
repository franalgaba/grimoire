/**
 * Shared JSON serialization utilities
 */

/**
 * JSON.stringify with bigint support (converts bigints to strings)
 */
export function stringifyJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, innerValue) => (typeof innerValue === "bigint" ? innerValue.toString() : innerValue),
    2
  );
}

export function toJsonSafe<T>(value: T): T {
  return JSON.parse(stringifyJson(value)) as T;
}
