import type { ApiKeyCreds } from "@polymarket/clob-client";
import type { PolymarketSignatureType } from "./types.js";

export function resolveRequiredStringArg(args: Record<string, unknown>, keys: string[]): string {
  const value = resolveOptionalStringArg(args, keys);
  if (!value) {
    throw new Error(`Missing required Polymarket argument: ${keys[0]}`);
  }
  return value;
}

export function resolveOptionalStringArg(
  args: Record<string, unknown>,
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return undefined;
}

export function resolveRequiredStringArrayArg(
  args: Record<string, unknown>,
  keys: string[]
): string[] {
  const values = resolveOptionalStringArrayArg(args, keys);
  if (!values || values.length === 0) {
    throw new Error(`Missing required Polymarket argument: ${keys[0]}`);
  }
  return values;
}

export function resolveOptionalStringArrayArg(
  args: Record<string, unknown>,
  keys: string[]
): string[] | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return [trimmed];
      }
    }
    if (Array.isArray(value)) {
      const items: string[] = [];
      for (const entry of value) {
        if (typeof entry !== "string" || entry.trim().length === 0) {
          throw new Error(`Polymarket argument '${key}' must contain only non-empty strings`);
        }
        items.push(entry.trim());
      }
      if (items.length > 0) {
        return items;
      }
    }
  }
  return undefined;
}

export function resolveRequiredNumericArg(
  args: Record<string, unknown>,
  keys: string[],
  label: string
): number {
  const value = resolveOptionalNumericArg(args, keys);
  if (value === undefined) {
    throw new Error(`Missing required Polymarket numeric argument: ${label}`);
  }
  return value;
}

export function resolveOptionalNumericArg(
  args: Record<string, unknown>,
  keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = toFiniteNumber(args[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

export function resolveOptionalIntegerArg(
  args: Record<string, unknown>,
  keys: string[]
): number | undefined {
  for (const key of keys) {
    const raw = args[key];
    const value = toFiniteNumber(raw);
    if (value === undefined) {
      continue;
    }
    if (!Number.isInteger(value)) {
      throw new Error(`Polymarket argument '${key}' must be an integer`);
    }
    return value;
  }
  return undefined;
}

export function resolveOptionalBooleanArg(
  args: Record<string, unknown>,
  keys: string[]
): boolean | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return undefined;
}

export function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return undefined;
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return undefined;
    return parsed;
  }

  return undefined;
}

export function readApiCredsFromEnv(
  env: Record<string, string | undefined>
): ApiKeyCreds | undefined {
  const key = readEnv(env, ["POLYMARKET_API_KEY", "CLOB_API_KEY", "POLY_API_KEY"]);
  const secret = readEnv(env, ["POLYMARKET_API_SECRET", "CLOB_SECRET", "POLY_API_SECRET"]);
  const passphrase = readEnv(env, [
    "POLYMARKET_API_PASSPHRASE",
    "CLOB_PASS_PHRASE",
    "POLY_API_PASSPHRASE",
  ]);

  if (!key || !secret || !passphrase) {
    return undefined;
  }

  return { key, secret, passphrase };
}

export function resolveSignatureType(
  explicit: PolymarketSignatureType | undefined,
  funderAddress: string | undefined,
  env: Record<string, string | undefined>
): PolymarketSignatureType {
  if (explicit !== undefined) {
    return explicit;
  }

  const fromEnv = readEnv(env, ["POLYMARKET_SIGNATURE_TYPE", "CLOB_SIGNATURE_TYPE"]);
  if (fromEnv) {
    const parsed = Number(fromEnv);
    if (parsed === 0 || parsed === 1 || parsed === 2) {
      return parsed;
    }
    throw new Error(
      `Invalid Polymarket signature type '${fromEnv}'. Expected 0 (EOA), 1 (POLY_PROXY), or 2 (GNOSIS_SAFE).`
    );
  }

  return funderAddress ? 2 : 0;
}

export function resolveBoolean(
  explicit: boolean | undefined,
  fromEnv: string | undefined,
  fallback: boolean
): boolean {
  if (explicit !== undefined) {
    return explicit;
  }
  if (!fromEnv) {
    return fallback;
  }

  const normalized = fromEnv.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  throw new Error(`Invalid boolean value '${fromEnv}'`);
}

export function resolveNumber(
  explicit: number | undefined,
  fromEnv: string | undefined,
  fallback: number
): number {
  if (explicit !== undefined) {
    return explicit;
  }
  if (!fromEnv) {
    return fallback;
  }
  const parsed = Number(fromEnv);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value '${fromEnv}'`);
  }
  return parsed;
}

export function resolveString(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

export function readEnv(
  env: Record<string, string | undefined>,
  names: string[]
): string | undefined {
  for (const name of names) {
    const value = env[name];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

export function readStringField(payload: unknown, keys: string[]): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}
