/**
 * Simulate Command
 * Simulates spell execution (dry run)
 */

import { join } from "node:path";
import {
  type Address,
  type CrossChainReceipt,
  compileFile,
  createProvider,
  createRunRecord,
  execute,
  type LedgerEntry,
  type LedgerEvent,
  orchestrateCrossChain,
  type RunHandoffRecord,
  type RunStepResultRecord,
  type RunTrackRecord,
  type SpellIR,
  SqliteStateStore,
  toCrossChainReceipt,
} from "@grimoirelabs/core";
import { adapters } from "@grimoirelabs/venues";
import chalk from "chalk";
import ora from "ora";
import { hydrateParamsFromEnsProfile, resolveEnsProfile } from "../lib/ens-profile.js";
import { resolveAdvisorSkillsDirs } from "./advisor-skill-helpers.js";
import { resolveAdvisoryHandler } from "./advisory-handlers.js";
import { createAdvisoryLiveTraceLogger } from "./advisory-live-trace.js";
import {
  createLogicalRunId,
  parseMorphoMarketMappings,
  parseRpcUrlMappings,
  requireExplicitRpcMappings,
  resolveRpcUrlForChain,
  validateMorphoMappingsForSpells,
} from "./cross-chain-helpers.js";
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
    if (options.destinationSpell) {
      await executeCrossChainSimulation({
        io,
        terminate,
        sourceSpellPath: spellPath,
        sourceSpell: spell,
        sourceChainId: chain,
        params,
        options,
        noState,
      });
      spinner.stop();
      return;
    }

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

interface ExecuteCrossChainSimulationInput {
  io: SimulateCommandIO;
  terminate: (code: number) => never;
  sourceSpellPath: string;
  sourceSpell: SpellIR;
  sourceChainId: number;
  params: Record<string, unknown>;
  options: SimulateOptions;
  noState: boolean;
}

async function executeCrossChainSimulation(input: ExecuteCrossChainSimulationInput): Promise<void> {
  const destinationSpellPath = input.options.destinationSpell;
  if (!destinationSpellPath) {
    throw new Error("Cross-chain simulation requires --destination-spell");
  }
  const destinationChainId = parseRequiredNumber(
    input.options.destinationChain,
    "--destination-chain"
  );
  const handoffTimeoutSec = parseRequiredNumber(
    input.options.handoffTimeoutSec,
    "--handoff-timeout-sec"
  );
  const pollIntervalSec = input.options.pollIntervalSec
    ? parseRequiredNumber(input.options.pollIntervalSec, "--poll-interval-sec")
    : 30;

  const destinationCompile = await compileFile(destinationSpellPath);
  if (!destinationCompile.success || !destinationCompile.ir) {
    input.io.log(chalk.red("Destination spell compilation failed"));
    for (const error of destinationCompile.errors) {
      input.io.log(chalk.red(`  [${error.code}] ${error.message}`));
    }
    input.terminate(1);
  }
  const destinationSpell = destinationCompile.ir;

  const rpcMappings = parseRpcUrlMappings(input.options.rpcUrl);
  requireExplicitRpcMappings(rpcMappings, input.sourceChainId, destinationChainId);
  const sourceRpcUrl = resolveRpcUrlForChain(input.sourceChainId, rpcMappings);
  const destinationRpcUrl = resolveRpcUrlForChain(destinationChainId, rpcMappings);
  if (!sourceRpcUrl || !destinationRpcUrl) {
    throw new Error("Could not resolve RPC URLs for both chains in cross-chain simulation.");
  }

  const sourceProvider = createProvider(input.sourceChainId, sourceRpcUrl);
  const destinationProvider = createProvider(destinationChainId, destinationRpcUrl);

  const morphoMarketIds = parseMorphoMarketMappings({
    morphoMarketId: input.options.morphoMarketId,
    morphoMarketMap: input.options.morphoMarketMap,
  });
  validateMorphoMappingsForSpells(input.sourceSpell, destinationSpell, morphoMarketIds);

  const advisorSkillsDirs = resolveAdvisorSkillsDirs(input.options.advisorSkillsDir) ?? [];
  const sourceOnAdvisory = await resolveAdvisoryHandler(input.sourceSpell.id, {
    advisoryPi: input.options.advisoryPi,
    advisoryReplay: input.options.advisoryReplay,
    advisoryProvider: input.options.advisoryProvider,
    advisoryModel: input.options.advisoryModel,
    advisoryThinking: input.options.advisoryThinking,
    advisoryTools: input.options.advisoryTools,
    advisoryTraceVerbose: input.options.advisoryTraceVerbose,
    advisoryTraceLogger: input.options.json ? undefined : input.io.log,
    advisorSkillsDirs,
    stateDir: input.options.stateDir,
    noState: input.noState,
    agentDir: input.options.piAgentDir,
    cwd: process.cwd(),
  });
  const destinationOnAdvisory = await resolveAdvisoryHandler(destinationSpell.id, {
    advisoryPi: input.options.advisoryPi,
    advisoryReplay: input.options.advisoryReplay,
    advisoryProvider: input.options.advisoryProvider,
    advisoryModel: input.options.advisoryModel,
    advisoryThinking: input.options.advisoryThinking,
    advisoryTools: input.options.advisoryTools,
    advisoryTraceVerbose: input.options.advisoryTraceVerbose,
    advisoryTraceLogger: input.options.json ? undefined : input.io.log,
    advisorSkillsDirs,
    stateDir: input.options.stateDir,
    noState: input.noState,
    agentDir: input.options.piAgentDir,
    cwd: process.cwd(),
  });
  const advisoryEventCallback = input.options.json
    ? undefined
    : createAdvisoryLiveTraceLogger(input.io.log, { verbose: input.options.advisoryTraceVerbose });

  const runId = createLogicalRunId();
  const vault = (input.options.vault ?? "0x0000000000000000000000000000000000000000") as Address;

  const dbPath = input.options.stateDir ? join(input.options.stateDir, "grimoire.db") : undefined;
  let store: SqliteStateStore | undefined;
  if (!input.noState) {
    try {
      store = new SqliteStateStore({ dbPath });
    } catch (error) {
      if (isMissingNodeSqliteBackend(error)) {
        input.io.log(
          chalk.yellow(
            "State persistence unavailable in Node (missing better-sqlite3). Continuing without persisted state."
          )
        );
      } else {
        throw error;
      }
    }
  }

  let sourceState = store ? ((await store.load(input.sourceSpell.id)) ?? {}) : {};
  let destinationState = store ? ((await store.load(destinationSpell.id)) ?? {}) : {};
  const lifecycleEvents: LedgerEvent[] = [];
  const orchestration = await orchestrateCrossChain({
    runId,
    sourceSpellId: input.sourceSpell.id,
    destinationSpellId: destinationSpell.id,
    sourceChainId: input.sourceChainId,
    destinationChainId,
    vault,
    sourceParams: input.params,
    destinationParams: input.params,
    mode: "simulate",
    watch: input.options.watch === true,
    handoffTimeoutSec,
    pollIntervalSec,
    executeSource: async () => {
      const result = await execute({
        spell: input.sourceSpell,
        runId,
        vault,
        chain: input.sourceChainId,
        params: input.params,
        persistentState: sourceState,
        simulate: true,
        provider: sourceProvider,
        adapters,
        advisorSkillsDirs: advisorSkillsDirs.length > 0 ? advisorSkillsDirs : undefined,
        onAdvisory: sourceOnAdvisory,
        eventCallback: advisoryEventCallback,
        warningCallback: (message) => input.io.log(chalk.yellow(`Warning: ${message}`)),
        crossChain: {
          enabled: true,
          runId,
          trackId: "source",
          role: "source",
          morphoMarketIds,
        },
      });
      sourceState = result.finalState;
      return result;
    },
    executeDestination: async (params) => {
      const result = await execute({
        spell: destinationSpell,
        runId,
        vault,
        chain: destinationChainId,
        params,
        persistentState: destinationState,
        simulate: true,
        provider: destinationProvider,
        adapters,
        advisorSkillsDirs: advisorSkillsDirs.length > 0 ? advisorSkillsDirs : undefined,
        onAdvisory: destinationOnAdvisory,
        eventCallback: advisoryEventCallback,
        warningCallback: (message) => input.io.log(chalk.yellow(`Warning: ${message}`)),
        crossChain: {
          enabled: true,
          runId,
          trackId: "destination",
          role: "destination",
          morphoMarketIds,
        },
      });
      destinationState = result.finalState;
      return result;
    },
    onLifecycleEvent: (event) => lifecycleEvents.push(event),
  });

  const crossChainReceipt = toCrossChainReceipt({
    runId,
    sourceSpellId: input.sourceSpell.id,
    destinationSpellId: destinationSpell.id,
    sourceChainId: input.sourceChainId,
    destinationChainId,
    tracks: orchestration.tracks,
    handoffs: orchestration.handoffs,
  });

  const sourceResult = orchestration.sourceResult;
  const destinationResult = orchestration.destinationResult;
  if (sourceResult) sourceResult.crossChain = crossChainReceipt;
  if (destinationResult) destinationResult.crossChain = crossChainReceipt;

  if (store) {
    if (sourceResult) {
      await store.save(input.sourceSpell.id, sourceResult.finalState);
      await store.addRun(
        input.sourceSpell.id,
        createRunRecord(sourceResult, {
          runtime_mode: "simulate",
          cross_chain: {
            run_id: runId,
            source_spell_path: input.sourceSpellPath,
            destination_spell_path: destinationSpellPath,
          },
        })
      );
      await store.saveLedger(
        input.sourceSpell.id,
        runId,
        appendLifecycleLedgerEntries(
          sourceResult.ledgerEvents,
          lifecycleEvents,
          runId,
          input.sourceSpell.id
        )
      );
    }
    if (destinationResult) {
      await store.save(destinationSpell.id, destinationResult.finalState);
      await store.addRun(
        destinationSpell.id,
        createRunRecord(destinationResult, {
          runtime_mode: "simulate",
          cross_chain: {
            run_id: runId,
            source_spell_path: input.sourceSpellPath,
            destination_spell_path: destinationSpellPath,
          },
        })
      );
      await store.saveLedger(destinationSpell.id, runId, destinationResult.ledgerEvents);
    }

    await persistCrossChainState(store, {
      runId,
      tracks: orchestration.tracks,
      handoffs: orchestration.handoffs,
      sourceResult,
      destinationResult,
    });
    store.close();
  }

  if (input.options.json) {
    input.io.log(
      stringifyJson({
        success: orchestration.success,
        pending: orchestration.pending,
        runId,
        crossChain: crossChainReceipt,
        source: sourceResult
          ? {
              success: sourceResult.success,
              receipt: sourceResult.receipt,
              error: sourceResult.structuredError,
            }
          : undefined,
        destination: destinationResult
          ? {
              success: destinationResult.success,
              receipt: destinationResult.receipt,
              error: destinationResult.structuredError,
            }
          : undefined,
      })
    );
  } else {
    input.io.log();
    input.io.log(chalk.cyan("Cross-chain simulation complete"));
    input.io.log(`  run_id: ${runId}`);
    for (const track of orchestration.tracks) {
      input.io.log(`  track ${track.trackId}: ${track.status} (chain ${track.chainId})`);
    }
    for (const handoff of orchestration.handoffs) {
      input.io.log(
        `  handoff ${handoff.handoffId}: ${handoff.status} submitted=${handoff.submittedAmount.toString()} settled=${handoff.settledAmount?.toString() ?? "n/a"}`
      );
    }
  }

  if (!orchestration.success) {
    input.terminate(1);
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

function parseRequiredNumber(value: string | undefined, flag: string): number {
  if (!value) {
    throw new Error(`${flag} is required in cross-chain mode`);
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function resolveRpcUrl(chainId: number, explicitRpcUrl?: string | string[]): string | undefined {
  const parsed = parseRpcUrlMappings(explicitRpcUrl);
  return resolveRpcUrlForChain(chainId, parsed);
}

function isMissingNodeSqliteBackend(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes(
    "SqliteStateStore requires bun:sqlite (Bun) or better-sqlite3 (Node)"
  );
}

function appendLifecycleLedgerEntries(
  entries: LedgerEntry[],
  lifecycleEvents: LedgerEvent[],
  runId: string,
  spellId: string
): LedgerEntry[] {
  if (lifecycleEvents.length === 0) {
    return entries;
  }
  const start = entries.length;
  const extras = lifecycleEvents.map((event, index) => ({
    id: `evt_cc_${String(start + index).padStart(3, "0")}`,
    timestamp: Date.now(),
    runId,
    spellId,
    event,
  }));
  return [...entries, ...extras];
}

async function persistCrossChainState(
  store: SqliteStateStore,
  input: {
    runId: string;
    tracks: CrossChainReceipt["tracks"];
    handoffs: CrossChainReceipt["handoffs"];
    sourceResult?: Awaited<ReturnType<typeof execute>>;
    destinationResult?: Awaited<ReturnType<typeof execute>>;
  }
): Promise<void> {
  const nowIso = new Date().toISOString();
  for (const track of input.tracks) {
    const row: RunTrackRecord = {
      runId: input.runId,
      trackId: track.trackId,
      role: track.role,
      spellId: track.spellId,
      chainId: track.chainId,
      status: track.status,
      lastStepId: track.lastStepId,
      error: track.error,
      updatedAt: nowIso,
    };
    await store.upsertRunTrack(row);
  }

  for (const handoff of input.handoffs) {
    const row: RunHandoffRecord = {
      runId: input.runId,
      handoffId: handoff.handoffId,
      sourceTrackId: handoff.sourceTrackId,
      destinationTrackId: handoff.destinationTrackId,
      sourceStepId: handoff.sourceStepId,
      originChainId: handoff.originChainId,
      destinationChainId: handoff.destinationChainId,
      asset: handoff.asset,
      submittedAmount: handoff.submittedAmount.toString(),
      settledAmount: handoff.settledAmount?.toString(),
      status: handoff.status,
      reference: handoff.reference,
      originTxHash: handoff.originTxHash,
      reason: handoff.reason,
      createdAt: nowIso,
      updatedAt: nowIso,
      expiresAt: handoff.status === "expired" ? nowIso : undefined,
    };
    await store.upsertRunHandoff(row);
  }

  const sourceSteps = collectStepStatuses(input.sourceResult, "source", input.runId);
  for (const step of sourceSteps) {
    await store.upsertRunStepResult(step);
  }
  const destinationSteps = collectStepStatuses(input.destinationResult, "destination", input.runId);
  for (const step of destinationSteps) {
    await store.upsertRunStepResult(step);
  }
}

function collectStepStatuses(
  result: Awaited<ReturnType<typeof execute>> | undefined,
  trackId: "source" | "destination",
  runId: string
): RunStepResultRecord[] {
  if (!result?.receipt) {
    return [];
  }
  const nowIso = new Date().toISOString();
  const byStep = new Map<string, RunStepResultRecord>();

  for (const planned of result.receipt.plannedActions) {
    byStep.set(planned.stepId, {
      runId,
      trackId,
      stepId: planned.stepId,
      status: "confirmed",
      idempotencyKey: `${runId}:${trackId}:${planned.stepId}`,
      updatedAt: nowIso,
    });
  }

  if (!result.success) {
    for (const step of byStep.values()) {
      step.status = "failed";
    }
  }

  return [...byStep.values()];
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
