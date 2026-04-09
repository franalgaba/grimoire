/**
 * Cross-Chain Cast Orchestration
 * Handles multi-chain spell execution with wallet, handoffs, and state persistence
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Provider, VenueAdapter } from "@grimoirelabs/core";
import {
  type Address,
  compileFile,
  createProvider,
  createRunRecord,
  createWalletFromConfig,
  type ExecutionMode,
  execute,
  isTestnet,
  type KeyConfig,
  type LedgerEvent,
  loadPrivateKey,
  orchestrateCrossChain,
  type SelectedTriggerRef,
  type SpellIR,
  SqliteStateStore,
  toCrossChainReceipt,
} from "@grimoirelabs/core";
import { adapters, createHyperliquidAdapter, createPolymarketAdapter } from "@grimoirelabs/venues";
import chalk from "chalk";
import ora from "ora";
import {
  appendLifecycleLedgerEntries,
  isMissingNodeSqliteBackend,
  parseRequiredNumber,
  persistCrossChainState,
} from "../lib/execution-helpers.js";
import { stringifyJson } from "../lib/json.js";
import { DEFAULT_KEYSTORE_PATH } from "../lib/keystore.js";
import { confirmPrompt, promptPassword } from "../lib/prompts.js";
import { resolveAdvisorSkillsDirs } from "./advisor-skill-helpers.js";
import { resolveAdvisoryHandler } from "./advisory-handlers.js";
import { createAdvisoryLiveTraceLogger } from "./advisory-live-trace.js";
import {
  type CrossChainRunManifest,
  createLogicalRunId,
  parseMorphoMarketMappings,
  parseRpcUrlMappings,
  requireExplicitRpcMappings,
  resolveRpcUrlForChain,
  validateMorphoMappingsForSpells,
} from "./cross-chain-helpers.js";
import {
  buildRuntimeProvenanceManifest,
  type ReplayResolution,
  type RuntimeDataPolicy,
  type RuntimeFlow,
} from "./data-provenance.js";

const DEFAULT_GAS_MULTIPLIER = 1.1;
const DEFAULT_POLL_INTERVAL_SEC = 30;

interface CastOptions {
  params?: string;
  vault?: string;
  chain?: string;
  dryRun?: boolean;
  advisorSkillsDir?: string | string[];
  advisoryPi?: boolean;
  advisoryReplay?: string;
  advisoryProvider?: string;
  advisoryModel?: string;
  advisoryThinking?: "off" | "low" | "medium" | "high";
  advisoryTools?: "none" | "read" | "coding";
  advisoryTraceVerbose?: boolean;
  piAgentDir?: string;
  privateKey?: string;
  keyEnv?: string;
  mnemonic?: string;
  keystore?: string;
  passwordEnv?: string;
  rpcUrl?: string | string[];
  destinationSpell?: string;
  destinationChain?: string;
  handoffTimeoutSec?: string;
  pollIntervalSec?: string;
  watch?: boolean;
  morphoMarketId?: string | string[];
  morphoMarketMap?: string;
  gasMultiplier?: string;
  skipConfirm?: boolean;
  verbose?: boolean;
  json?: boolean;
  stateDir?: string;
  noState?: boolean;
  dataReplay?: string;
  dataMaxAge?: string;
  onStale?: string;
  ensName?: string;
  ensRpcUrl?: string;
  state?: boolean;
  trigger?: string;
  triggerId?: string;
  triggerIndex?: string;
}

export interface ExecuteCrossChainCastInput {
  sourceSpellPath: string;
  sourceSpell: SpellIR;
  sourceChainId: number;
  params: Record<string, unknown>;
  options: CastOptions;
  noState: boolean;
  mode: ExecutionMode;
  hasKey: boolean;
  dataPolicy: RuntimeDataPolicy;
  replayResolution: ReplayResolution;
  selectedTrigger?: SelectedTriggerRef;
}

type CrossChainCastExecuteOptions = Parameters<typeof execute>[0];

export interface BuildCrossChainCastExecuteOptionsArgs {
  spell: SpellIR;
  runId: string;
  vault: Address;
  chain: number;
  params: Record<string, unknown>;
  persistentState: Record<string, unknown>;
  mode: ExecutionMode;
  wallet?: CrossChainCastExecuteOptions["wallet"];
  provider: ReturnType<typeof createProvider>;
  gasMultiplier: number;
  confirmCallback: NonNullable<CrossChainCastExecuteOptions["confirmCallback"]>;
  skipTestnetConfirmation: boolean;
  configuredAdapters: VenueAdapter[];
  advisorSkillsDirs: string[];
  onAdvisory: CrossChainCastExecuteOptions["onAdvisory"];
  eventCallback: CrossChainCastExecuteOptions["eventCallback"];
  warningCallback: CrossChainCastExecuteOptions["warningCallback"];
  selectedTrigger?: SelectedTriggerRef;
  trackId: "source" | "destination";
  role: "source" | "destination";
  morphoMarketIds: Record<string, string>;
}

export function buildCrossChainCastExecuteOptions(
  args: BuildCrossChainCastExecuteOptionsArgs
): CrossChainCastExecuteOptions {
  return {
    spell: args.spell,
    runId: args.runId,
    vault: args.vault,
    chain: args.chain,
    params: args.params,
    persistentState: args.persistentState,
    simulate: args.mode === "simulate",
    executionMode: args.mode === "simulate" ? undefined : args.mode,
    wallet: args.mode === "execute" ? args.wallet : undefined,
    provider: args.provider,
    gasMultiplier: args.gasMultiplier,
    confirmCallback: args.confirmCallback,
    skipTestnetConfirmation: args.skipTestnetConfirmation,
    adapters: args.configuredAdapters,
    advisorSkillsDirs: args.advisorSkillsDirs.length > 0 ? args.advisorSkillsDirs : undefined,
    onAdvisory: args.onAdvisory,
    eventCallback: args.eventCallback,
    warningCallback: args.warningCallback,
    selectedTrigger: args.selectedTrigger,
    crossChain: {
      enabled: true,
      runId: args.runId,
      trackId: args.trackId,
      role: args.role,
      morphoMarketIds: args.morphoMarketIds,
    },
  };
}

const HYPERLIQUID_ETH_ASSET_ID = 4;

const OFFCHAIN_ADAPTER_FACTORIES: Record<string, (privateKey: `0x${string}`) => VenueAdapter> = {
  hyperliquid: (privateKey) =>
    createHyperliquidAdapter({ privateKey, assetMap: { ETH: HYPERLIQUID_ETH_ASSET_ID } }),
  polymarket: (privateKey) => createPolymarketAdapter({ privateKey }),
};

export function configureOffchainAdapters(keyConfig: KeyConfig): VenueAdapter[] {
  try {
    const rawKey = loadPrivateKey(keyConfig);
    return adapters.map((adapter) => {
      const factory = OFFCHAIN_ADAPTER_FACTORIES[adapter.meta.name];
      return factory ? factory(rawKey) : adapter;
    });
  } catch {
    return adapters;
  }
}

export async function safeGetBlockNumber(provider: Provider): Promise<bigint | undefined> {
  try {
    return await provider.getBlockNumber();
  } catch {
    return undefined;
  }
}

export async function resolveKeyConfig(
  options: CastOptions,
  spinner: ReturnType<typeof ora>
): Promise<KeyConfig> {
  const hasExplicitKey = !!(options.privateKey || options.mnemonic || options.keystore);
  const hasEnvKey = !!(options.keyEnv && process.env[options.keyEnv]);
  const hasDefaultKeystore = !hasExplicitKey && !hasEnvKey && existsSync(DEFAULT_KEYSTORE_PATH);

  if (options.privateKey) {
    return { type: "raw", source: options.privateKey };
  }
  if (options.keyEnv && process.env[options.keyEnv]) {
    return { type: "env", source: options.keyEnv };
  }
  if (options.mnemonic) {
    return { type: "mnemonic", source: options.mnemonic };
  }
  if (hasDefaultKeystore || options.keystore) {
    const keystorePath = options.keystore ?? DEFAULT_KEYSTORE_PATH;
    if (!existsSync(keystorePath)) {
      spinner.fail(chalk.red(`No key provided and no keystore found at ${keystorePath}`));
      throw new Error(
        `No key provided and no keystore found at ${keystorePath}. Run 'grimoire wallet generate' to create one.`
      );
    }
    const password = await resolveKeystorePassword(options, spinner);
    const keystoreJson = readFileSync(keystorePath, "utf-8");
    return { type: "keystore", source: keystoreJson, password };
  }

  throw new Error("Execution mode requires wallet credentials, but no key source was provided");
}

export function resolveVaultAddress(
  explicitVault?: string,
  fallbackWalletAddress?: string
): string {
  if (explicitVault && explicitVault.length > 0) {
    return explicitVault;
  }
  if (fallbackWalletAddress && fallbackWalletAddress.length > 0) {
    return fallbackWalletAddress;
  }
  return "0x0000000000000000000000000000000000000000";
}

export async function resolveKeystorePassword(
  options: CastOptions,
  spinner: ReturnType<typeof ora>
): Promise<string> {
  const envName = options.passwordEnv ?? "KEYSTORE_PASSWORD";
  const envValue = process.env[envName];

  if (envValue) {
    return envValue;
  }

  if (process.stdin.isTTY) {
    spinner.stop();
    const password = await promptPassword("Keystore password: ");
    spinner.start("Setting up wallet...");
    return password;
  }

  spinner.fail(chalk.red(`No password available. Set ${envName} or run interactively.`));
  throw new Error(`No password available. Set ${envName} or run interactively.`);
}

export async function executeCrossChainCast(input: ExecuteCrossChainCastInput): Promise<void> {
  const destinationSpellPath = input.options.destinationSpell;
  if (!destinationSpellPath) {
    throw new Error("Cross-chain mode requires --destination-spell");
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
    throw new Error(
      `Destination spell compilation failed: ${destinationCompile.errors.map((e) => `[${e.code}] ${e.message}`).join("; ")}`
    );
  }
  const destinationSpell = destinationCompile.ir;

  const rpcMappings = parseRpcUrlMappings(input.options.rpcUrl);
  requireExplicitRpcMappings(rpcMappings, input.sourceChainId, destinationChainId);
  const sourceRpcUrl = resolveRpcUrlForChain(input.sourceChainId, rpcMappings);
  const destinationRpcUrl = resolveRpcUrlForChain(destinationChainId, rpcMappings);
  if (!sourceRpcUrl || !destinationRpcUrl) {
    throw new Error("Could not resolve RPC URLs for both source and destination chains.");
  }

  const morphoMarketIds = parseMorphoMarketMappings({
    morphoMarketId: input.options.morphoMarketId,
    morphoMarketMap: input.options.morphoMarketMap,
  });
  validateMorphoMappingsForSpells(input.sourceSpell, destinationSpell, morphoMarketIds);

  const sourceProvider = createProvider(input.sourceChainId, sourceRpcUrl);
  const destinationProvider = createProvider(destinationChainId, destinationRpcUrl);

  const spinner = ora("Preparing cross-chain orchestration...").start();
  let keyConfig: KeyConfig | undefined;
  let configuredAdapters: VenueAdapter[] = adapters;
  let sourceWallet: ReturnType<typeof createWalletFromConfig> | undefined;
  let destinationWallet: ReturnType<typeof createWalletFromConfig> | undefined;

  if (input.mode === "execute") {
    keyConfig = await resolveKeyConfig(input.options, spinner);
    configuredAdapters = configureOffchainAdapters(keyConfig);
    sourceWallet = createWalletFromConfig(keyConfig, input.sourceChainId, sourceProvider.rpcUrl);
    destinationWallet = createWalletFromConfig(
      keyConfig,
      destinationChainId,
      destinationProvider.rpcUrl
    );
  } else if (input.hasKey) {
    keyConfig = await resolveKeyConfig(input.options, spinner);
    configuredAdapters = configureOffchainAdapters(keyConfig);
  }

  const vault = resolveVaultAddress(input.options.vault, sourceWallet?.address);
  const runId = createLogicalRunId();
  const runtimeFlow: RuntimeFlow =
    input.mode === "execute"
      ? "cast_execute"
      : input.mode === "dry-run"
        ? "cast_dry_run"
        : "simulate";
  const advisorSkillsDirs = resolveAdvisorSkillsDirs(input.options.advisorSkillsDir) ?? [];
  const sourceOnAdvisory = await resolveAdvisoryHandler(input.sourceSpell.id, {
    advisoryPi: input.options.advisoryPi,
    advisoryReplay: input.options.advisoryReplay,
    advisoryProvider: input.options.advisoryProvider,
    advisoryModel: input.options.advisoryModel,
    advisoryThinking: input.options.advisoryThinking,
    advisoryTools: input.options.advisoryTools,
    advisoryTraceVerbose: input.options.advisoryTraceVerbose,
    advisoryTraceLogger: input.options.json ? undefined : console.error,
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
    advisoryTraceLogger: input.options.json ? undefined : console.error,
    advisorSkillsDirs,
    stateDir: input.options.stateDir,
    noState: input.noState,
    agentDir: input.options.piAgentDir,
    cwd: process.cwd(),
  });
  const advisoryEventCallback = input.options.json
    ? undefined
    : createAdvisoryLiveTraceLogger(console.error, {
        verbose: input.options.advisoryTraceVerbose,
      });

  const dbPath = input.options.stateDir ? join(input.options.stateDir, "grimoire.db") : undefined;
  let store: SqliteStateStore | undefined;
  if (!input.noState) {
    try {
      store = new SqliteStateStore({ dbPath });
    } catch (error) {
      if (isMissingNodeSqliteBackend(error)) {
        console.error(
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

  const manifest: CrossChainRunManifest = {
    schema_version: "grimoire.cross_chain.phase1.v1",
    run_id: runId,
    source_spell_path: input.sourceSpellPath,
    destination_spell_path: destinationSpellPath,
    source_spell_id: input.sourceSpell.id,
    destination_spell_id: destinationSpell.id,
    source_chain_id: input.sourceChainId,
    destination_chain_id: destinationChainId,
    mode: input.mode,
    watch: input.options.watch === true,
    handoff_timeout_sec: handoffTimeoutSec,
    poll_interval_sec: pollIntervalSec,
    rpc_by_chain: {
      [input.sourceChainId]: sourceRpcUrl,
      [destinationChainId]: destinationRpcUrl,
    },
    params: input.params,
    vault,
    morpho_market_ids: morphoMarketIds,
  };

  const gasMultiplier = input.options.gasMultiplier
    ? Number.parseFloat(input.options.gasMultiplier)
    : DEFAULT_GAS_MULTIPLIER;
  const confirmCallback =
    input.options.skipConfirm || isTestnet(input.sourceChainId)
      ? async () => true
      : async (message: string) => {
          console.error(message);
          return await confirmPrompt(chalk.yellow("Proceed? (yes/no): "));
        };

  spinner.text = "Running source/destination orchestration...";
  const orchestration = await orchestrateCrossChain({
    runId,
    sourceSpellId: input.sourceSpell.id,
    destinationSpellId: destinationSpell.id,
    sourceChainId: input.sourceChainId,
    destinationChainId,
    vault: vault as Address,
    sourceParams: input.params,
    destinationParams: input.params,
    mode: input.mode,
    watch: input.options.watch === true,
    handoffTimeoutSec,
    pollIntervalSec,
    executeSource: async () => {
      const result = await execute(
        buildCrossChainCastExecuteOptions({
          spell: input.sourceSpell,
          runId,
          vault: vault as Address,
          chain: input.sourceChainId,
          params: input.params,
          persistentState: sourceState,
          mode: input.mode,
          wallet: sourceWallet,
          provider: sourceProvider,
          gasMultiplier,
          confirmCallback,
          skipTestnetConfirmation: input.options.skipConfirm ?? false,
          configuredAdapters,
          advisorSkillsDirs,
          onAdvisory: sourceOnAdvisory,
          eventCallback: advisoryEventCallback,
          warningCallback: (message) => console.error(chalk.yellow(`Warning: ${message}`)),
          selectedTrigger: input.selectedTrigger,
          trackId: "source",
          role: "source",
          morphoMarketIds,
        })
      );
      sourceState = result.finalState;
      return result;
    },
    executeDestination: async (params) => {
      const result = await execute(
        buildCrossChainCastExecuteOptions({
          spell: destinationSpell,
          runId,
          vault: vault as Address,
          chain: destinationChainId,
          params,
          persistentState: destinationState,
          mode: input.mode,
          wallet: destinationWallet,
          provider: destinationProvider,
          gasMultiplier,
          confirmCallback,
          skipTestnetConfirmation: input.options.skipConfirm ?? false,
          configuredAdapters,
          advisorSkillsDirs,
          onAdvisory: destinationOnAdvisory,
          eventCallback: advisoryEventCallback,
          warningCallback: (message) => console.error(chalk.yellow(`Warning: ${message}`)),
          selectedTrigger: input.selectedTrigger,
          trackId: "destination",
          role: "destination",
          morphoMarketIds,
        })
      );
      destinationState = result.finalState;
      return result;
    },
    resolveHandoffStatus: async (handoff) => {
      const across = configuredAdapters.find((adapter) => adapter.meta.name === "across");
      if (!across) {
        return { status: "pending" as const };
      }
      const resolver = across.bridgeLifecycle?.resolveHandoffStatus ?? across.resolveHandoffStatus;
      if (!resolver) {
        return { status: "pending" as const };
      }
      return resolver({
        handoffId: handoff.handoffId,
        originChainId: handoff.originChainId,
        destinationChainId: handoff.destinationChainId,
        originTxHash: handoff.originTxHash,
        reference: handoff.reference,
        asset: handoff.asset,
        submittedAmount: handoff.submittedAmount,
        walletAddress: vault as Address,
      });
    },
    onLifecycleEvent: (event) => {
      lifecycleEvents.push(event);
    },
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
  if (sourceResult) {
    sourceResult.crossChain = crossChainReceipt;
  }
  if (destinationResult) {
    destinationResult.crossChain = crossChainReceipt;
  }

  if (orchestration.pending && !store) {
    throw new Error("Cannot leave a run in waiting state without persistence. Disable --no-state.");
  }

  if (store) {
    if (sourceResult) {
      await store.save(input.sourceSpell.id, sourceResult.finalState);
      const sourceProvenance = {
        ...buildRuntimeProvenanceManifest({
          runtimeMode: runtimeFlow,
          chainId: input.sourceChainId,
          policy: input.dataPolicy,
          replay: input.replayResolution,
          params: input.params,
          blockNumber: await safeGetBlockNumber(sourceProvider),
          rpcUrl: sourceProvider.rpcUrl,
        }),
        cross_chain: manifest,
      };
      await store.addRun(input.sourceSpell.id, createRunRecord(sourceResult, sourceProvenance));
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
      const destinationProvenance = {
        ...buildRuntimeProvenanceManifest({
          runtimeMode: runtimeFlow,
          chainId: destinationChainId,
          policy: input.dataPolicy,
          replay: input.replayResolution,
          params: input.params,
          blockNumber: await safeGetBlockNumber(destinationProvider),
          rpcUrl: destinationProvider.rpcUrl,
        }),
        cross_chain: manifest,
      };
      await store.addRun(
        destinationSpell.id,
        createRunRecord(destinationResult, destinationProvenance)
      );
      await store.saveLedger(destinationSpell.id, runId, destinationResult.ledgerEvents);
    }

    await persistCrossChainState(store, {
      runId,
      tracks: orchestration.tracks,
      handoffs: orchestration.handoffs,
      sourceSpellId: input.sourceSpell.id,
      destinationSpellId: destinationSpell.id,
      sourceResult,
      destinationResult,
    });
  }

  spinner.stop();

  const mergedResult = destinationResult ?? sourceResult;
  if (!mergedResult) {
    throw new Error("Cross-chain orchestration returned no execution results.");
  }

  if (input.options.json) {
    console.error(
      stringifyJson({
        success: orchestration.success,
        pending: orchestration.pending,
        runId,
        crossChain: crossChainReceipt,
        source: sourceResult
          ? {
              success: sourceResult.success,
              error: sourceResult.structuredError,
              receipt: sourceResult.receipt,
            }
          : undefined,
        destination: destinationResult
          ? {
              success: destinationResult.success,
              error: destinationResult.structuredError,
              receipt: destinationResult.receipt,
            }
          : undefined,
      })
    );
  } else {
    console.error();
    console.error(chalk.cyan("Cross-Chain Run:"));
    console.error(`  ${chalk.dim("Run ID:")} ${runId}`);
    console.error(
      `  ${chalk.dim("Source:")} ${input.sourceSpell.meta.name} (${input.sourceChainId}) -> ${chalk.dim("Destination:")} ${destinationSpell.meta.name} (${destinationChainId})`
    );
    console.error(`  ${chalk.dim("Watch:")} ${input.options.watch === true ? "Yes" : "No"}`);
    console.error(
      `  ${chalk.dim("Status:")} ${orchestration.pending ? chalk.yellow("waiting") : orchestration.success ? chalk.green("completed") : chalk.red("failed")}`
    );
    for (const track of orchestration.tracks) {
      const trackStatus =
        track.status === "completed"
          ? chalk.green(track.status)
          : track.status === "failed"
            ? chalk.red(track.status)
            : track.status === "waiting"
              ? chalk.yellow(track.status)
              : chalk.dim(track.status);
      console.error(
        `  ${chalk.dim(`track:${track.trackId}`)} ${trackStatus} chain=${track.chainId} spell=${track.spellId}`
      );
      if (track.error) {
        console.error(`    ${chalk.red(track.error)}`);
      }
    }
    for (const handoff of orchestration.handoffs) {
      console.error(
        `  ${chalk.dim(`handoff:${handoff.handoffId}`)} ${handoff.status} submitted=${handoff.submittedAmount.toString()} settled=${handoff.settledAmount?.toString() ?? "n/a"}`
      );
    }
    if (orchestration.pending) {
      console.error();
      console.error(chalk.yellow("Run is waiting for handoff settlement. Resume with:"));
      console.error(chalk.yellow(`  grimoire resume ${runId} --watch`));
    }
  }

  if (!orchestration.success && !orchestration.pending) {
    throw new Error("Cross-chain orchestration failed");
  }
}
