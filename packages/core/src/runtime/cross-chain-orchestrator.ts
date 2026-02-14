/**
 * Phase 1 cross-chain orchestration for two-spell continuation flows.
 *
 * No DSL changes are required in this phase. The orchestrator runs:
 * source spell -> bridge handoff lifecycle -> destination spell.
 */

import type {
  BridgeLifecycleStatusResult,
  CrossChainHandoffReceiptEntry,
  CrossChainHandoffStatus,
  CrossChainReceipt,
  CrossChainTrackReceiptEntry,
  CrossChainTrackStatus,
} from "../types/cross-chain.js";
import type { ExecutionResult, LedgerEvent } from "../types/execution.js";
import type { Address, ChainId } from "../types/primitives.js";
import type { PlannedAction } from "../types/receipt.js";

export interface CrossChainOrchestrationOptions {
  runId: string;
  sourceSpellId: string;
  destinationSpellId: string;
  sourceChainId: ChainId;
  destinationChainId: ChainId;
  vault: Address;
  sourceParams?: Record<string, unknown>;
  destinationParams?: Record<string, unknown>;
  mode: "simulate" | "dry-run" | "execute";
  watch?: boolean;
  handoffTimeoutSec: number;
  pollIntervalSec?: number;
  executeSource: () => Promise<ExecutionResult>;
  executeDestination: (params: Record<string, unknown>) => Promise<ExecutionResult>;
  resolveHandoffStatus?: (
    handoff: CrossChainHandoffReceiptEntry
  ) => Promise<BridgeLifecycleStatusResult>;
  onLifecycleEvent?: (event: LedgerEvent) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface CrossChainOrchestrationResult {
  success: boolean;
  pending: boolean;
  runId: string;
  sourceResult?: ExecutionResult;
  destinationResult?: ExecutionResult;
  tracks: CrossChainTrackReceiptEntry[];
  handoffs: CrossChainHandoffReceiptEntry[];
  error?: string;
}

const DEFAULT_POLL_INTERVAL_SEC = 30;

export async function orchestrateCrossChain(
  options: CrossChainOrchestrationOptions
): Promise<CrossChainOrchestrationResult> {
  const now = options.now ?? (() => Date.now());
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const pollIntervalSec = options.pollIntervalSec ?? DEFAULT_POLL_INTERVAL_SEC;
  const sourceTrackId = "source";
  const destinationTrackId = "destination";
  const sourceParams = options.sourceParams ?? {};
  const destinationBaseParams = options.destinationParams ?? {};
  rejectReservedCrossChainParams(sourceParams, "source");
  rejectReservedCrossChainParams(destinationBaseParams, "destination");

  const tracks: CrossChainTrackReceiptEntry[] = [
    {
      trackId: sourceTrackId,
      role: "source",
      spellId: options.sourceSpellId,
      chainId: options.sourceChainId,
      status: "running",
    },
    {
      trackId: destinationTrackId,
      role: "destination",
      spellId: options.destinationSpellId,
      chainId: options.destinationChainId,
      status: "pending",
    },
  ];
  const handoffs: CrossChainHandoffReceiptEntry[] = [];

  const sourceResult = await options.executeSource();
  if (!sourceResult.success) {
    setTrackStatus(tracks, sourceTrackId, "failed", sourceResult.error);
    setTrackStatus(tracks, destinationTrackId, "failed", "source_failed");
    return {
      success: false,
      pending: false,
      runId: options.runId,
      sourceResult,
      tracks,
      handoffs,
      error: sourceResult.error ?? "Source track failed",
    };
  }
  setTrackStatus(tracks, sourceTrackId, "completed");

  const handoff = deriveHandoff({
    runId: options.runId,
    sourceResult,
    sourceTrackId,
    destinationTrackId,
    sourceChainId: options.sourceChainId,
    destinationChainId: options.destinationChainId,
    mode: options.mode,
  });
  if (!handoff) {
    setTrackStatus(tracks, destinationTrackId, "failed", "missing_bridge_handoff");
    return {
      success: false,
      pending: false,
      runId: options.runId,
      sourceResult,
      tracks,
      handoffs,
      error: "Cross-chain orchestration requires at least one bridge action in source spell",
    };
  }

  handoffs.push(handoff);
  options.onLifecycleEvent?.({
    type: "handoff_submitted",
    runId: options.runId,
    handoffId: handoff.handoffId,
    trackId: sourceTrackId,
    stepId: handoff.sourceStepId,
    originChainId: handoff.originChainId,
    destinationChainId: handoff.destinationChainId,
    asset: handoff.asset,
    submittedAmount: handoff.submittedAmount.toString(),
    reference: handoff.reference,
    txHash: handoff.originTxHash,
  });

  if (options.mode === "simulate" || options.mode === "dry-run") {
    const estimatedSettledAmount = estimateDryRunSettledAmount(handoff, sourceResult);
    handoff.status = "settled";
    handoff.settledAmount = estimatedSettledAmount;
    options.onLifecycleEvent?.({
      type: "handoff_settled",
      runId: options.runId,
      handoffId: handoff.handoffId,
      trackId: destinationTrackId,
      originChainId: handoff.originChainId,
      destinationChainId: handoff.destinationChainId,
      settledAmount: estimatedSettledAmount.toString(),
      reference: handoff.reference,
    });

    const destinationParams = injectHandoffParams(destinationBaseParams, handoff);
    options.onLifecycleEvent?.({
      type: "track_resumed",
      runId: options.runId,
      trackId: destinationTrackId,
      chainId: options.destinationChainId,
    });
    setTrackStatus(tracks, destinationTrackId, "running");
    const destinationResult = await options.executeDestination(destinationParams);
    if (!destinationResult.success) {
      setTrackStatus(tracks, destinationTrackId, "failed", destinationResult.error);
      return {
        success: false,
        pending: false,
        runId: options.runId,
        sourceResult,
        destinationResult,
        tracks,
        handoffs,
        error: destinationResult.error ?? "Destination track failed",
      };
    }
    setTrackStatus(tracks, destinationTrackId, "completed");
    options.onLifecycleEvent?.({
      type: "track_completed",
      runId: options.runId,
      trackId: destinationTrackId,
      chainId: options.destinationChainId,
      success: true,
    });

    return {
      success: true,
      pending: false,
      runId: options.runId,
      sourceResult,
      destinationResult,
      tracks,
      handoffs,
    };
  }

  setTrackStatus(tracks, destinationTrackId, "waiting");
  options.onLifecycleEvent?.({
    type: "track_waiting",
    runId: options.runId,
    trackId: destinationTrackId,
    chainId: options.destinationChainId,
    reason: "waiting_for_handoff_settlement",
  });

  if (!options.watch) {
    return {
      success: true,
      pending: true,
      runId: options.runId,
      sourceResult,
      tracks,
      handoffs,
    };
  }

  if (!options.resolveHandoffStatus) {
    setTrackStatus(tracks, destinationTrackId, "failed", "missing_handoff_resolver");
    handoff.status = "failed";
    handoff.reason = "No handoff lifecycle resolver is configured for bridge status polling";
    return {
      success: false,
      pending: false,
      runId: options.runId,
      sourceResult,
      tracks,
      handoffs,
      error: handoff.reason,
    };
  }

  const startedAt = now();
  for (;;) {
    const elapsedSec = Math.floor((now() - startedAt) / 1000);
    if (elapsedSec > options.handoffTimeoutSec) {
      handoff.status = "expired";
      handoff.reason = `Handoff settlement timed out after ${options.handoffTimeoutSec} seconds`;
      setTrackStatus(tracks, destinationTrackId, "failed", handoff.reason);
      options.onLifecycleEvent?.({
        type: "handoff_expired",
        runId: options.runId,
        handoffId: handoff.handoffId,
        trackId: destinationTrackId,
        originChainId: handoff.originChainId,
        destinationChainId: handoff.destinationChainId,
        reason: handoff.reason,
      });
      return {
        success: false,
        pending: false,
        runId: options.runId,
        sourceResult,
        tracks,
        handoffs,
        error: handoff.reason,
      };
    }

    const status = await options.resolveHandoffStatus(handoff);
    if (status.status === "settled") {
      handoff.status = "settled";
      handoff.reference = status.reference ?? handoff.reference;
      handoff.settledAmount = status.settledAmount ?? handoff.submittedAmount;
      options.onLifecycleEvent?.({
        type: "handoff_settled",
        runId: options.runId,
        handoffId: handoff.handoffId,
        trackId: destinationTrackId,
        originChainId: handoff.originChainId,
        destinationChainId: handoff.destinationChainId,
        settledAmount: handoff.settledAmount.toString(),
        reference: handoff.reference,
      });
      break;
    }

    if (status.status === "failed" || status.status === "expired") {
      handoff.status = status.status === "failed" ? "failed" : "expired";
      handoff.reason = status.reason ?? "Bridge handoff failed";
      handoff.reference = status.reference ?? handoff.reference;
      setTrackStatus(tracks, destinationTrackId, "failed", handoff.reason);
      if (handoff.status === "expired") {
        options.onLifecycleEvent?.({
          type: "handoff_expired",
          runId: options.runId,
          handoffId: handoff.handoffId,
          trackId: destinationTrackId,
          originChainId: handoff.originChainId,
          destinationChainId: handoff.destinationChainId,
          reason: handoff.reason,
        });
      }
      return {
        success: false,
        pending: false,
        runId: options.runId,
        sourceResult,
        tracks,
        handoffs,
        error: handoff.reason,
      };
    }

    await sleep(Math.max(1, pollIntervalSec) * 1000);
  }

  options.onLifecycleEvent?.({
    type: "track_resumed",
    runId: options.runId,
    trackId: destinationTrackId,
    chainId: options.destinationChainId,
  });
  setTrackStatus(tracks, destinationTrackId, "running");

  const destinationParams = injectHandoffParams(destinationBaseParams, handoff);
  const destinationResult = await options.executeDestination(destinationParams);
  if (!destinationResult.success) {
    setTrackStatus(tracks, destinationTrackId, "failed", destinationResult.error);
    return {
      success: false,
      pending: false,
      runId: options.runId,
      sourceResult,
      destinationResult,
      tracks,
      handoffs,
      error: destinationResult.error ?? "Destination track failed",
    };
  }

  setTrackStatus(tracks, destinationTrackId, "completed");
  options.onLifecycleEvent?.({
    type: "track_completed",
    runId: options.runId,
    trackId: destinationTrackId,
    chainId: options.destinationChainId,
    success: true,
  });

  return {
    success: true,
    pending: false,
    runId: options.runId,
    sourceResult,
    destinationResult,
    tracks,
    handoffs,
  };
}

export function toCrossChainReceipt(input: {
  runId: string;
  sourceSpellId: string;
  destinationSpellId: string;
  sourceChainId: ChainId;
  destinationChainId: ChainId;
  tracks: CrossChainTrackReceiptEntry[];
  handoffs: CrossChainHandoffReceiptEntry[];
}): CrossChainReceipt {
  return {
    runId: input.runId,
    sourceSpellId: input.sourceSpellId,
    destinationSpellId: input.destinationSpellId,
    sourceChainId: input.sourceChainId,
    destinationChainId: input.destinationChainId,
    tracks: input.tracks,
    handoffs: input.handoffs,
  };
}

export function injectHandoffParams(
  destinationParams: Record<string, unknown>,
  handoff: CrossChainHandoffReceiptEntry
): Record<string, unknown> {
  rejectReservedCrossChainParams(destinationParams, "destination");
  return {
    ...destinationParams,
    __cross_chain: {
      handoff: {
        id: handoff.handoffId,
        origin_chain_id: handoff.originChainId,
        destination_chain_id: handoff.destinationChainId,
        asset: handoff.asset,
        submitted_amount: handoff.submittedAmount.toString(),
        settled_amount: (handoff.settledAmount ?? handoff.submittedAmount).toString(),
        status: handoff.status,
        reference: handoff.reference,
      },
    },
  };
}

export function rejectReservedCrossChainParams(
  params: Record<string, unknown>,
  role: "source" | "destination"
): void {
  if ("__cross_chain" in params) {
    throw new Error(
      `Invalid ${role} params: reserved key '__cross_chain' is managed by the cross-chain orchestrator`
    );
  }
}

function setTrackStatus(
  tracks: CrossChainTrackReceiptEntry[],
  trackId: string,
  status: CrossChainTrackStatus,
  error?: string
): void {
  const track = tracks.find((entry) => entry.trackId === trackId);
  if (!track) return;
  track.status = status;
  track.error = error;
}

function deriveHandoff(input: {
  runId: string;
  sourceResult: ExecutionResult;
  sourceTrackId: string;
  destinationTrackId: string;
  sourceChainId: ChainId;
  destinationChainId: ChainId;
  mode: "simulate" | "dry-run" | "execute";
}): CrossChainHandoffReceiptEntry | null {
  const bridge = input.sourceResult.receipt?.plannedActions.find(
    (action) => action.action.type === "bridge"
  );
  if (!bridge) {
    return null;
  }

  const asset =
    "asset" in bridge.action && typeof bridge.action.asset === "string"
      ? bridge.action.asset
      : "UNKNOWN";
  const submittedAmount = resolveBridgeSubmittedAmount(bridge);
  const tx = input.sourceResult.commit?.transactions.find((tx) => tx.stepId === bridge.stepId);
  const handoffId = `handoff:${bridge.stepId}`;
  const status: CrossChainHandoffStatus =
    input.mode === "simulate" || input.mode === "dry-run" ? "planned" : "submitted";

  return {
    handoffId,
    sourceTrackId: input.sourceTrackId,
    destinationTrackId: input.destinationTrackId,
    sourceStepId: bridge.stepId,
    originChainId: input.sourceChainId,
    destinationChainId: input.destinationChainId,
    asset,
    submittedAmount,
    status,
    reference: tx?.hash,
    originTxHash: tx?.hash,
  };
}

function estimateDryRunSettledAmount(
  handoff: CrossChainHandoffReceiptEntry,
  sourceResult: ExecutionResult
): bigint {
  const plannedBridge = sourceResult.receipt?.plannedActions.find(
    (action) => action.stepId === handoff.sourceStepId
  );
  const minOutput = plannedBridge?.constraints.minOutput;
  if (typeof minOutput === "bigint" && minOutput > 0n) {
    return minOutput;
  }
  const simulatedOut = plannedBridge?.simulationResult?.output.amount;
  if (simulatedOut) {
    try {
      return BigInt(simulatedOut);
    } catch {
      return handoff.submittedAmount;
    }
  }
  return handoff.submittedAmount;
}

function resolveBridgeSubmittedAmount(bridge: PlannedAction): bigint {
  const raw = "amount" in bridge.action ? bridge.action.amount : undefined;
  if (typeof raw === "bigint") {
    return raw;
  }
  if (typeof raw === "number") {
    return BigInt(Math.floor(raw));
  }
  if (typeof raw === "string") {
    try {
      return BigInt(raw);
    } catch {
      return 0n;
    }
  }
  if (raw && typeof raw === "object" && "kind" in raw && "value" in raw) {
    const value = (raw as { value?: unknown }).value;
    if (typeof value === "bigint") return value;
    if (typeof value === "number") return BigInt(Math.floor(value));
    if (typeof value === "string") {
      try {
        return BigInt(value);
      } catch {
        return 0n;
      }
    }
  }
  return 0n;
}
