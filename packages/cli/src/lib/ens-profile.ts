import { type Address, createPublicClient, http } from "viem";

export const ENS_PROFILE_KEYS = [
  "io.grimoire.risk_profile",
  "io.grimoire.max_slippage_bps",
  "io.grimoire.preferred_settlement_chain",
] as const;

export interface EnsProfile {
  name: string;
  address?: Address;
  text: Partial<Record<(typeof ENS_PROFILE_KEYS)[number], string>>;
  riskProfile?: string;
  maxSlippageBps?: number;
  preferredSettlementChain?: number;
}

export interface EnsProfileOptions {
  rpcUrl?: string;
}

const ENS_MIN_SLIPPAGE_BPS = 0;
const ENS_MAX_SLIPPAGE_BPS = 500;

export async function resolveEnsProfile(
  ensName: string,
  options: EnsProfileOptions = {}
): Promise<EnsProfile> {
  const rpcUrl = resolveEnsRpcUrl(options.rpcUrl);
  const normalizedName = normalizeEnsName(ensName);
  const client = createPublicClient({ transport: http(rpcUrl) });

  const address = await client.getEnsAddress({ name: normalizedName });

  const textEntries = await Promise.all(
    ENS_PROFILE_KEYS.map(async (key) => {
      const value = await client.getEnsText({ name: normalizedName, key });
      return [key, value ?? undefined] as const;
    })
  );

  const text: EnsProfile["text"] = {};
  for (const [key, value] of textEntries) {
    if (typeof value === "string" && value.length > 0) {
      text[key] = value;
    }
  }

  const riskProfile = text["io.grimoire.risk_profile"];
  const maxSlippageBps = parseMaybeNumber(text["io.grimoire.max_slippage_bps"]);
  const preferredSettlementChain = parseMaybeNumber(text["io.grimoire.preferred_settlement_chain"]);

  return {
    name: normalizedName,
    address: address ?? undefined,
    text,
    riskProfile,
    maxSlippageBps,
    preferredSettlementChain,
  };
}

export function hydrateParamsFromEnsProfile(
  params: Record<string, unknown>,
  profile: EnsProfile
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...params };

  if (profile.address && merged.payout_address === undefined) {
    merged.payout_address = profile.address;
  }

  if (profile.riskProfile && merged.risk_profile === undefined) {
    merged.risk_profile = profile.riskProfile;
  }

  if (profile.maxSlippageBps !== undefined && merged.max_slippage_bps === undefined) {
    merged.max_slippage_bps = clamp(
      profile.maxSlippageBps,
      ENS_MIN_SLIPPAGE_BPS,
      ENS_MAX_SLIPPAGE_BPS
    );
  }

  if (
    profile.preferredSettlementChain !== undefined &&
    merged.preferred_settlement_chain === undefined
  ) {
    merged.preferred_settlement_chain = profile.preferredSettlementChain;
  }

  return merged;
}

function normalizeEnsName(name: string): string {
  const normalized = name.trim().toLowerCase();
  if (!normalized) {
    throw new Error("ENS name is required");
  }
  return normalized;
}

function resolveEnsRpcUrl(explicit?: string): string {
  const rpcUrl = explicit ?? process.env.ENS_RPC_URL ?? process.env.RPC_URL;
  if (!rpcUrl) {
    throw new Error("ENS resolution requires --ens-rpc-url, ENS_RPC_URL, or RPC_URL");
  }
  return rpcUrl;
}

function parseMaybeNumber(input: string | undefined): number | undefined {
  if (!input) return undefined;
  const parsed = Number.parseInt(input, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
