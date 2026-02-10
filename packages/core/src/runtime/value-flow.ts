import type { Action } from "../types/actions.js";
import type { ExecutionContext } from "../types/execution.js";
import type {
  AccountingSummary,
  AssetAccounting,
  ConstraintCheckResult,
  DriftKey,
  PlannedAction,
  ValueDelta,
} from "../types/receipt.js";

export const FEE_BUCKET_ADDRESS = "0x0000000000000000000000000000000000000fee" as const;
export const LOSS_BUCKET_ADDRESS = "0x00000000000000000000000000000000000010a5" as const;

type DriftClass = "balance" | "quote" | "rate" | "gas";

interface MandateLimits {
  maxSingleMove?: bigint;
  approvalRequiredAbove?: bigint;
  maxValueAtRisk?: bigint;
  maxSlippage?: number;
  maxGas?: bigint;
  allowedVenues?: Set<string>;
  rebalanceCooldownSec?: number;
}

export interface ValueFlowViolation {
  code: string;
  constraint: string;
  message: string;
  actual?: unknown;
  limit?: unknown;
  path?: string;
  suggestion?: string;
}

export interface PreviewValueFlowEvaluation {
  accounting: AccountingSummary;
  constraintResults: ConstraintCheckResult[];
  driftKeys: DriftKey[];
  requiresApproval: boolean;
  violation?: ValueFlowViolation;
}

export function evaluatePreviewValueFlow(
  ctx: ExecutionContext,
  plannedActions: PlannedAction[],
  valueDeltas: ValueDelta[]
): PreviewValueFlowEvaluation {
  const limits = readMandateLimits(ctx);
  const constraintResults: ConstraintCheckResult[] = [];
  let requiresApproval = false;
  let violation: ValueFlowViolation | undefined;

  const setViolation = (next: ValueFlowViolation): void => {
    if (!violation) {
      violation = next;
    }
  };

  const addConstraintResult = (
    result: ConstraintCheckResult,
    hardFail?: Omit<ValueFlowViolation, "constraint" | "message"> & { message?: string }
  ): void => {
    constraintResults.push(result);
    if (hardFail && !result.passed) {
      setViolation({
        code: hardFail.code ?? "CONSTRAINT_VIOLATION",
        constraint: result.constraintName,
        message:
          hardFail.message ?? result.message ?? `${result.constraintName} constraint violated`,
        actual: hardFail.actual ?? result.actual,
        limit: hardFail.limit ?? result.limit,
        path: hardFail.path,
        suggestion: hardFail.suggestion,
      });
    }
  };

  if (limits.rebalanceCooldownSec !== undefined) {
    const lastRebalanceMs = readLastRebalanceTimestampMs(ctx);
    if (lastRebalanceMs !== undefined) {
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - lastRebalanceMs) / 1000));
      const passed = elapsedSeconds >= limits.rebalanceCooldownSec;
      addConstraintResult(
        {
          stepId: "spell",
          constraintName: "rebalance_cooldown",
          passed,
          actual: elapsedSeconds,
          limit: limits.rebalanceCooldownSec,
          message: passed
            ? undefined
            : `Rebalance cooldown active (${elapsedSeconds}s elapsed, requires ${limits.rebalanceCooldownSec}s)`,
        },
        {
          code: "CONSTRAINT_VIOLATION",
          actual: elapsedSeconds,
          limit: limits.rebalanceCooldownSec,
          suggestion: "Wait for cooldown to expire or lower rebalance_cooldown.",
        }
      );
    }
  }

  const riskByAsset = new Map<string, bigint>();

  for (const planned of plannedActions) {
    const amount = extractActionAmount(planned.action);
    const amountLabel = amount?.toString();
    const path = getConstraintPath(ctx, planned.stepId);

    if (limits.allowedVenues?.size) {
      const allowed = limits.allowedVenues.has(planned.venue);
      addConstraintResult(
        {
          stepId: planned.stepId,
          constraintName: "allowed_venues",
          passed: allowed,
          actual: planned.venue,
          limit: Array.from(limits.allowedVenues),
          message: allowed ? undefined : `Venue '${planned.venue}' is not allowed by mandate`,
        },
        {
          code: "CONSTRAINT_VIOLATION",
          path,
          suggestion: "Route the action through an allowed venue or expand allowed_venues.",
        }
      );
    }

    if (limits.maxSingleMove !== undefined) {
      if (amount === undefined) {
        addConstraintResult(
          {
            stepId: planned.stepId,
            constraintName: "max_single_move",
            passed: false,
            message: "Action amount is unknown and cannot be checked against max_single_move",
            limit: limits.maxSingleMove.toString(),
          },
          {
            code: "CONSTRAINT_VIOLATION",
            path,
            suggestion: "Use a concrete amount for irreversible actions.",
          }
        );
      } else {
        const passed = amount <= limits.maxSingleMove;
        addConstraintResult(
          {
            stepId: planned.stepId,
            constraintName: "max_single_move",
            passed,
            actual: amount.toString(),
            limit: limits.maxSingleMove.toString(),
            message: passed
              ? undefined
              : `Move ${amount.toString()} exceeds max_single_move ${limits.maxSingleMove.toString()}`,
          },
          {
            code: "CONSTRAINT_VIOLATION",
            path,
            suggestion: "Reduce amount or raise max_single_move.",
          }
        );
      }
    }

    if (limits.approvalRequiredAbove !== undefined) {
      if (amount === undefined) {
        addConstraintResult(
          {
            stepId: planned.stepId,
            constraintName: "approval_required_above",
            passed: false,
            limit: limits.approvalRequiredAbove.toString(),
            message:
              "Action amount is unknown and cannot be checked against approval_required_above",
          },
          {
            code: "CONSTRAINT_VIOLATION",
            path,
            suggestion: "Use a concrete amount to evaluate approval thresholds.",
          }
        );
      } else {
        const thresholdCrossed = amount > limits.approvalRequiredAbove;
        const blockedBySingleMove =
          limits.maxSingleMove !== undefined && amount > limits.maxSingleMove;
        if (thresholdCrossed && !blockedBySingleMove) {
          requiresApproval = true;
        }

        addConstraintResult({
          stepId: planned.stepId,
          constraintName: "approval_required_above",
          passed: true,
          actual: amount.toString(),
          limit: limits.approvalRequiredAbove.toString(),
          message: thresholdCrossed && !blockedBySingleMove ? "Approval required" : undefined,
        });
      }
    }

    if (limits.maxSlippage !== undefined) {
      const slippage = planned.constraints.maxSlippageBps;
      if (slippage === undefined) {
        addConstraintResult(
          {
            stepId: planned.stepId,
            constraintName: "max_slippage",
            passed: false,
            limit: limits.maxSlippage,
            message: "Action is missing max_slippage constraint",
          },
          {
            code: "CONSTRAINT_VIOLATION",
            path,
            suggestion: "Set max_slippage on the action or skill defaults.",
          }
        );
      } else {
        const passed = slippage <= limits.maxSlippage;
        addConstraintResult(
          {
            stepId: planned.stepId,
            constraintName: "max_slippage",
            passed,
            actual: slippage,
            limit: limits.maxSlippage,
            message: passed
              ? undefined
              : `max_slippage ${slippage} exceeds mandate limit ${limits.maxSlippage}`,
          },
          {
            code: "CONSTRAINT_VIOLATION",
            path,
            suggestion: "Lower action max_slippage or raise mandate max_slippage.",
          }
        );
      }
    }

    if (limits.maxGas !== undefined) {
      const simulationGas = toBigInt(planned.simulationResult?.gasEstimate);
      const actionGasLimit = planned.constraints.maxGas;
      const observed = maxBigInt(simulationGas, actionGasLimit);

      if (observed === undefined) {
        addConstraintResult(
          {
            stepId: planned.stepId,
            constraintName: "max_gas",
            passed: false,
            limit: limits.maxGas.toString(),
            message: "Action gas could not be determined",
          },
          {
            code: "CONSTRAINT_VIOLATION",
            path,
            suggestion: "Provide max_gas and ensure preview returns a gas estimate.",
          }
        );
      } else {
        const passed = observed <= limits.maxGas;
        addConstraintResult(
          {
            stepId: planned.stepId,
            constraintName: "max_gas",
            passed,
            actual: observed.toString(),
            limit: limits.maxGas.toString(),
            message: passed
              ? undefined
              : `Gas ${observed.toString()} exceeds max_gas ${limits.maxGas.toString()}`,
          },
          {
            code: "CONSTRAINT_VIOLATION",
            path,
            suggestion: "Lower gas usage or raise max_gas.",
          }
        );
      }
    }

    const riskAsset = extractRiskAsset(planned.action);
    if (limits.maxValueAtRisk !== undefined) {
      if (amount === undefined || !riskAsset) {
        addConstraintResult(
          {
            stepId: planned.stepId,
            constraintName: "max_value_at_risk",
            passed: false,
            actual: amountLabel,
            limit: limits.maxValueAtRisk.toString(),
            message: "Action amount/asset is not concrete enough for max_value_at_risk",
          },
          {
            code: "CONSTRAINT_VIOLATION",
            path,
            suggestion: "Use concrete amount and asset fields for irreversible actions.",
          }
        );
      } else {
        riskByAsset.set(riskAsset, (riskByAsset.get(riskAsset) ?? 0n) + amount);
      }
    }
  }

  if (limits.maxValueAtRisk !== undefined) {
    const nonZero = Array.from(riskByAsset.entries()).filter(([, amount]) => amount > 0n);

    if (nonZero.length > 1) {
      addConstraintResult(
        {
          stepId: "spell",
          constraintName: "max_value_at_risk",
          passed: false,
          actual: nonZero.map(([asset, amount]) => `${asset}:${amount.toString()}`),
          limit: limits.maxValueAtRisk.toString(),
          message:
            "max_value_at_risk requires a valuation policy for multi-asset exposure, but none is configured",
        },
        {
          code: "VALUATION_POLICY_REQUIRED",
          suggestion: "Configure a valuation policy or reduce actions to a single risk asset.",
        }
      );
    } else {
      const exposure = nonZero[0]?.[1] ?? 0n;
      const asset = nonZero[0]?.[0];
      const passed = exposure <= limits.maxValueAtRisk;
      addConstraintResult(
        {
          stepId: "spell",
          constraintName: "max_value_at_risk",
          passed,
          actual: asset ? `${asset}:${exposure.toString()}` : "0",
          limit: limits.maxValueAtRisk.toString(),
          message: passed
            ? undefined
            : `Value at risk ${asset}:${exposure.toString()} exceeds ${limits.maxValueAtRisk.toString()}`,
        },
        {
          code: "CONSTRAINT_VIOLATION",
          suggestion: "Reduce notional exposure or raise max_value_at_risk.",
        }
      );
    }
  }

  const accounting = computeAssetAccounting(valueDeltas);
  addConstraintResult(
    {
      stepId: "spell",
      constraintName: "value_flow_accounting",
      passed: accounting.passed,
      actual: accounting.totalUnaccounted.toString(),
      limit: "0",
      message: accounting.passed
        ? undefined
        : `Unaccounted value deltas detected: ${accounting.totalUnaccounted.toString()}`,
    },
    {
      code: "VALUE_FLOW_ACCOUNTING_FAILED",
      suggestion: "Classify deltas as debit/credit/fee/loss and provide explicit bucket reasons.",
    }
  );

  return {
    accounting,
    constraintResults,
    driftKeys: buildDriftKeys(plannedActions),
    requiresApproval,
    violation,
  };
}

export function computeAssetAccounting(valueDeltas: ValueDelta[]): AccountingSummary {
  const rows = new Map<string, AssetAccounting>();

  const getRow = (asset: string): AssetAccounting => {
    const existing = rows.get(asset);
    if (existing) return existing;
    const created: AssetAccounting = {
      asset,
      debits: 0n,
      credits: 0n,
      fees: 0n,
      losses: 0n,
      unaccounted: 0n,
    };
    rows.set(asset, created);
    return created;
  };

  for (const delta of valueDeltas) {
    const row = getRow(delta.asset);

    if (delta.amount <= 0n) {
      row.unaccounted += delta.amount < 0n ? -delta.amount : 0n;
      continue;
    }

    const classification = classifyDelta(delta.reason);

    switch (classification) {
      case "debit":
        row.debits += delta.amount;
        break;
      case "credit":
        row.credits += delta.amount;
        break;
      case "fee":
        row.fees += delta.amount;
        if (delta.to !== FEE_BUCKET_ADDRESS) {
          row.unaccounted += delta.amount;
        }
        break;
      case "loss":
        row.losses += delta.amount;
        if (delta.to !== LOSS_BUCKET_ADDRESS) {
          row.unaccounted += delta.amount;
        }
        break;
      default:
        row.unaccounted += delta.amount;
    }
  }

  const assets = Array.from(rows.values()).sort((a, b) => a.asset.localeCompare(b.asset));
  const totalUnaccounted = assets.reduce((sum, item) => sum + item.unaccounted, 0n);

  return {
    assets,
    totalUnaccounted,
    passed: totalUnaccounted === 0n,
  };
}

export function buildDriftKeys(plannedActions: PlannedAction[]): DriftKey[] {
  const now = Date.now();
  const keys: DriftKey[] = [];
  const seen = new Set<string>();

  const addKey = (key: DriftKey): void => {
    if (seen.has(key.field)) return;
    seen.add(key.field);
    keys.push(key);
  };

  for (const planned of plannedActions) {
    const outputAsset = planned.simulationResult?.output.asset;
    const outputAmount = toBigInt(planned.simulationResult?.output.amount);
    if (outputAsset && outputAmount !== undefined) {
      addKey({
        field: `quote:${planned.stepId}:${outputAsset}`,
        class: "quote",
        previewValue: outputAmount,
        timestamp: now,
        source: "preview_simulation",
      });
    }

    const gasEstimate = toBigInt(planned.simulationResult?.gasEstimate);
    if (gasEstimate !== undefined) {
      addKey({
        field: `gas:${planned.stepId}`,
        class: "gas",
        previewValue: gasEstimate,
        timestamp: now,
        source: "preview_simulation",
      });
    }
  }

  return keys;
}

function classifyDelta(reason: string): "debit" | "credit" | "fee" | "loss" | "unknown" {
  const normalized = reason.toLowerCase();
  if (normalized.includes("fee")) return "fee";
  if (normalized.includes("loss") || normalized.includes("slippage")) return "loss";
  if (
    normalized.includes(":input") ||
    normalized.includes("debit") ||
    normalized.includes("bridge_out") ||
    normalized.includes("outflow")
  ) {
    return "debit";
  }
  if (
    normalized.includes(":output") ||
    normalized.includes("credit") ||
    normalized.includes("bridge_in") ||
    normalized.includes("inflow")
  ) {
    return "credit";
  }
  return "unknown";
}

function readMandateLimits(ctx: ExecutionContext): MandateLimits {
  return {
    maxSingleMove: toBigInt(readLimit(ctx, "max_single_move")),
    approvalRequiredAbove: toBigInt(readLimit(ctx, "approval_required_above")),
    maxValueAtRisk: toBigInt(readLimit(ctx, "max_value_at_risk")),
    maxSlippage: toFiniteNumber(readLimit(ctx, "max_slippage")),
    maxGas: toBigInt(readLimit(ctx, "max_gas")),
    allowedVenues: toStringSet(readLimit(ctx, "allowed_venues")),
    rebalanceCooldownSec: toFiniteNumber(readLimit(ctx, "rebalance_cooldown")),
  };
}

function readLimit(ctx: ExecutionContext, key: string): unknown {
  const limitsBinding = ctx.bindings.get("limits");
  if (isRecord(limitsBinding) && key in limitsBinding) {
    return limitsBinding[key];
  }
  return ctx.bindings.get(`limit_${key}`);
}

function readLastRebalanceTimestampMs(ctx: ExecutionContext): number | undefined {
  const candidates = [
    "last_rebalance",
    "last_rebalance_at",
    "last_rebalance_ts",
    "lastRebalance",
    "lastRebalanceAt",
    "lastRebalanceTs",
  ];

  for (const key of candidates) {
    const value = ctx.state.persistent.get(key);
    const parsed = toTimestampMs(value);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  return undefined;
}

function toTimestampMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? Math.floor(value) : Math.floor(value * 1000);
  }

  if (typeof value === "bigint") {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) {
      return asNumber > 1_000_000_000_000 ? Math.floor(asNumber) : Math.floor(asNumber * 1000);
    }
    return undefined;
  }

  if (typeof value === "string") {
    if (/^-?\d+$/.test(value.trim())) {
      const numeric = Number(value.trim());
      if (!Number.isFinite(numeric)) return undefined;
      return numeric > 1_000_000_000_000 ? Math.floor(numeric) : Math.floor(numeric * 1000);
    }

    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function toBigInt(value: unknown): bigint | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return undefined;
    return BigInt(Math.floor(value));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^[-+]?\d+$/.test(trimmed)) return undefined;
    try {
      return BigInt(trimmed);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") {
    const asNumber = Number(value);
    return Number.isFinite(asNumber) ? asNumber : undefined;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function toStringSet(value: unknown): Set<string> | undefined {
  if (Array.isArray(value)) {
    const items = value.filter((item): item is string => typeof item === "string");
    if (!items.length) return undefined;
    return new Set(items);
  }

  if (typeof value === "string") {
    const parts = value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (!parts.length) return undefined;
    return new Set(parts);
  }

  return undefined;
}

function extractActionAmount(action: Action): bigint | undefined {
  if (!("amount" in action)) return undefined;
  const raw = action.amount;
  if (raw === undefined || raw === null || raw === "max") return undefined;

  if (typeof raw === "bigint") return raw;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return undefined;
    return BigInt(Math.floor(raw));
  }
  if (typeof raw === "string") {
    return toBigInt(raw);
  }

  return undefined;
}

function extractRiskAsset(action: Action): string | undefined {
  switch (action.type) {
    case "swap":
      return action.assetIn;
    case "lend":
    case "withdraw":
    case "borrow":
    case "repay":
    case "stake":
    case "unstake":
    case "bridge":
    case "transfer":
    case "approve":
      return action.asset;
    default:
      return undefined;
  }
}

function getConstraintPath(ctx: ExecutionContext, stepId: string): string {
  const loc = ctx.spell.sourceMap?.[stepId];
  if (!loc) return stepId;
  return `${stepId} (line ${loc.line}, col ${loc.column})`;
}

function maxBigInt(a: bigint | undefined, b: bigint | undefined): bigint | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return a > b ? a : b;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function inferDriftClass(field: string): DriftClass | undefined {
  if (field.startsWith("balance:")) return "balance";
  if (field.startsWith("quote:")) return "quote";
  if (field.startsWith("rate:")) return "rate";
  if (field.startsWith("gas:")) return "gas";
  return undefined;
}
