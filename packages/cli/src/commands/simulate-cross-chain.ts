/**
 * Cross-Chain Simulation Orchestration
 * Handles multi-chain spell simulation with handoff tracking
 */

import { join } from "node:path";
import {
  type Address,
  compileFile,
  createProvider,
  createRunRecord,
  execute,
  type LedgerEvent,
  orchestrateCrossChain,
  type SpellIR,
  SqliteStateStore,
  toCrossChainReceipt,
} from "@grimoirelabs/core";
import { adapters } from "@grimoirelabs/venues";
import chalk from "chalk";
import {
  appendLifecycleLedgerEntries,
  isMissingNodeSqliteBackend,
  parseRequiredNumber,
  persistCrossChainState,
} from "../lib/execution-helpers.js";
import { stringifyJson } from "../lib/json.js";
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

const DEFAULT_POLL_INTERVAL_SEC = 30;

export interface ExecuteCrossChainSimulationInput {
  io: SimulateCommandIO;
  terminate: (code: number) => never;
  sourceSpellPath: string;
  sourceSpell: SpellIR;
  sourceChainId: number;
  params: Record<string, unknown>;
  options: SimulateOptions;
  noState: boolean;
}

export async function executeCrossChainSimulation(
  input: ExecuteCrossChainSimulationInput
): Promise<void> {
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
    : DEFAULT_POLL_INTERVAL_SEC;

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
