/**
 * Simulate Command
 * Simulates spell execution (dry run)
 */

import {
  type Address,
  compileFile,
  createProvider,
  execute,
  type SpellIR,
} from "@grimoirelabs/core";
import { adapters, createCompositeQueryProvider } from "@grimoirelabs/venues";
import chalk from "chalk";
import ora from "ora";
import { hydrateParamsFromEnsProfile, resolveEnsProfile } from "../lib/ens-profile.js";
import { resolveNoState, resolveRpcUrlFromOption } from "../lib/execution-helpers.js";
import { stringifyJson } from "../lib/json.js";
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
import { executeCrossChainSimulation } from "./simulate-cross-chain.js";
import { spellUsesQueryFunctions } from "./spell-analysis.js";
import { withStatePersistence } from "./state-helpers.js";
import { resolveSelectedTrigger } from "./trigger-selector.js";

interface SimulateOptions {
  params?: string;
  vault?: string;
  chain?: string;
  rpcUrl?: string | string[];
  destinationSpell?: string;
  destinationChain?: string;
  handoffTimeoutSec?: string;
  pollIntervalSec?: string;
  watch?: boolean;
  morphoMarketId?: string | string[];
  morphoMarketMap?: string;
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
  trigger?: string;
  triggerId?: string;
  triggerIndex?: string;
  suppressOutput?: boolean;
}

interface SimulateCommandIO {
  log: typeof console.log;
  exit: typeof process.exit;
}

export interface BuildSimulateCrossChainInputArgs {
  io: SimulateCommandIO;
  terminate: (code: number) => never;
  sourceSpellPath: string;
  sourceSpell: SpellIR;
  sourceChainId: number;
  params: Record<string, unknown>;
  options: SimulateOptions;
  noState: boolean;
}

class SimulateCommandExit extends Error {
  readonly code: number;

  constructor(code: number) {
    super(`simulate.exit(${code})`);
    this.code = code;
  }
}

export function buildSimulateCrossChainInput(
  args: BuildSimulateCrossChainInputArgs
): Parameters<typeof executeCrossChainSimulation>[0] {
  return {
    ...args,
    selectedTrigger: resolveSelectedTrigger(args.options),
  };
}

export async function simulateCommand(
  spellPath: string,
  options: SimulateOptions,
  ioOverrides?: Partial<SimulateCommandIO>
): Promise<{ success: boolean; receipt?: unknown; error?: unknown } | undefined> {
  const io: SimulateCommandIO = {
    log: ioOverrides?.log ?? console.error,
    exit:
      ioOverrides?.exit ??
      ((code?: number) => {
        throw new SimulateCommandExit(code ?? 1);
      }),
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
    if (options.destinationSpell) {
      await executeCrossChainSimulation(
        buildSimulateCrossChainInput({
          io,
          terminate,
          sourceSpellPath: spellPath,
          sourceSpell: spell,
          sourceChainId: chain,
          params,
          options,
          noState,
        })
      );
      spinner.stop();
      return;
    }

    const rpcUrl = resolveRpcUrlFromOption(chain, options.rpcUrl);
    const needsProvider =
      spellNeedsPreviewAdapterContext(spell) || spellUsesQueryFunctions(spell) || !!rpcUrl;
    const provider = needsProvider ? createProvider(chain, rpcUrl) : undefined;

    const queryProvider = provider
      ? createCompositeQueryProvider({
          provider,
          chainId: chain,
          vault,
          rpcUrl,
          adapters,
          venueAliases: spell.aliases,
        })
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
    const selectedTrigger = resolveSelectedTrigger(options);
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
          queryProvider,
          selectedTrigger,
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

    const payload = {
      success: result.success,
      receipt: result.receipt,
      error: result.structuredError,
      selectedTrigger: result.selectedTrigger,
      events: report.events,
      finalState: result.finalState,
    };

    if (!options.suppressOutput) {
      io.log();
      if (options.json) {
        io.log(stringifyJson(payload));
      } else {
        io.log(formatRunReportText(report));
      }
    }

    if (!result.success) {
      return terminate(1);
    }

    return payload;
  } catch (error) {
    if (error instanceof SimulateCommandExit) {
      throw error;
    }
    spinner.fail(chalk.red(`Simulation failed: ${(error as Error).message}`));
    return terminate(1);
  }
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
