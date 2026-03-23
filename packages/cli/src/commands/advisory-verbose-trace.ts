/**
 * Verbose Session Tracing + Tool Tracing
 * Detailed tracing for advisory handler debug output
 */

import type { AdvisoryHandlerInput } from "@grimoirelabs/core";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";

type VerboseDeltaChannel = "thinking" | "text" | "toolcall";

export interface VerboseSessionTracer {
  handle: (event: AgentSessionEvent) => void;
  flushAll: () => void;
}

interface VerboseChannelState {
  value: string;
  startedAt: number | null;
  deltaCount: number;
  totalChars: number;
}

export function createVerboseSessionTracer(
  stepId: string,
  log: (message: string) => void
): VerboseSessionTracer {
  const createState = (): VerboseChannelState => ({
    value: "",
    startedAt: null,
    deltaCount: 0,
    totalChars: 0,
  });

  const buffers: Record<VerboseDeltaChannel, VerboseChannelState> = {
    thinking: createState(),
    text: createState(),
    toolcall: createState(),
  };

  const beginChannel = (channel: VerboseDeltaChannel): void => {
    const buffer = buffers[channel];
    buffer.value = "";
    buffer.startedAt = Date.now();
    buffer.deltaCount = 0;
    buffer.totalChars = 0;
  };

  const emitJoinedDelta = (channel: VerboseDeltaChannel): void => {
    const buffer = buffers[channel];
    if (!buffer.value) return;
    const normalized = normalizeInline(buffer.value, Number.MAX_SAFE_INTEGER);
    if (normalized.length > 0) {
      log(`${tracePrefix(stepId)} ${channel}:delta ${normalized}`);
    }
    buffer.value = "";
  };

  const endChannel = (
    channel: VerboseDeltaChannel,
    completed: boolean,
    emitIfInactive = true
  ): void => {
    const buffer = buffers[channel];
    emitJoinedDelta(channel);
    const startedAt = buffer.startedAt;
    if (startedAt !== null) {
      const durationMs = Date.now() - startedAt;
      log(
        `${tracePrefix(stepId)} ${channel}:end deltas=${buffer.deltaCount} chars=${buffer.totalChars} duration_ms=${durationMs} completed=${completed ? "yes" : "no"}`
      );
      buffer.startedAt = null;
    } else if (emitIfInactive) {
      log(`${tracePrefix(stepId)} ${channel}:end`);
    }
  };

  const appendDelta = (channel: VerboseDeltaChannel, delta: unknown): void => {
    if (typeof delta !== "string" || delta.length === 0) return;
    const buffer = buffers[channel];
    if (buffer.startedAt === null) {
      buffer.startedAt = Date.now();
    }
    buffer.deltaCount += 1;
    buffer.totalChars += delta.length;
    buffer.value += delta;
  };

  return {
    handle: (event: AgentSessionEvent): void => {
      if (event.type !== "message_update") return;
      const detail = event.assistantMessageEvent;

      switch (detail.type) {
        case "thinking_start":
          endChannel("thinking", false, false);
          beginChannel("thinking");
          log(`${tracePrefix(stepId)} thinking:start`);
          return;
        case "thinking_delta":
          appendDelta("thinking", detail.delta);
          return;
        case "thinking_end":
          endChannel("thinking", true);
          return;
        case "text_start":
          endChannel("text", false, false);
          beginChannel("text");
          log(`${tracePrefix(stepId)} text:start`);
          return;
        case "text_delta":
          appendDelta("text", detail.delta);
          return;
        case "text_end":
          endChannel("text", true);
          return;
        case "toolcall_start":
          endChannel("toolcall", false, false);
          beginChannel("toolcall");
          log(`${tracePrefix(stepId)} toolcall:start`);
          return;
        case "toolcall_delta":
          appendDelta("toolcall", detail.delta);
          return;
        case "toolcall_end":
          endChannel("toolcall", true);
          log(`${tracePrefix(stepId)} toolcall:end name=${detail.toolCall.name}`);
          return;
        default:
          return;
      }
    },
    flushAll: (): void => {
      endChannel("thinking", false, false);
      endChannel("text", false, false);
      endChannel("toolcall", false, false);
    },
  };
}

export function emitToolTrace(event: AgentSessionEvent, input: AdvisoryHandlerInput): void {
  if (!input.emit) return;
  if (event.type === "tool_execution_start") {
    const toolName = (event as { toolName?: unknown }).toolName;
    const toolCallId = (event as { toolCallId?: unknown }).toolCallId;
    const args = (event as { args?: unknown }).args;
    if (typeof toolName === "string" && typeof toolCallId === "string") {
      input.emit({
        type: "advisory_tool_execution_start",
        stepId: input.stepId,
        toolCallId,
        toolName,
        args,
      });
    }
    return;
  }
  if (event.type === "tool_execution_update") {
    const toolName = (event as { toolName?: unknown }).toolName;
    const toolCallId = (event as { toolCallId?: unknown }).toolCallId;
    const partial = (event as { partialResult?: unknown }).partialResult;
    if (typeof toolName === "string" && typeof toolCallId === "string") {
      input.emit({
        type: "advisory_tool_execution_update",
        stepId: input.stepId,
        toolCallId,
        toolName,
        partial,
      });
    }
    return;
  }
  if (event.type === "tool_execution_end") {
    const toolName = (event as { toolName?: unknown }).toolName;
    const toolCallId = (event as { toolCallId?: unknown }).toolCallId;
    const result = (event as { result?: unknown }).result;
    const isError = (event as { isError?: unknown }).isError;
    if (typeof toolName === "string" && typeof toolCallId === "string") {
      input.emit({
        type: "advisory_tool_execution_end",
        stepId: input.stepId,
        toolCallId,
        toolName,
        result,
        isError: typeof isError === "boolean" ? isError : undefined,
      });
    }
  }
}

export function summarizeContextSnapshot(context: AdvisoryHandlerInput["context"]): string {
  const params = summarizeKeyList(Object.keys(context.params));
  const bindings = summarizeKeyList(Object.keys(context.bindings));
  const persistent = summarizeKeyList(Object.keys(context.state.persistent));
  const ephemeral = summarizeKeyList(Object.keys(context.state.ephemeral));
  const inputs = summarizeKeyList(Object.keys(context.inputs ?? {}));
  return `params=${params} bindings=${bindings} persistent=${persistent} ephemeral=${ephemeral} inputs=${inputs}`;
}

function summarizeKeyList(keys: string[], max = 8): string {
  if (keys.length === 0) return "[]";
  const head = keys.slice(0, max).join(",");
  if (keys.length <= max) return `[${head}]`;
  return `[${head},+${keys.length - max} more]`;
}

function normalizeInline(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3)}...`;
}

export function tracePrefix(stepId: string): string {
  const time = new Date().toISOString().split("T")[1]?.replace("Z", "");
  return `${time ?? "unknown-time"} [advisory:verbose] step=${stepId}`;
}
