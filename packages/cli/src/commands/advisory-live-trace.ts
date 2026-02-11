import type { LedgerEntry } from "@grimoirelabs/core";
import chalk from "chalk";

const ADVISORY_TYPES = new Set([
  "advisory_started",
  "advisory_model_used",
  "advisory_tool_execution_start",
  "advisory_tool_execution_update",
  "advisory_tool_execution_end",
  "advisory_completed",
  "advisory_failed",
  "advisory_rate_limited",
]);

export function createAdvisoryLiveTraceLogger(
  log: (message: string) => void = console.log,
  options: { verbose?: boolean } = {}
): (entry: LedgerEntry) => void {
  return (entry: LedgerEntry): void => {
    const event = entry.event;
    if (!ADVISORY_TYPES.has(event.type)) return;
    const verbose = options.verbose === true;

    const prefix = `${chalk.dim(formatTime(entry.timestamp))} ${chalk.cyan("[advisory]")}`;

    switch (event.type) {
      case "advisory_started":
        log(`${prefix} start step=${event.stepId} advisor=${event.advisor}`);
        if (verbose) {
          log(`${prefix} prompt=${summarize(event.prompt, 320)}`);
          if (event.schema !== undefined) {
            log(`${prefix} schema=${summarize(event.schema, 320)}`);
          }
        }
        return;
      case "advisory_model_used":
        log(`${prefix} model step=${event.stepId} ${event.provider}/${event.modelId}`);
        return;
      case "advisory_tool_execution_start":
        log(
          `${prefix} tool:start step=${event.stepId} tool=${event.toolName} call=${event.toolCallId}`
        );
        if (verbose) {
          log(`${prefix} tool:args step=${event.stepId} ${summarize(event.args, 320)}`);
        }
        return;
      case "advisory_tool_execution_update":
        log(
          `${prefix} tool:update step=${event.stepId} tool=${event.toolName} partial=${summarize(event.partial)}`
        );
        return;
      case "advisory_tool_execution_end":
        log(
          `${prefix} tool:end step=${event.stepId} tool=${event.toolName} error=${event.isError === true ? "yes" : "no"}`
        );
        if (verbose) {
          log(`${prefix} tool:result step=${event.stepId} ${summarize(event.result, 320)}`);
        }
        return;
      case "advisory_completed":
        log(
          `${prefix} done step=${event.stepId} advisor=${event.advisor} output=${summarize(event.effectiveOutput ?? event.output)}`
        );
        if (verbose && event.rawOutput !== undefined) {
          log(`${prefix} raw_output=${summarize(event.rawOutput, 320)}`);
        }
        return;
      case "advisory_failed":
        log(`${prefix} failed step=${event.stepId} advisor=${event.advisor} error=${event.error}`);
        if (verbose) {
          log(`${prefix} fallback=${summarize(event.fallback, 320)}`);
        }
        return;
      case "advisory_rate_limited":
        log(`${prefix} rate-limited step=${event.stepId} advisor=${event.advisor}`);
        return;
      default:
        return;
    }
  };
}

function formatTime(timestamp: number): string {
  const iso = new Date(timestamp).toISOString();
  return iso.split("T")[1]?.replace("Z", "") ?? String(timestamp);
}

function summarize(value: unknown, maxLength = 140): string {
  let text: string;
  if (typeof value === "string") {
    text = value.replace(/\s+/g, " ").trim();
  } else {
    try {
      text = JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    } catch {
      text = String(value);
    }
  }
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}
