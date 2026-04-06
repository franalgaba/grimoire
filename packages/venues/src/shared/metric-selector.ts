export function parseMetricSelector(selector: string | undefined): Record<string, string> {
  if (!selector) {
    return {};
  }

  const out: Record<string, string> = {};
  const parts = selector.split(/[;,]/).map((part) => part.trim());
  for (const part of parts) {
    if (!part) {
      continue;
    }
    const eqIndex = part.indexOf("=");
    if (eqIndex <= 0) {
      continue;
    }
    const key = part.slice(0, eqIndex).trim().toLowerCase();
    const value = part.slice(eqIndex + 1).trim();
    if (!key || !value) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function readMetricSelectorString(
  params: Record<string, string>,
  keys: string[],
  opts: { fallback?: string; required?: boolean; label: string }
): string | undefined {
  for (const key of keys) {
    const value = params[key.toLowerCase()];
    if (value !== undefined && value !== "") {
      return value;
    }
  }

  if (opts.fallback !== undefined && opts.fallback !== "") {
    return opts.fallback;
  }

  if (opts.required) {
    throw new Error(`Metric selector is missing required field '${opts.label}'`);
  }
  return undefined;
}

export function readMetricSelectorInt(
  params: Record<string, string>,
  keys: string[],
  opts: { fallback?: number; required?: boolean; label: string }
): number | undefined {
  const raw = readMetricSelectorString(params, keys, {
    fallback: opts.fallback !== undefined ? String(opts.fallback) : undefined,
    required: opts.required,
    label: opts.label,
  });
  if (raw === undefined) {
    return undefined;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) {
    throw new Error(`Metric selector field '${opts.label}' must be an integer`);
  }
  return value;
}

export function readMetricSelectorBigInt(
  params: Record<string, string>,
  keys: string[],
  opts: { fallback?: bigint; required?: boolean; label: string }
): bigint | undefined {
  const raw = readMetricSelectorString(params, keys, {
    fallback: opts.fallback?.toString(),
    required: opts.required,
    label: opts.label,
  });
  if (raw === undefined) {
    return undefined;
  }
  try {
    return BigInt(raw);
  } catch {
    throw new Error(`Metric selector field '${opts.label}' must be an integer-like value`);
  }
}

export function scaleToHuman(amount: bigint, decimals: number): number {
  if (decimals <= 0) {
    return Number(amount);
  }
  return Number(amount) / 10 ** decimals;
}

// ── APY normalization ──────────────────────────────────────────────────────

const BPS_PER_UNIT = 10_000;
const BPS_PER_PERCENT = 100;
const MAX_PERCENT_VALUE = 200;

/**
 * Normalize an APY value to basis points.
 * Handles three input scales:
 * - Ratio (0–1): decimal fraction → multiply by 10 000
 * - Percent (0–200): percentage → multiply by 100
 * - Basis points (>200): already in bps → passthrough
 */
export function normalizeApyToBps(value: number): number {
  if (value <= 1) {
    return value * BPS_PER_UNIT;
  }
  if (value <= MAX_PERCENT_VALUE) {
    return value * BPS_PER_PERCENT;
  }
  return value;
}

// Aave SDK can return ray-scaled (1e27) on-chain rates
const AAVE_RAY = 1e27;
const RAY_DETECTION_THRESHOLD = 1e12;

/**
 * Normalize APY to bps with Aave ray-scale detection.
 * Values above 1e12 are assumed to be ray-scaled and divided by 1e27 first.
 */
export function normalizeAaveApyToBps(value: number): number {
  if (value > RAY_DETECTION_THRESHOLD) {
    return normalizeApyToBps(value / AAVE_RAY);
  }
  return normalizeApyToBps(value);
}

// ── Numeric extraction from unknown payloads ────────────────────────────────

/**
 * Coerce a scalar value to a finite number, or return null.
 * Handles number, string, and bigint inputs.
 */
export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "bigint") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

const DEFAULT_PRIORITY_KEYS = ["mid", "midpoint", "price", "value", "result"];
const MAX_EXTRACT_DEPTH = 10;

/**
 * Recursively extract the first finite number from an unknown payload.
 * Checks priority keys first, then traverses all values.
 */
export function extractFiniteNumber(
  value: unknown,
  priorityKeys: string[] = DEFAULT_PRIORITY_KEYS,
  depth = 0
): number | null {
  if (depth > MAX_EXTRACT_DEPTH) return null;

  const direct = toFiniteNumber(value);
  if (direct !== null) return direct;

  if (!value || typeof value !== "object") return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = extractFiniteNumber(item, priorityKeys, depth + 1);
      if (candidate !== null) return candidate;
    }
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of priorityKeys) {
    if (key in record) {
      const candidate = extractFiniteNumber(record[key], priorityKeys, depth + 1);
      if (candidate !== null) return candidate;
    }
  }
  for (const nested of Object.values(record)) {
    const candidate = extractFiniteNumber(nested, priorityKeys, depth + 1);
    if (candidate !== null) return candidate;
  }
  return null;
}
