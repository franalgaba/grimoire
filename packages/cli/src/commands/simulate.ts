/**
 * Simulate Command
 * Simulates spell execution (dry run)
 */

import {
  type Address,
  type SpellIR,
  compileFile,
  createProvider,
  execute,
} from "@grimoirelabs/core";
import { adapters } from "@grimoirelabs/venues";
import chalk from "chalk";
import ora from "ora";
import { hydrateParamsFromEnsProfile, resolveEnsProfile } from "../lib/ens-profile.js";
import { resolveAdvisorSkillsDirs } from "./advisor-skill-helpers.js";
import { resolveAdvisoryHandler } from "./advisory-handlers.js";
import { createAdvisoryLiveTraceLogger } from "./advisory-live-trace.js";
import {
  buildRuntimeProvenanceManifest,
  enforceFreshnessPolicy,
  resolveDataPolicy,
  resolveReplayParams,
} from "./data-provenance.js";
import { buildRunReportEnvelope, formatRunReportText } from "./run-report.js";
import { withStatePersistence } from "./state-helpers.js";

interface SimulateOptions {
  params?: string;
  vault?: string;
  chain?: string;
  rpcUrl?: string;
  advisorSkillsDir?: string | string[];
  advisoryPi?: boolean;
  advisoryReplay?: string;
  advisoryProvider?: string;
  advisoryModel?: string;
  advisoryThinking?: "off" | "low" | "medium" | "high";
  advisoryTools?: "none" | "read" | "coding";
  advisoryTraceVerbose?: boolean;
  piAgentDir?: string;
  stateDir?: string;
  noState?: boolean;
  json?: boolean;
  dataReplay?: string;
  dataMaxAge?: string;
  onStale?: string;
  ensName?: string;
  ensRpcUrl?: string;
  state?: boolean;
}

interface SimulateCommandIO {
  log: typeof console.log;
  exit: typeof process.exit;
}

class SimulateCommandExit extends Error {
  readonly code: number;

  constructor(code: number) {
    super(`simulate.exit(${code})`);
    this.code = code;
  }
}

export async function simulateCommand(
  spellPath: string,
  options: SimulateOptions,
  ioOverrides?: Partial<SimulateCommandIO>
): Promise<void> {
  const io: SimulateCommandIO = {
    log: ioOverrides?.log ?? console.log,
    exit: ioOverrides?.exit ?? ((code?: number) => process.exit(code)),
  };
  const terminate = (code: number): never => {
    io.exit(code);
    throw new SimulateCommandExit(code);
  };

  const interactive =
    ioOverrides === undefined && process.stdin.isTTY === true && process.stdout.isTTY === true;
  const spinner = ora({
    text: `Simulating ${spellPath}...`,
    isEnabled: interactive,
    discardStdin: false,
  }).start();

  try {
    let params: Record<string, unknown> = {};
    if (options.params) {
      try {
        params = JSON.parse(options.params);
      } catch {
        spinner.fail(chalk.red("Invalid params JSON"));
        return terminate(1);
      }
    }

    if (options.ensName) {
      spinner.text = `Resolving ENS profile ${options.ensName}...`;
      const profile = await resolveEnsProfile(options.ensName, { rpcUrl: options.ensRpcUrl });
      params = hydrateParamsFromEnsProfile(params, profile);
      io.log(
        chalk.dim(
          `ENS profile ${profile.name} -> ${profile.address ?? "unresolved"} (risk=${profile.riskProfile ?? "n/a"}, slippage=${profile.maxSlippageBps ?? "n/a"})`
        )
      );
    }

    spinner.text = "Compiling spell...";
    const compileResult = await compileFile(spellPath);

    if (!compileResult.success || !compileResult.ir) {
      spinner.fail(chalk.red("Compilation failed"));
      for (const error of compileResult.errors) {
        io.log(chalk.red(`  [${error.code}] ${error.message}`));
      }
      return terminate(1);
    }

    spinner.text = "Preparing simulation...";
    const vault = (options.vault ?? "0x0000000000000000000000000000000000000000") as Address;
    const chain = Number.parseInt(options.chain ?? "1", 10);
    const spell = compileResult.ir;
    const noState = resolveNoState(options);
    const provider = spellNeedsPreviewAdapterContext(spell)
      ? createProvider(chain, resolveRpcUrl(chain, options.rpcUrl))
      : undefined;

    const dataPolicy = resolveDataPolicy({
      defaultReplay: "auto",
      dataReplay: options.dataReplay,
      dataMaxAge: options.dataMaxAge,
      onStale: options.onStale,
    });

    const replayResolution = await resolveReplayParams({
      spellId: spell.id,
      params,
      stateDir: options.stateDir,
      noState,
      policy: dataPolicy,
    });
    params = replayResolution.params;

    const provenance = buildRuntimeProvenanceManifest({
      runtimeMode: "simulate",
      chainId: chain,
      policy: dataPolicy,
      replay: replayResolution,
      params,
    });

    const freshnessWarnings = enforceFreshnessPolicy(provenance);
    for (const warning of freshnessWarnings) {
      io.log(chalk.yellow(`Warning: ${warning}`));
    }

    spinner.text = "Running preview...";
    const advisorSkillsDirs = resolveAdvisorSkillsDirs(options.advisorSkillsDir) ?? [];
    const onAdvisory = await resolveAdvisoryHandler(spell.id, {
      advisoryPi: options.advisoryPi,
      advisoryReplay: options.advisoryReplay,
      advisoryProvider: options.advisoryProvider,
      advisoryModel: options.advisoryModel,
      advisoryThinking: options.advisoryThinking,
      advisoryTools: options.advisoryTools,
      advisoryTraceVerbose: options.advisoryTraceVerbose,
      advisoryTraceLogger: options.json ? undefined : io.log,
      advisorSkillsDirs,
      stateDir: options.stateDir,
      noState,
      agentDir: options.piAgentDir,
      cwd: process.cwd(),
    });
    const eventCallback = options.json
      ? undefined
      : createAdvisoryLiveTraceLogger(io.log, { verbose: options.advisoryTraceVerbose });

    // execute() with simulate:true internally uses preview()
    const result = await withStatePersistence(
      spell.id,
      {
        stateDir: options.stateDir,
        noState,
        buildRunProvenance: () => provenance,
        onUnavailable: () => {
          io.log(
            chalk.yellow(
              "State persistence unavailable in Node (missing better-sqlite3). Continuing without persisted state."
            )
          );
        },
      },
      async (persistentState) => {
        return execute({
          spell,
          vault,
          chain,
          provider,
          params,
          persistentState,
          simulate: true,
          adapters,
          advisorSkillsDirs: advisorSkillsDirs.length > 0 ? advisorSkillsDirs : undefined,
          onAdvisory,
          eventCallback,
        });
      }
    );

    if (result.success) {
      spinner.succeed(chalk.green("Preview completed successfully"));
    } else {
      spinner.fail(chalk.red(`Preview failed: ${result.error}`));
    }

    const report = buildRunReportEnvelope({
      spellName: spell.meta.name,
      result,
      provenance,
    });

    io.log();
    if (options.json) {
      const payload = {
        success: result.success,
        receipt: result.receipt,
        error: result.structuredError,
      };
      io.log(stringifyJson(payload));
    } else {
      io.log(formatRunReportText(report));
    }

    if (!result.success) {
      return terminate(1);
    }
  } catch (error) {
    if (error instanceof SimulateCommandExit) {
      throw error;
    }
    spinner.fail(chalk.red(`Simulation failed: ${(error as Error).message}`));
    return terminate(1);
  }
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, innerValue) => (typeof innerValue === "bigint" ? innerValue.toString() : innerValue),
    2
  );
}

function resolveNoState(options: { noState?: boolean; state?: boolean }): boolean {
  if (typeof options.noState === "boolean") return options.noState;
  if (options.state === false) return true;
  return false;
}

function resolveRpcUrl(chainId: number, explicitRpcUrl?: string): string | undefined {
  if (typeof explicitRpcUrl === "string" && explicitRpcUrl.trim().length > 0) {
    return explicitRpcUrl.trim();
  }

  const chainScoped = process.env[`RPC_URL_${chainId}`];
  if (typeof chainScoped === "string" && chainScoped.trim().length > 0) {
    return chainScoped.trim();
  }

  const generic = process.env.RPC_URL;
  if (typeof generic === "string" && generic.trim().length > 0) {
    return generic.trim();
  }

  return undefined;
}

function spellNeedsPreviewAdapterContext(spell: SpellIR): boolean {
  for (const step of spell.steps) {
    if (step.kind !== "action") continue;
    const constraints = step.constraints;
    if (
      constraints.requireQuote !== undefined ||
      constraints.requireSimulation !== undefined ||
      constraints.maxGas !== undefined
    ) {
      return true;
    }
  }
  return false;
}
