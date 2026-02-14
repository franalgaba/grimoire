import { readFileSync } from "node:fs";
import type { ActionStep, SpellIR } from "@grimoirelabs/core";

export function collectRepeatedOption(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

export function toOptionList(value?: string | string[]): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function createLogicalRunId(): string {
  const now = new Date();
  const timestamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\\..+$/, "");
  const random = Math.random().toString(36).slice(2, 8);
  return `${timestamp}-${random}`;
}

export interface CrossChainRunManifest {
  schema_version: "grimoire.cross_chain.phase1.v1";
  run_id: string;
  source_spell_path: string;
  destination_spell_path: string;
  source_spell_id: string;
  destination_spell_id: string;
  source_chain_id: number;
  destination_chain_id: number;
  mode: "simulate" | "dry-run" | "execute";
  watch: boolean;
  handoff_timeout_sec: number;
  poll_interval_sec: number;
  rpc_by_chain: Record<number, string>;
  params: Record<string, unknown>;
  vault: string;
  morpho_market_ids: Record<string, string>;
}

export function isCrossChainRunManifest(value: unknown): value is CrossChainRunManifest {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { schema_version?: unknown }).schema_version === "grimoire.cross_chain.phase1.v1"
  );
}

export interface ParsedRpcUrls {
  defaultRpcUrl?: string;
  byChain: Record<number, string>;
}

export function parseRpcUrlMappings(value?: string | string[]): ParsedRpcUrls {
  const tokens = toOptionList(value)
    .map((token) => token.trim())
    .filter(Boolean);
  let defaultRpcUrl: string | undefined;
  const byChain: Record<number, string> = {};

  for (const token of tokens) {
    const eq = token.indexOf("=");
    if (eq === -1) {
      if (defaultRpcUrl !== undefined) {
        throw new Error("Duplicate plain --rpc-url values provided");
      }
      defaultRpcUrl = token;
      continue;
    }

    const chainText = token.slice(0, eq).trim();
    const url = token.slice(eq + 1).trim();
    if (!chainText || !url) {
      throw new Error(`Invalid --rpc-url mapping '${token}'. Expected <chainId>=<url>.`);
    }
    const chainId = Number.parseInt(chainText, 10);
    if (!Number.isFinite(chainId) || chainId <= 0) {
      throw new Error(`Invalid chain id '${chainText}' in --rpc-url mapping '${token}'.`);
    }
    if (byChain[chainId]) {
      throw new Error(`Duplicate --rpc-url mapping for chain ${chainId}`);
    }
    byChain[chainId] = url;
  }

  return { defaultRpcUrl, byChain };
}

export function resolveRpcUrlForChain(chainId: number, parsed: ParsedRpcUrls): string | undefined {
  const explicit = parsed.byChain[chainId];
  if (explicit) return explicit;

  const envScoped = process.env[`RPC_URL_${chainId}`];
  if (typeof envScoped === "string" && envScoped.trim().length > 0) {
    return envScoped.trim();
  }

  if (parsed.defaultRpcUrl) return parsed.defaultRpcUrl;

  const envDefault = process.env.RPC_URL;
  if (typeof envDefault === "string" && envDefault.trim().length > 0) {
    return envDefault.trim();
  }

  return undefined;
}

export function requireExplicitRpcMappings(
  parsed: ParsedRpcUrls,
  sourceChainId: number,
  destinationChainId: number
): void {
  const hasSource = typeof parsed.byChain[sourceChainId] === "string";
  const hasDestination = typeof parsed.byChain[destinationChainId] === "string";
  if (!hasSource || !hasDestination) {
    throw new Error(
      `Cross-chain mode requires explicit --rpc-url <chainId>=<url> for both chains (${sourceChainId} and ${destinationChainId}).`
    );
  }
}

export function parseMorphoMarketMappings(input: {
  morphoMarketId?: string | string[];
  morphoMarketMap?: string;
}): Record<string, string> {
  const parsedFromFlags = parseMorphoMarketIdFlags(input.morphoMarketId);
  const parsedFromFile = input.morphoMarketMap
    ? parseMorphoMarketMapFile(input.morphoMarketMap)
    : {};

  const merged: Record<string, string> = { ...parsedFromFile };
  for (const [actionRef, marketId] of Object.entries(parsedFromFlags)) {
    const existing = merged[actionRef];
    if (existing !== undefined && existing !== marketId) {
      throw new Error(
        `Conflicting Morpho market mapping for '${actionRef}' between --morpho-market-map and --morpho-market-id.`
      );
    }
    merged[actionRef] = marketId;
  }

  return merged;
}

function parseMorphoMarketIdFlags(value?: string | string[]): Record<string, string> {
  const tokens = toOptionList(value)
    .map((token) => token.trim())
    .filter(Boolean);
  const out: Record<string, string> = {};

  for (const token of tokens) {
    const eq = token.indexOf("=");
    if (eq === -1) {
      throw new Error(
        `Invalid --morpho-market-id value '${token}'. Expected <actionRef>=<marketId>.`
      );
    }
    const actionRef = token.slice(0, eq).trim();
    const marketId = token.slice(eq + 1).trim();
    validateActionRef(actionRef);
    if (!marketId) {
      throw new Error(`Invalid market id in --morpho-market-id '${token}'.`);
    }
    if (out[actionRef]) {
      throw new Error(`Duplicate --morpho-market-id for '${actionRef}'.`);
    }
    out[actionRef] = marketId;
  }

  return out;
}

function parseMorphoMarketMapFile(path: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    throw new Error(`Failed to parse --morpho-market-map '${path}': ${(error as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--morpho-market-map must be a JSON object of actionRef -> marketId.");
  }

  const out: Record<string, string> = {};
  for (const [actionRef, value] of Object.entries(parsed as Record<string, unknown>)) {
    validateActionRef(actionRef);
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`Invalid market id for actionRef '${actionRef}' in --morpho-market-map.`);
    }
    out[actionRef] = value.trim();
  }
  return out;
}

function validateActionRef(actionRef: string): void {
  if (!/^(source|destination):[A-Za-z0-9_.-]+$/.test(actionRef)) {
    throw new Error(
      `Invalid actionRef '${actionRef}'. Expected '<spellRole>:<stepId>' where spellRole is source|destination.`
    );
  }
}

export function validateMorphoMappingsForSpells(
  sourceSpell: SpellIR,
  destinationSpell: SpellIR,
  mapping: Record<string, string>
): void {
  const sourceMorpho = collectMorphoActionRefs(sourceSpell, "source");
  const destinationMorpho = collectMorphoActionRefs(destinationSpell, "destination");
  const morphoRefs = new Set([...sourceMorpho, ...destinationMorpho]);
  const knownRefs = new Set([
    ...collectActionRefs(sourceSpell, "source"),
    ...collectActionRefs(destinationSpell, "destination"),
  ]);

  for (const [actionRef] of Object.entries(mapping)) {
    if (!knownRefs.has(actionRef)) {
      throw new Error(`Unknown actionRef '${actionRef}' in Morpho market mapping.`);
    }
    if (!morphoRefs.has(actionRef)) {
      throw new Error(
        `ActionRef '${actionRef}' is not a Morpho lend/withdraw/borrow/repay action.`
      );
    }
  }

  for (const actionRef of morphoRefs) {
    if (!mapping[actionRef]) {
      throw new Error(
        `Missing Morpho market mapping for '${actionRef}'. Cross-chain Morpho actions require explicit market_id.`
      );
    }
  }
}

function collectActionRefs(spell: SpellIR, role: "source" | "destination"): string[] {
  return spell.steps
    .filter((step): step is ActionStep => step.kind === "action")
    .map((step) => `${role}:${step.id}`);
}

function collectMorphoActionRefs(spell: SpellIR, role: "source" | "destination"): string[] {
  return spell.steps
    .filter((step): step is ActionStep => step.kind === "action")
    .filter((step) => isMorphoActionStep(spell, step))
    .map((step) => `${role}:${step.id}`);
}

function isMorphoActionStep(spell: SpellIR, step: ActionStep): boolean {
  if (
    step.action.type !== "lend" &&
    step.action.type !== "withdraw" &&
    step.action.type !== "borrow" &&
    step.action.type !== "repay"
  ) {
    return false;
  }

  const actionVenue = "venue" in step.action ? step.action.venue : undefined;
  if (actionVenue === "morpho_blue") {
    return true;
  }

  const explicitSkill = step.skill
    ? spell.skills.find((skill) => skill.name === step.skill)
    : undefined;
  if (explicitSkill?.adapters.includes("morpho_blue")) {
    return true;
  }

  if (actionVenue) {
    const venueAsSkill = spell.skills.find((skill) => skill.name === actionVenue);
    if (venueAsSkill?.adapters.includes("morpho_blue")) {
      return true;
    }
  }

  return false;
}
