import type { Action, Address, BuiltTransaction, VenueAdapterContext } from "@grimoirelabs/core";
import { toBigIntIfPossible } from "../../shared/bigint.js";
import { buildApprovalIfNeeded } from "../../shared/erc20.js";
import { isAddressLike } from "../../shared/token-registry.js";
import type { PendleTokenAmount } from "./types.js";

export function sumTokenAmounts(items: PendleTokenAmount[] | undefined): bigint | undefined {
  if (!items || items.length === 0) {
    return undefined;
  }
  let total = 0n;
  let hasValue = false;
  for (const item of items) {
    const value = toBigIntIfPossible(item.amount);
    if (value === undefined) continue;
    total += value;
    hasValue = true;
  }
  return hasValue ? total : undefined;
}

export function parseStringList(value: unknown, field: string): string[] {
  const list = parseOptionalStringList(value);
  if (!list || list.length === 0) {
    throw new Error(`Pendle custom convert requires '${field}'`);
  }
  return list;
}

export function parseBigIntList(value: unknown, field: string): bigint[] {
  if (Array.isArray(value)) {
    return value.map((entry, index) => toBigIntStrict(entry, `${field}[${index}]`));
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .map((entry, index) => toBigIntStrict(entry, `${field}[${index}]`));
  }
  return [toBigIntStrict(value, field)];
}

export function parseOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseOptionalStringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value
      .map((entry) => (typeof entry === "string" ? entry.trim() : String(entry)))
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return items.length > 0 ? items : undefined;
  }
  if (typeof value === "string") {
    const items = value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return items.length > 0 ? items : undefined;
  }
  return undefined;
}

export function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return undefined;
}

export function resolveSlippageBps(
  actionBps: number | undefined,
  configBps: number | undefined,
  defaultBps: number
): number {
  const source = actionBps ?? configBps ?? defaultBps;
  return validateSlippageBps(source);
}

export function validateSlippageBps(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`Pendle max_slippage must be a finite integer bps value; received ${value}`);
  }
  if (!Number.isInteger(value)) {
    throw new Error(`Pendle max_slippage must be an integer bps value; received ${value}`);
  }
  if (value < 0 || value > 10_000) {
    throw new Error(`Pendle max_slippage must be within [0, 10000] bps; received ${value}`);
  }
  return value;
}

export function bpsToDecimal(bps: number): number {
  return bps / 10_000;
}

export function toBigIntStrict(value: unknown, label: string): bigint {
  const parsed = toBigIntIfPossible(value);
  if (parsed === undefined) {
    throw new Error(`Pendle adapter requires numeric value for ${label}`);
  }
  return parsed;
}

export { applyBps } from "../../shared/bps.js";

export async function buildPendleApprovals(input: {
  action: Action;
  ctx: VenueAdapterContext;
  requiredApprovals: PendleTokenAmount[];
  defaultSpender: Address;
}): Promise<BuiltTransaction[]> {
  const approvalsByToken = new Map<string, bigint>();
  const spenderByToken = new Map<string, Address>();

  for (const approval of input.requiredApprovals) {
    if (!approval?.token || !approval?.amount) continue;
    const token = approval.token.toLowerCase();
    const amount = toBigIntIfPossible(approval.amount) ?? 0n;
    if (amount <= 0n) continue;
    const current = approvalsByToken.get(token) ?? 0n;
    if (amount > current) {
      approvalsByToken.set(token, amount);
    }

    const spenderRaw = approval.spender;
    const spender =
      spenderRaw && isAddressLike(spenderRaw) ? (spenderRaw as Address) : input.defaultSpender;
    spenderByToken.set(token, spender);
  }

  const approvalTxs: BuiltTransaction[] = [];
  for (const [token, amount] of approvalsByToken.entries()) {
    const spender = spenderByToken.get(token) ?? input.defaultSpender;
    const txs = await buildApprovalIfNeeded({
      ctx: input.ctx,
      token: token as Address,
      spender,
      amount,
      action: input.action,
      description: `Approve ${token} for Pendle convert`,
    });
    approvalTxs.push(...txs);
  }

  return approvalTxs;
}

export { toBigIntIfPossible } from "../../shared/bigint.js";
export { estimateGasIfSupported } from "../../shared/gas.js";
