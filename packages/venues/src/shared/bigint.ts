/**
 * Shared bigint conversion utilities used across venue adapters.
 */

/**
 * Type guard for DSL literal amount objects ({ kind: "literal", value: ... }).
 */
export function isLiteralAmount(
  value: unknown
): value is { kind: "literal"; value: string | number | bigint } {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    (value as { kind?: unknown }).kind === "literal" &&
    "value" in value
  );
}

/**
 * Strict conversion to bigint. Throws on unsupported types.
 */
export function toBigInt(amount: unknown, label?: string): bigint {
  if (typeof amount === "bigint") return amount;
  if (typeof amount === "number") return BigInt(Math.floor(amount));
  if (typeof amount === "string") return BigInt(amount);
  if (isLiteralAmount(amount)) {
    return typeof amount.value === "bigint" ? amount.value : BigInt(amount.value);
  }
  throw new Error(label ?? "Unsupported amount type");
}

/**
 * Lenient conversion to bigint. Returns undefined on failure.
 */
export function toBigIntIfPossible(value: unknown): bigint | undefined {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return undefined;
    return BigInt(Math.floor(value));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    try {
      return BigInt(trimmed);
    } catch {
      return undefined;
    }
  }
  if (value && typeof value === "object" && "kind" in value && "value" in value) {
    const literal = value as { kind?: unknown; value?: unknown };
    if (literal.kind === "literal") {
      return toBigIntIfPossible(literal.value);
    }
  }
  return undefined;
}
