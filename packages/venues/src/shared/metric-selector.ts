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
