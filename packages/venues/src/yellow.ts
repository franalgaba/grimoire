import type {
  Action,
  CustomAction,
  CustomActionValue,
  OffchainExecutionResult,
  VenueAdapter,
} from "@grimoirelabs/core";
import { zeroAddress } from "viem";

export interface YellowAdapterConfig {
  rpcUrl?: string;
  appId?: string;
  chainId?: number;
  fetch?: typeof fetch;
}

type YellowOp = "session_open" | "session_update" | "session_close_settle" | "session_transfer";
type YellowIntent = "operate" | "deposit" | "withdraw";

interface YellowSessionState {
  version: number;
  signers: string[];
  quorum: number;
}

interface YellowNormalizedRequest {
  op: YellowOp;
  sessionId: string;
  version: number;
  intent?: YellowIntent;
  allocations?: YellowAllocation[];
  signatures: string[];
  signers: string[];
  quorum: number;
  raw: Record<string, unknown>;
}

interface YellowAllocation {
  account: string;
  amount: string;
}

const ALLOWED_INTENTS = new Set<YellowIntent>(["operate", "deposit", "withdraw"]);
const YELLOW_OPS = new Set<YellowOp>([
  "session_open",
  "session_update",
  "session_close_settle",
  "session_transfer",
]);

export function createYellowAdapter(config: YellowAdapterConfig = {}): VenueAdapter {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const rpcUrl = config.rpcUrl ?? process.env.YELLOW_RPC_URL;
  const appId = config.appId ?? process.env.YELLOW_APP_ID;
  const configuredChainId = resolveChainId(config.chainId, process.env.YELLOW_CHAIN_ID);
  const sessions = new Map<string, YellowSessionState>();

  const callRpc = async (method: string, params: unknown[]): Promise<unknown> => {
    if (!rpcUrl) {
      throw new Error("Yellow adapter requires YELLOW_RPC_URL");
    }
    if (!fetchImpl) {
      throw new Error("Yellow adapter requires fetch support");
    }

    const payload = {
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    };

    const response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Yellow RPC ${method} failed (${response.status})`);
    }

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Yellow RPC ${method} returned invalid JSON`);
    }

    if (isRecord(data) && "error" in data && data.error !== null && data.error !== undefined) {
      throw new Error(`Yellow RPC ${method} error: ${formatRpcError(data.error)}`);
    }

    if (isRecord(data) && "result" in data) {
      return data.result;
    }

    return data;
  };

  return {
    meta: {
      name: "yellow",
      supportedChains: configuredChainId ? [configuredChainId] : [1],
      actions: ["custom"],
      description: "Yellow NitroRPC app-session adapter",
      executionType: "offchain",
    },
    async buildAction(action: Action) {
      const req = normalizeYellowAction(action, sessions, { appId });
      return {
        tx: { to: zeroAddress, data: "0x", value: 0n },
        description: `Yellow ${req.op} session ${req.sessionId} v${req.version}`,
        action,
      };
    },
    async executeAction(action: Action): Promise<OffchainExecutionResult> {
      const req = normalizeYellowAction(action, sessions, { appId });

      if (req.op === "session_open") {
        const payload = {
          ...req.raw,
          session_id: req.sessionId,
          version: req.version,
          app_id: req.raw.app_id ?? appId,
          signers: req.signers,
          quorum: req.quorum,
        };
        const result = await callRpc("create_app_session", [payload]);
        sessions.set(req.sessionId, {
          version: req.version,
          signers: req.signers,
          quorum: req.quorum,
        });
        return {
          id: extractExecutionId(result, req.sessionId),
          status: "submitted",
          raw: result,
        };
      }

      if (req.op === "session_close_settle") {
        if (!sessions.has(req.sessionId)) {
          throw new Error(`Yellow session '${req.sessionId}' is not open`);
        }
        const payload = {
          ...req.raw,
          session_id: req.sessionId,
          app_id: req.raw.app_id ?? appId,
        };
        const result = await callRpc("close_app_session", [payload]);
        sessions.delete(req.sessionId);
        return {
          id: extractExecutionId(result, req.sessionId),
          status: "submitted",
          raw: result,
        };
      }

      const payload = {
        ...req.raw,
        session_id: req.sessionId,
        version: req.version,
        intent: req.intent,
        allocations: req.allocations,
        signatures: req.signatures,
      };
      const result = await callRpc("submit_app_state", [payload]);
      sessions.set(req.sessionId, {
        version: req.version,
        signers: req.signers,
        quorum: req.quorum,
      });
      return {
        id: extractExecutionId(result, req.sessionId),
        status: "submitted",
        raw: result,
      };
    },
  };
}

export const yellowAdapter = createYellowAdapter();

function normalizeYellowAction(
  action: Action,
  sessions: Map<string, YellowSessionState>,
  defaults: { appId?: string }
): YellowNormalizedRequest {
  const custom = asYellowCustomAction(action);
  const raw = extractRawArgs(custom);
  const arg0 = raw.arg0;
  const payload = isRecord(arg0) ? { ...arg0 } : raw;
  const op = custom.op as YellowOp;

  const sessionId = normalizeSessionId(payload);
  const state = sessions.get(sessionId);

  const signers = asStringArray(payload.signers);
  const requestedQuorum = toNumber(payload.quorum);
  const quorum = requestedQuorum ?? state?.quorum ?? signers.length;
  if (quorum < 0) {
    throw new Error("Yellow session quorum must be >= 0");
  }
  if (signers.length > 0 && quorum > signers.length) {
    throw new Error("Yellow session quorum exceeds signer count");
  }

  if (op === "session_open") {
    if (sessions.has(sessionId)) {
      throw new Error(`Yellow session '${sessionId}' is already open`);
    }
    const version = toNumber(payload.version ?? payload.v) ?? 1;
    if (version < 1) {
      throw new Error("Yellow session version must start at 1");
    }
    return {
      op,
      sessionId,
      version,
      signatures: asStringArray(payload.signatures),
      signers,
      quorum,
      raw: withAppId(payload, defaults.appId),
    };
  }

  if (!state) {
    throw new Error(`Yellow session '${sessionId}' is not open`);
  }

  if (op === "session_close_settle") {
    return {
      op,
      sessionId,
      version: state.version,
      signatures: asStringArray(payload.signatures),
      signers: state.signers,
      quorum: state.quorum,
      raw: withAppId(payload, defaults.appId),
    };
  }

  const expectedVersion = state.version + 1;
  const version = toNumber(payload.version ?? payload.v) ?? expectedVersion;
  if (version !== expectedVersion) {
    throw new Error(
      `Yellow session version must increment by 1 (expected ${expectedVersion}, got ${version})`
    );
  }

  const signatures = asStringArray(payload.signatures);
  const effectiveSigners = state.signers.length > 0 ? state.signers : signers;
  const effectiveQuorum = state.quorum > 0 ? state.quorum : quorum;
  enforceQuorum(signatures, effectiveSigners, effectiveQuorum);

  if (op === "session_transfer") {
    const to = asString(payload.to ?? payload.account ?? payload.recipient, "transfer target");
    const amount = String(payload.amount ?? payload.value ?? "");
    if (!amount || amount === "0") {
      throw new Error("Yellow session_transfer requires a non-zero amount");
    }
    const intent = normalizeIntent(payload.intent ?? "operate");
    const allocations: YellowAllocation[] = [{ account: to, amount }];
    return {
      op,
      sessionId,
      version,
      intent,
      allocations,
      signatures,
      signers: effectiveSigners,
      quorum: effectiveQuorum,
      raw: payload,
    };
  }

  const intent = normalizeIntent(payload.intent);
  const allocations = normalizeAllocations(payload.allocations);

  return {
    op,
    sessionId,
    version,
    intent,
    allocations,
    signatures,
    signers: effectiveSigners,
    quorum: effectiveQuorum,
    raw: payload,
  };
}

function asYellowCustomAction(action: Action): CustomAction {
  if (action.type !== "custom") {
    throw new Error(`Yellow adapter only supports custom actions (got ${action.type})`);
  }
  if (!YELLOW_OPS.has(action.op as YellowOp)) {
    throw new Error(`Yellow adapter does not support op '${action.op}'`);
  }
  return action;
}

function extractRawArgs(action: CustomAction): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(action.args)) {
    out[key] = materializeCustomValue(value);
  }
  return out;
}

function materializeCustomValue(value: CustomActionValue): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => materializeCustomValue(entry));
  }

  if (isRecord(value)) {
    if (isLiteralExpression(value)) {
      return value.value;
    }
    if (isExpressionNode(value)) {
      throw new Error("Yellow adapter received unresolved custom expression args");
    }
    const nested: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      nested[key] = materializeCustomValue(entry as CustomActionValue);
    }
    return nested;
  }

  return value;
}

function normalizeSessionId(payload: Record<string, unknown>): string {
  const value = payload.session_id ?? payload.sessionId ?? payload.id ?? payload.arg0;
  return asString(value, "session_id");
}

function normalizeIntent(value: unknown): YellowIntent {
  const intent = asString(value, "intent") as YellowIntent;
  if (!ALLOWED_INTENTS.has(intent)) {
    throw new Error(`Yellow intent must be one of operate|deposit|withdraw (got '${intent}')`);
  }
  return intent;
}

function normalizeAllocations(value: unknown): YellowAllocation[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Yellow allocations must be a non-empty array");
  }

  return value.map((entry, idx) => {
    if (!isRecord(entry)) {
      throw new Error(`Yellow allocation ${idx} must be an object`);
    }
    const account = asString(entry.account ?? entry.address, `allocations[${idx}].account`);
    const amount = String(entry.amount ?? "");
    if (!amount || amount === "0") {
      throw new Error(`Yellow allocation ${idx} must include a non-zero amount`);
    }
    return { account, amount };
  });
}

function enforceQuorum(signatures: string[], signers: string[], quorum: number): void {
  if (quorum <= 0) return;
  if (signatures.length < quorum) {
    throw new Error(`Yellow signatures do not satisfy quorum (${signatures.length}/${quorum})`);
  }
  if (signers.length > 0) {
    for (const signer of signatures) {
      if (!signers.includes(signer)) {
        throw new Error(`Yellow signature '${signer}' is not part of the signer set`);
      }
    }
  }
}

function withAppId(payload: Record<string, unknown>, appId?: string): Record<string, unknown> {
  if (!appId || payload.app_id !== undefined) {
    return payload;
  }
  return { ...payload, app_id: appId };
}

function resolveChainId(primary?: number, envValue?: string): number | undefined {
  if (typeof primary === "number" && Number.isFinite(primary)) {
    return Math.floor(primary);
  }
  if (!envValue) return undefined;
  const parsed = Number.parseInt(envValue, 10);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

function extractExecutionId(result: unknown, fallback: string): string {
  if (isRecord(result)) {
    const direct =
      result.id ??
      result.tx_hash ??
      result.txHash ??
      result.session_id ??
      result.sessionId ??
      result.hash;
    if (typeof direct === "string" && direct.length > 0) {
      return direct;
    }
  }
  return fallback;
}

function formatRpcError(error: unknown): string {
  if (isRecord(error)) {
    const message = error.message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }
  return String(error);
}

function asString(value: unknown, field: string): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  throw new Error(`Yellow ${field} is required`);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLiteralExpression(value: Record<string, unknown>): value is {
  kind: "literal";
  value: unknown;
} {
  return value.kind === "literal" && "value" in value;
}

function isExpressionNode(value: Record<string, unknown>): boolean {
  const kind = value.kind;
  return (
    kind === "literal" ||
    kind === "param" ||
    kind === "state" ||
    kind === "binding" ||
    kind === "item" ||
    kind === "index" ||
    kind === "binary" ||
    kind === "unary" ||
    kind === "ternary" ||
    kind === "call" ||
    kind === "array_access" ||
    kind === "property_access"
  );
}
