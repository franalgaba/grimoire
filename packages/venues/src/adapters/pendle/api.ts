import type { FetchFn, PendleConvertRequest, PendleConvertResponse } from "./types.js";

export async function requestConvert(input: {
  baseUrl: string;
  chainId: number;
  request: PendleConvertRequest;
  fetchFn: FetchFn;
  enableV2Fallback: boolean;
}): Promise<{ response: PendleConvertResponse; warnings: string[]; usedV2Fallback: boolean }> {
  const warnings: string[] = [];
  try {
    const response = await requestConvertV3(
      input.baseUrl,
      input.chainId,
      input.request,
      input.fetchFn
    );
    if ((response.routes ?? []).length > 0 || !input.enableV2Fallback) {
      return { response, warnings, usedV2Fallback: false };
    }
    const fallback = await requestConvertV2(
      input.baseUrl,
      input.chainId,
      input.request,
      input.fetchFn
    );
    warnings.push("Pendle v3 convert returned no routes.");
    return { response: fallback, warnings, usedV2Fallback: true };
  } catch (error) {
    if (!input.enableV2Fallback) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    const fallback = await requestConvertV2(
      input.baseUrl,
      input.chainId,
      input.request,
      input.fetchFn
    );
    warnings.push(`Pendle v3 convert failed (${message}).`);
    return { response: fallback, warnings, usedV2Fallback: true };
  }
}

export async function requestConvertV3(
  baseUrl: string,
  chainId: number,
  request: PendleConvertRequest,
  fetchFn: FetchFn
): Promise<PendleConvertResponse> {
  const response = await fetchFn(`${baseUrl}/v3/sdk/${chainId}/convert`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(request),
  });
  return await parseJsonResponse<PendleConvertResponse>(response, `/v3/sdk/${chainId}/convert`);
}

export async function requestConvertV2(
  baseUrl: string,
  chainId: number,
  request: PendleConvertRequest,
  fetchFn: FetchFn
): Promise<PendleConvertResponse> {
  const params = new URLSearchParams();
  if (request.receiver) params.set("receiver", request.receiver);
  params.set("slippage", request.slippage.toString());
  params.set("tokensIn", request.inputs.map((input) => input.token).join(","));
  params.set("amountsIn", request.inputs.map((input) => input.amount).join(","));
  params.set("tokensOut", request.outputs.join(","));
  params.set("enableAggregator", request.enableAggregator ? "true" : "false");
  if (request.aggregators && request.aggregators.length > 0) {
    params.set("aggregators", request.aggregators.join(","));
  }
  if (request.redeemRewards !== undefined) {
    params.set("redeemRewards", request.redeemRewards ? "true" : "false");
  }
  if (request.needScale !== undefined) {
    params.set("needScale", request.needScale ? "true" : "false");
  }
  if (request.additionalData) {
    params.set("additionalData", request.additionalData);
  }
  if (request.useLimitOrder !== undefined) {
    params.set("useLimitOrder", request.useLimitOrder ? "true" : "false");
  }

  const response = await fetchFn(`${baseUrl}/v2/sdk/${chainId}/convert?${params.toString()}`, {
    method: "GET",
  });
  return await parseJsonResponse<PendleConvertResponse>(response, `/v2/sdk/${chainId}/convert`);
}

export async function parseJsonResponse<T>(response: Response, endpoint: string): Promise<T> {
  const text = await response.text();
  let payload: unknown;
  try {
    payload = text.length > 0 ? (JSON.parse(text) as unknown) : {};
  } catch {
    throw new Error(`Pendle API ${endpoint} returned non-JSON response`);
  }

  if (!response.ok) {
    const details =
      payload && typeof payload === "object" && "message" in payload
        ? String((payload as { message?: unknown }).message)
        : text;
    throw new Error(`Pendle API ${endpoint} failed (${response.status}): ${details}`);
  }

  // Trust boundary: callers must ensure T matches the expected API shape
  return payload as T;
}
