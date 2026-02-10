/**
 * Simulate Command
 * Simulates spell execution (dry run)
 */

import { type Address, compileFile, execute } from "@grimoirelabs/core";
import { adapters } from "@grimoirelabs/venues";
import chalk from "chalk";
import ora from "ora";
import { hydrateParamsFromEnsProfile, resolveEnsProfile } from "../lib/ens-profile.js";
import { resolveAdvisorSkillsDirs } from "./advisor-skill-helpers.js";
import { resolveAdvisoryHandler } from "./advisory-handlers.js";
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
  advisorSkillsDir?: string | string[];
  advisoryPi?: boolean;
  advisoryReplay?: string;
  advisoryProvider?: string;
  advisoryModel?: string;
  advisoryThinking?: "off" | "low" | "medium" | "high";
  advisoryTools?: "none" | "read" | "coding";
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

export async function simulateCommand(
  spellPath: string,
  options: SimulateOptions,
  ioOverrides?: Partial<SimulateCommandIO>
): Promise<void> {
  const io: SimulateCommandIO = {
    log: ioOverrides?.log ?? console.log,
    exit: ioOverrides?.exit ?? ((code?: number) => process.exit(code)),
  };

  const spinner = ora(`Simulating ${spellPath}...`).start();

  try {
    let params: Record<string, unknown> = {};
    if (options.params) {
      try {
        params = JSON.parse(options.params);
      } catch {
        spinner.fail(chalk.red("Invalid params JSON"));
        io.exit(1);
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
      io.exit(1);
    }

    spinner.text = "Preparing simulation...";
    const vault = (options.vault ?? "0x0000000000000000000000000000000000000000") as Address;
    const chain = Number.parseInt(options.chain ?? "1", 10);
    const spell = compileResult.ir;
    const noState = resolveNoState(options);

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
      advisorSkillsDirs,
      stateDir: options.stateDir,
      noState,
      agentDir: options.piAgentDir,
      cwd: process.cwd(),
    });

    // execute() with simulate:true internally uses preview()
    const result = await withStatePersistence(
      spell.id,
      {
        stateDir: options.stateDir,
        noState,
        buildRunProvenance: () => provenance,
      },
      async (persistentState) => {
        return execute({
          spell,
          vault,
          chain,
          params,
          persistentState,
          simulate: true,
          adapters,
          advisorSkillsDirs: advisorSkillsDirs.length > 0 ? advisorSkillsDirs : undefined,
          onAdvisory,
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
      io.exit(1);
    }
  } catch (error) {
    spinner.fail(chalk.red(`Simulation failed: ${(error as Error).message}`));
    io.exit(1);
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
