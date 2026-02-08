import type {
  Action,
  BuiltTransaction,
  CustomAction,
  CustomActionValue,
  OffchainExecutionResult,
  VenueAdapter,
  VenueAdapterContext,
} from "@grimoirelabs/core";
import { isAddress, zeroAddress } from "viem";

export interface LifiAdapterConfig {
  apiUrl?: string;
  apiKey?: string;
  integrator?: string;
  fetch?: typeof fetch;
}

interface LifiPlan {
  kind: "swap" | "bridge" | "compose_execute";
  request: Record<string, unknown>;
  quote: Record<string, unknown>;
  description: string;
}

const DEFAULT_LIFI_API = "https://li.quest/v1";
const DEFAULT_SUPPORTED_CHAINS = [1, 10, 56, 100, 137, 250, 324, 42161, 43114, 59144, 8453];

export function createLifiAdapter(config: LifiAdapterConfig = {}): VenueAdapter {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const apiUrl = (config.apiUrl ?? process.env.LIFI_API_URL ?? DEFAULT_LIFI_API).replace(/\/$/, "");
  const apiKey = config.apiKey ?? process.env.LIFI_API_KEY;
  const integrator = config.integrator ?? process.env.LIFI_INTEGRATOR;

  const requestJson = async (
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>
  ): Promise<Record<string, unknown>> => {
    if (!fetchImpl) {
      throw new Error("LI.FI adapter requires fetch support");
    }

    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (apiKey) headers["x-lifi-api-key"] = apiKey;
    if (integrator) headers["x-lifi-integrator"] = integrator;

    const response = await fetchImpl(`${apiUrl}${path}`, {
      method,
      headers,
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    });

    const text = await response.text();
    let data: unknown = {};
    if (text.length > 0) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`LI.FI ${method} ${path} returned invalid JSON`);
      }
    }

    if (!response.ok) {
      const message = extractErrorMessage(data) ?? `status ${response.status}`;
      throw new Error(`LI.FI ${method} ${path} failed: ${message}`);
    }

    if (!isRecord(data)) {
      return {};
    }
    return data;
  };

  return {
    meta: {
      name: "lifi",
      supportedChains: DEFAULT_SUPPORTED_CHAINS,
      actions: ["swap", "bridge", "custom"],
      description: "LI.FI routing adapter for swap/bridge flows",
      executionType: "offchain",
    },
    async buildAction(action: Action, ctx: VenueAdapterContext): Promise<BuiltTransaction> {
      const plan = await buildPlan(action, ctx, requestJson);
      return {
        tx: { to: zeroAddress, data: "0x", value: 0n },
        description: plan.description,
        action,
      };
    },
    async executeAction(
      action: Action,
      ctx: VenueAdapterContext
    ): Promise<OffchainExecutionResult> {
      const plan = await buildPlan(action, ctx, requestJson);
      const executePayload = { route: plan.quote };
      const execution = await requestJson("POST", "/execute", executePayload);

      const executionId = extractExecutionId(execution) ?? `lifi-${Date.now()}`;
      const status = await safeRequestStatus(requestJson, executionId);

      return {
        id: executionId,
        status: extractStatus(execution) ?? extractStatus(status) ?? "submitted",
        raw: {
          request: plan.request,
          quote: plan.quote,
          execution,
          status,
        },
      };
    },
  };
}

export const lifiAdapter = createLifiAdapter();

async function buildPlan(
  action: Action,
  ctx: VenueAdapterContext,
  requestJson: (
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>
  ) => Promise<Record<string, unknown>>
): Promise<LifiPlan> {
  if (action.type === "swap") {
    const amount = toBigInt(action.amount);
    const request = {
      fromChainId: ctx.chainId,
      toChainId: ctx.chainId,
      fromToken: action.assetIn,
      toToken: action.assetOut,
      fromAmount: amount.toString(),
      fromAddress: ctx.walletAddress,
    };
    const quote = await requestJson("POST", "/quote", request);
    enforceConstraints(action.constraints, quote);
    return {
      kind: "swap",
      request,
      quote,
      description: `LI.FI swap ${action.assetIn} -> ${action.assetOut}`,
    };
  }

  if (action.type === "bridge") {
    if (typeof action.toChain !== "number") {
      throw new Error("LI.FI bridge action requires numeric toChain");
    }
    const amount = toBigInt(action.amount);
    const request = {
      fromChainId: ctx.chainId,
      toChainId: action.toChain,
      fromToken: action.asset,
      toToken: action.asset,
      fromAmount: amount.toString(),
      fromAddress: ctx.walletAddress,
      toAddress: ctx.walletAddress,
    };
    const quote = await requestJson("POST", "/routes", request);
    enforceConstraints(action.constraints, quote);
    return {
      kind: "bridge",
      request,
      quote,
      description: `LI.FI bridge ${action.asset} ${ctx.chainId} -> ${action.toChain}`,
    };
  }

  if (action.type === "custom") {
    const custom = asComposeExecuteAction(action);
    const args = materializeArgs(custom.args);
    const rawRequest = args.routeRequest ?? args.request ?? args.arg0;
    if (!isRecord(rawRequest)) {
      throw new Error("LI.FI compose_execute requires args.routeRequest (object)");
    }
    const request = normalizeComposeExecuteRequest(rawRequest, ctx.walletAddress);
    const quote = await requestJson("POST", "/routes", request);
    enforceConstraints(action.constraints, quote);
    return {
      kind: "compose_execute",
      request,
      quote,
      description: "LI.FI compose_execute route",
    };
  }

  throw new Error(
    `LI.FI adapter only supports swap, bridge, or custom compose_execute (got ${action.type})`
  );
}

function enforceConstraints(
  constraints: Action["constraints"],
  payload: Record<string, unknown>
): void {
  if (!constraints) return;

  const output = extractAmountOut(payload);
  if (
    constraints.minOutput !== undefined &&
    output !== undefined &&
    output < constraints.minOutput
  ) {
    throw new Error(
      `LI.FI quote output ${output.toString()} below min_output ${constraints.minOutput.toString()}`
    );
  }

  const slippageBps = extractSlippageBps(payload);
  if (
    constraints.maxSlippageBps !== undefined &&
    slippageBps !== undefined &&
    slippageBps > constraints.maxSlippageBps
  ) {
    throw new Error(
      `LI.FI slippage ${slippageBps} bps exceeds max_slippage ${constraints.maxSlippageBps}`
    );
  }

  const gas = extractGasEstimate(payload);
  if (constraints.maxGas !== undefined && gas !== undefined && gas > constraints.maxGas) {
    throw new Error(
      `LI.FI gas estimate ${gas.toString()} exceeds max_gas ${constraints.maxGas.toString()}`
    );
  }
}

function extractAmountOut(payload: Record<string, unknown>): bigint | undefined {
  const candidates = [
    getPath(payload, ["toAmount"]),
    getPath(payload, ["estimate", "toAmount"]),
    getPath(payload, ["estimate", "toAmountMin"]),
    getPath(payload, ["action", "toAmount"]),
    getPath(payload, ["quote", "toAmount"]),
    getPath(payload, ["route", "toAmount"]),
  ];
  for (const candidate of candidates) {
    const parsed = toBigIntLoose(candidate);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function extractSlippageBps(payload: Record<string, unknown>): number | undefined {
  const raw =
    getPath(payload, ["estimate", "slippage"]) ??
    getPath(payload, ["slippage"]) ??
    getPath(payload, ["route", "slippage"]);
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (raw <= 1) {
      return Math.round(raw * 10_000);
    }
    return Math.round(raw);
  }
  if (typeof raw === "string" && raw.length > 0) {
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed)) {
      if (parsed <= 1) {
        return Math.round(parsed * 10_000);
      }
      return Math.round(parsed);
    }
  }
  return undefined;
}

function extractGasEstimate(payload: Record<string, unknown>): bigint | undefined {
  const direct = toBigIntLoose(
    getPath(payload, ["estimate", "gasCost"]) ??
      getPath(payload, ["estimatedGas"]) ??
      getPath(payload, ["gasCost"])
  );
  if (direct !== undefined) return direct;

  const gasCosts = getPath(payload, ["estimate", "gasCosts"]);
  if (Array.isArray(gasCosts)) {
    for (const item of gasCosts) {
      if (!isRecord(item)) continue;
      const amount = toBigIntLoose(item.amount);
      if (amount !== undefined) return amount;
    }
  }

  return undefined;
}

function asComposeExecuteAction(action: Action): CustomAction {
  if (action.type !== "custom") {
    throw new Error(`LI.FI compose_execute expects custom action (got ${action.type})`);
  }
  if (action.op !== "compose_execute") {
    throw new Error(`LI.FI custom op '${action.op}' is not supported`);
  }
  return action;
}

function normalizeComposeExecuteRequest(
  rawRequest: Record<string, unknown>,
  walletAddress: string
): Record<string, unknown> {
  const { allowExternalToAddress, allow_external_to_address, ...request } = rawRequest;
  const allowExternalToAddressOverride =
    allowExternalToAddress === true || allow_external_to_address === true;

  const toAddress = request.toAddress;
  if (toAddress === undefined || toAddress === null || toAddress === "") {
    request.toAddress = walletAddress;
    return request;
  }

  if (typeof toAddress !== "string" || !isAddress(toAddress)) {
    throw new Error("LI.FI compose_execute routeRequest.toAddress must be a valid EVM address");
  }

  if (!sameAddress(toAddress, walletAddress) && !allowExternalToAddressOverride) {
    throw new Error(
      "LI.FI compose_execute routeRequest.toAddress must match walletAddress (set allowExternalToAddress=true to override)"
    );
  }

  request.toAddress = toAddress;
  return request;
}

function materializeArgs(args: Record<string, CustomActionValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    out[key] = materializeValue(value);
  }
  return out;
}

function materializeValue(value: CustomActionValue): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => materializeValue(entry));
  }

  if (isRecord(value)) {
    if (value.kind === "literal" && "value" in value) {
      return value.value;
    }
    if (isExpressionNode(value)) {
      throw new Error("LI.FI adapter received unresolved custom expression args");
    }
    const nested: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      nested[key] = materializeValue(entry as CustomActionValue);
    }
    return nested;
  }

  return value;
}

async function safeRequestStatus(
  requestJson: (
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>
  ) => Promise<Record<string, unknown>>,
  id: string
): Promise<Record<string, unknown>> {
  try {
    return await requestJson("GET", `/status?txHash=${encodeURIComponent(id)}`);
  } catch (error) {
    return {
      status: "unknown",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function extractExecutionId(payload: Record<string, unknown>): string | undefined {
  const id =
    payload.id ??
    payload.txHash ??
    payload.transactionHash ??
    getPath(payload, ["execution", "id"]) ??
    getPath(payload, ["route", "id"]);
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

function extractStatus(payload: Record<string, unknown>): string | undefined {
  const status = payload.status ?? getPath(payload, ["execution", "status"]);
  return typeof status === "string" && status.length > 0 ? status : undefined;
}

function extractErrorMessage(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const message = payload.message ?? getPath(payload, ["error", "message"]);
  return typeof message === "string" && message.length > 0 ? message : undefined;
}

function getPath(obj: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = obj;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function toBigInt(amount: unknown): bigint {
  const parsed = toBigIntLoose(amount);
  if (parsed === undefined) {
    throw new Error("LI.FI adapter requires numeric amount");
  }
  return parsed;
}

function toBigIntLoose(value: unknown): bigint | undefined {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(Math.floor(value));
  }
  if (typeof value === "string" && value.length > 0) {
    try {
      return BigInt(value);
    } catch {
      return undefined;
    }
  }
  if (isRecord(value) && value.kind === "literal" && "value" in value) {
    return toBigIntLoose(value.value);
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
