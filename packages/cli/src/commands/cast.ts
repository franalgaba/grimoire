/**
 * Cast Command
 * Executes a spell with optional live execution via private key
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as readline from "node:readline";
import { Writable } from "node:stream";
import type { Provider, VenueAdapter } from "@grimoirelabs/core";
import {
  type Address,
  type CrossChainReceipt,
  compileFile,
  createProvider,
  createRunRecord,
  createWalletFromConfig,
  type ExecutionMode,
  execute,
  formatWei,
  getChainName,
  getNativeCurrencySymbol,
  isTestnet,
  type KeyConfig,
  type LedgerEntry,
  type LedgerEvent,
  loadPrivateKey,
  orchestrateCrossChain,
  type RunHandoffRecord,
  type RunStepResultRecord,
  type RunTrackRecord,
  type SpellIR,
  SqliteStateStore,
  toCrossChainReceipt,
} from "@grimoirelabs/core";
import {
  adapters,
  createAlchemyQueryProvider,
  createHyperliquidAdapter,
} from "@grimoirelabs/venues";
import chalk from "chalk";
import ora from "ora";
import { hydrateParamsFromEnsProfile, resolveEnsProfile } from "../lib/ens-profile.js";
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
  enforceFreshnessPolicy,
  type ReplayResolution,
  type RuntimeDataPolicy,
  type RuntimeFlow,
  resolveDataPolicy,
  resolveReplayParams,
} from "./data-provenance.js";
import { buildRunReportEnvelope, formatRunReportText } from "./run-report.js";
import { spellUsesQueryFunctions } from "./spell-analysis.js";
import { withStatePersistence } from "./state-helpers.js";

const DEFAULT_KEYSTORE_PATH = join(homedir(), ".grimoire", "keystore.json");

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
  // Key options
  privateKey?: string;
  keyEnv?: string;
  mnemonic?: string;
  keystore?: string;
  passwordEnv?: string;
  // Execution options
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
  // Output options
  verbose?: boolean;
  json?: boolean;
  // State options
  stateDir?: string;
  noState?: boolean;
  // Data replay and freshness options
  dataReplay?: string;
  dataMaxAge?: string;
  onStale?: string;
  // ENS profile options
  ensName?: string;
  ensRpcUrl?: string;
  state?: boolean;
  // Trigger filter
  trigger?: string;
}

export async function castCommand(spellPath: string, options: CastOptions): Promise<void> {
  const spinner = ora(`Loading ${spellPath}...`).start();

  try {
    let params: Record<string, unknown> = {};
    if (options.params) {
      try {
        params = JSON.parse(options.params);
      } catch {
        spinner.fail(chalk.red("Invalid params JSON"));
        process.exit(1);
      }
    }

    if (options.ensName) {
      spinner.text = `Resolving ENS profile ${options.ensName}...`;
      const profile = await resolveEnsProfile(options.ensName, { rpcUrl: options.ensRpcUrl });
      params = hydrateParamsFromEnsProfile(params, profile);
      console.log(
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
        console.log(chalk.red(`  [${error.code}] ${error.message}`));
      }
      process.exit(1);
    }

    const spell = compileResult.ir;
    spinner.succeed(chalk.green("Spell compiled successfully"));

    // Validate --trigger option against available triggers
    if (options.trigger) {
      const anyTrigger = spell.triggers.find((t) => t.type === "any");
      if (!anyTrigger || anyTrigger.type !== "any" || !spell.triggerStepMap) {
        console.log(
          chalk.yellow(
            `Warning: --trigger "${options.trigger}" ignored — spell has a single trigger (no filtering needed).`
          )
        );
      }
    }

    const noState = resolveNoState(options);

    const hasExplicitKey = !!(options.privateKey || options.mnemonic || options.keystore);
    const hasEnvKey = !!(options.keyEnv && process.env[options.keyEnv]);
    const hasDefaultKeystore = !hasExplicitKey && !hasEnvKey && existsSync(DEFAULT_KEYSTORE_PATH);
    const hasKey = hasExplicitKey || hasEnvKey || hasDefaultKeystore;
    const mode: ExecutionMode = options.dryRun ? "dry-run" : hasKey ? "execute" : "simulate";

    const defaultReplay = mode === "execute" ? "off" : "auto";
    const dataPolicy = resolveDataPolicy({
      defaultReplay,
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

    if (options.privateKey || options.mnemonic) {
      console.log(
        chalk.yellow(
          "⚠️  Avoid passing secrets via CLI arguments. Use --key-env or env vars instead."
        )
      );
    }

    console.log();
    console.log(chalk.cyan("📜 Spell Info:"));
    console.log(`  ${chalk.dim("Name:")} ${spell.meta.name}`);
    console.log(`  ${chalk.dim("Version:")} ${spell.version}`);
    console.log(`  ${chalk.dim("Steps:")} ${spell.steps.length}`);
    console.log(`  ${chalk.dim("Mode:")} ${mode}`);

    if (spell.params.length > 0) {
      console.log();
      console.log(chalk.cyan("📊 Parameters:"));
      for (const param of spell.params) {
        const value = params[param.name] ?? param.default;
        console.log(`  ${chalk.dim(param.name)}: ${JSON.stringify(value)}`);
      }
    }

    const chainId = Number.parseInt(options.chain ?? "1", 10);
    const chainName = getChainName(chainId);
    const isTest = isTestnet(chainId);

    if (options.destinationSpell) {
      await executeCrossChainCast({
        sourceSpellPath: spellPath,
        sourceSpell: spell,
        sourceChainId: chainId,
        params,
        options,
        noState,
        mode,
        hasKey,
        dataPolicy,
        replayResolution,
      });
      return;
    }

    console.log();
    console.log(chalk.cyan("🔗 Network:"));
    console.log(`  ${chalk.dim("Chain:")} ${chainName} (${chainId})`);
    console.log(`  ${chalk.dim("Testnet:")} ${isTest ? "Yes" : "No"}`);

    if (hasKey && mode !== "simulate") {
      await executeWithWallet(
        spell,
        params,
        options,
        noState,
        chainId,
        isTest,
        dataPolicy,
        replayResolution
      );
    } else {
      const runtimeFlow: RuntimeFlow = mode === "dry-run" ? "cast_dry_run" : "simulate";
      await executeSimulation(
        spell,
        params,
        options,
        noState,
        chainId,
        runtimeFlow,
        dataPolicy,
        replayResolution
      );
    }
  } catch (error) {
    spinner.fail(chalk.red(`Cast failed: ${(error as Error).message}`));
    if (options.verbose) {
      console.error(error);
    }
    process.exit(1);
  }
}

async function executeWithWallet(
  spell: SpellIR,
  params: Record<string, unknown>,
  options: CastOptions,
  noState: boolean,
  chainId: number,
  isTest: boolean,
  dataPolicy: RuntimeDataPolicy,
  replayResolution: ReplayResolution
): Promise<void> {
  const spinner = ora("Setting up wallet...").start();

  let keyConfig: KeyConfig;
  if (options.privateKey) {
    keyConfig = { type: "raw", source: options.privateKey };
  } else if (options.keyEnv && process.env[options.keyEnv]) {
    keyConfig = { type: "env", source: options.keyEnv };
  } else if (options.mnemonic) {
    keyConfig = { type: "mnemonic", source: options.mnemonic };
  } else {
    const keystorePath = options.keystore ?? DEFAULT_KEYSTORE_PATH;
    if (!existsSync(keystorePath)) {
      spinner.fail(chalk.red(`No key provided and no keystore found at ${keystorePath}`));
      console.log(chalk.dim("  Run 'grimoire wallet generate' to create one."));
      process.exit(1);
      return;
    }

    const password = await resolveKeystorePassword(options, spinner);
    if (!password) {
      return;
    }

    const keystoreJson = readFileSync(keystorePath, "utf-8");
    keyConfig = { type: "keystore", source: keystoreJson, password };
  }

  let configuredAdapters: VenueAdapter[] = adapters;
  try {
    const rawKey = loadPrivateKey(keyConfig);
    configuredAdapters = adapters.map((adapter) => {
      if (adapter.meta.name === "hyperliquid") {
        return createHyperliquidAdapter({
          privateKey: rawKey,
          assetMap: { ETH: 4 },
        });
      }
      return adapter;
    });
  } catch {
    // Keep default adapters if key extraction fails.
  }

  const rpcUrl = resolveRpcUrlFromOption(chainId, options.rpcUrl);
  if (!rpcUrl) {
    spinner.warn(chalk.yellow("No RPC URL provided, using default public RPC"));
  }

  const provider = createProvider(chainId, rpcUrl);
  const wallet = createWalletFromConfig(keyConfig, chainId, provider.rpcUrl);

  spinner.succeed(chalk.green(`Wallet loaded: ${wallet.address}`));

  const balance = await provider.getBalance(wallet.address);
  console.log(
    `  ${chalk.dim("Balance:")} ${formatWei(balance)} ${getNativeCurrencySymbol(chainId)}`
  );

  if (balance === 0n) {
    console.log(chalk.yellow(`  ⚠️  Wallet has no ${getNativeCurrencySymbol(chainId)} for gas`));
  }

  const vault = (options.vault ?? wallet.address) as Address;
  const queryProvider = createAlchemyQueryProvider({ provider, chainId, vault, rpcUrl });
  console.log(`  ${chalk.dim("Vault:")} ${vault}`);

  if (!isTest) {
    console.log();
    console.log(chalk.red("⚠️  WARNING: This is MAINNET"));
    console.log(chalk.red("   Real funds will be used!"));
  }

  const executionMode: ExecutionMode = options.dryRun ? "dry-run" : "execute";
  const runtimeMode = executionMode === "dry-run" ? "cast_dry_run" : "cast_execute";
  const gasMultiplier = options.gasMultiplier ? Number.parseFloat(options.gasMultiplier) : 1.1;
  const advisorSkillsDirs = resolveAdvisorSkillsDirs(options.advisorSkillsDir) ?? [];
  const onAdvisory = await resolveAdvisoryHandler(spell.id, {
    advisoryPi: options.advisoryPi,
    advisoryReplay: options.advisoryReplay,
    advisoryProvider: options.advisoryProvider,
    advisoryModel: options.advisoryModel,
    advisoryThinking: options.advisoryThinking,
    advisoryTools: options.advisoryTools,
    advisoryTraceVerbose: options.advisoryTraceVerbose,
    advisoryTraceLogger: options.json ? undefined : console.log,
    advisorSkillsDirs,
    stateDir: options.stateDir,
    noState,
    agentDir: options.piAgentDir,
    cwd: process.cwd(),
  });
  const eventCallback = options.json
    ? undefined
    : createAdvisoryLiveTraceLogger(console.log, {
        verbose: options.advisoryTraceVerbose,
      });

  const provenance = buildRuntimeProvenanceManifest({
    runtimeMode,
    chainId,
    policy: dataPolicy,
    replay: replayResolution,
    params,
    blockNumber: await safeGetBlockNumber(provider),
    rpcUrl: provider.rpcUrl,
  });

  const freshnessWarnings = enforceFreshnessPolicy(provenance);
  for (const warning of freshnessWarnings) {
    console.log(chalk.yellow(`Warning: ${warning}`));
  }

  const confirmCallback =
    options.skipConfirm || isTest
      ? async () => true
      : async (message: string) => {
          console.log(message);
          return await confirmPrompt(chalk.yellow("Proceed? (yes/no): "));
        };

  console.log();
  console.log(chalk.cyan(`🚀 Executing spell (${executionMode})...`));

  const execResult = await withStatePersistence(
    spell.id,
    {
      stateDir: options.stateDir,
      noState,
      buildRunProvenance: () => provenance,
      onUnavailable: () => {
        console.log(
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
        chain: chainId,
        params,
        persistentState,
        simulate: false,
        executionMode,
        wallet,
        provider,
        gasMultiplier,
        confirmCallback,
        progressCallback: (message: string) => {
          console.log(chalk.dim(`  ${message}`));
        },
        skipTestnetConfirmation: options.skipConfirm ?? false,
        adapters: configuredAdapters,
        advisorSkillsDirs: advisorSkillsDirs.length > 0 ? advisorSkillsDirs : undefined,
        onAdvisory,
        eventCallback,
        queryProvider,
        triggerFilter: options.trigger,
      });
    }
  );

  if (execResult.success) {
    console.log(chalk.green("Execution completed successfully"));
  } else {
    console.log(chalk.red(`Execution failed: ${execResult.error}`));
  }

  const report = buildRunReportEnvelope({
    spellName: spell.meta.name,
    result: execResult,
    provenance,
  });

  console.log();
  if (options.json) {
    const payload = execResult.commit
      ? {
          success: execResult.success,
          preview: execResult.receipt,
          commit: execResult.commit,
          error: execResult.structuredError,
        }
      : {
          success: execResult.success,
          receipt: execResult.receipt,
          error: execResult.structuredError,
        };
    console.log(stringifyJson(payload));
  } else {
    console.log(formatRunReportText(report));
  }

  if (!execResult.success) {
    process.exit(1);
  }
}

async function executeSimulation(
  spell: SpellIR,
  params: Record<string, unknown>,
  options: CastOptions,
  noState: boolean,
  chainId: number,
  runtimeMode: RuntimeFlow,
  dataPolicy: RuntimeDataPolicy,
  replayResolution: ReplayResolution
): Promise<void> {
  const spinner = ora("Running simulation...").start();

  const provenance = buildRuntimeProvenanceManifest({
    runtimeMode,
    chainId,
    policy: dataPolicy,
    replay: replayResolution,
    params,
  });

  const freshnessWarnings = enforceFreshnessPolicy(provenance);
  for (const warning of freshnessWarnings) {
    console.log(chalk.yellow(`Warning: ${warning}`));
  }

  const vault = (options.vault ?? "0x0000000000000000000000000000000000000000") as Address;
  const simRpcUrl = resolveRpcUrlFromOption(chainId, options.rpcUrl);
  const needsSimProvider = !!simRpcUrl || spellUsesQueryFunctions(spell);
  const simProvider = needsSimProvider ? createProvider(chainId, simRpcUrl) : undefined;
  const simQueryProvider = simProvider
    ? createAlchemyQueryProvider({ provider: simProvider, chainId, vault, rpcUrl: simRpcUrl })
    : undefined;
  const advisorSkillsDirs = resolveAdvisorSkillsDirs(options.advisorSkillsDir) ?? [];
  const onAdvisory = await resolveAdvisoryHandler(spell.id, {
    advisoryPi: options.advisoryPi,
    advisoryReplay: options.advisoryReplay,
    advisoryProvider: options.advisoryProvider,
    advisoryModel: options.advisoryModel,
    advisoryThinking: options.advisoryThinking,
    advisoryTools: options.advisoryTools,
    advisoryTraceVerbose: options.advisoryTraceVerbose,
    advisoryTraceLogger: options.json ? undefined : console.log,
    advisorSkillsDirs,
    stateDir: options.stateDir,
    noState,
    agentDir: options.piAgentDir,
    cwd: process.cwd(),
  });
  const eventCallback = options.json
    ? undefined
    : createAdvisoryLiveTraceLogger(console.log, {
        verbose: options.advisoryTraceVerbose,
      });

  // execute() with simulate:true internally uses preview()
  const result = await withStatePersistence(
    spell.id,
    {
      stateDir: options.stateDir,
      noState,
      buildRunProvenance: () => provenance,
      onUnavailable: () => {
        console.log(
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
        chain: chainId,
        params,
        persistentState,
        simulate: true,
        provider: simProvider,
        adapters,
        advisorSkillsDirs: advisorSkillsDirs.length > 0 ? advisorSkillsDirs : undefined,
        onAdvisory,
        eventCallback,
        queryProvider: simQueryProvider,
        triggerFilter: options.trigger,
      });
    }
  );

  if (result.success) {
    spinner.succeed(chalk.green("Preview successful"));
  } else {
    spinner.fail(chalk.red(`Preview failed: ${result.error}`));
  }

  const report = buildRunReportEnvelope({
    spellName: spell.meta.name,
    result,
    provenance,
  });

  console.log();
  if (options.json) {
    const payload = {
      success: result.success,
      receipt: result.receipt,
      error: result.structuredError,
    };
    console.log(stringifyJson(payload));
  } else {
    console.log(formatRunReportText(report));
  }

  if (!result.success) {
    process.exit(1);
  }
}

interface ExecuteCrossChainCastInput {
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
}

async function executeCrossChainCast(input: ExecuteCrossChainCastInput): Promise<void> {
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
    : 30;

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
    try {
      const rawKey = loadPrivateKey(keyConfig);
      configuredAdapters = adapters.map((adapter) => {
        if (adapter.meta.name === "hyperliquid") {
          return createHyperliquidAdapter({
            privateKey: rawKey,
            assetMap: { ETH: 4 },
          });
        }
        return adapter;
      });
    } catch {
      configuredAdapters = adapters;
    }

    sourceWallet = createWalletFromConfig(keyConfig, input.sourceChainId, sourceProvider.rpcUrl);
    destinationWallet = createWalletFromConfig(
      keyConfig,
      destinationChainId,
      destinationProvider.rpcUrl
    );
  } else if (input.hasKey) {
    keyConfig = await resolveKeyConfig(input.options, spinner);
    try {
      const rawKey = loadPrivateKey(keyConfig);
      configuredAdapters = adapters.map((adapter) => {
        if (adapter.meta.name === "hyperliquid") {
          return createHyperliquidAdapter({
            privateKey: rawKey,
            assetMap: { ETH: 4 },
          });
        }
        return adapter;
      });
    } catch {
      configuredAdapters = adapters;
    }
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
    advisoryTraceLogger: input.options.json ? undefined : console.log,
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
    advisoryTraceLogger: input.options.json ? undefined : console.log,
    advisorSkillsDirs,
    stateDir: input.options.stateDir,
    noState: input.noState,
    agentDir: input.options.piAgentDir,
    cwd: process.cwd(),
  });
  const advisoryEventCallback = input.options.json
    ? undefined
    : createAdvisoryLiveTraceLogger(console.log, {
        verbose: input.options.advisoryTraceVerbose,
      });

  const dbPath = input.options.stateDir ? join(input.options.stateDir, "grimoire.db") : undefined;
  let store: SqliteStateStore | undefined;
  if (!input.noState) {
    try {
      store = new SqliteStateStore({ dbPath });
    } catch (error) {
      if (isMissingNodeSqliteBackend(error)) {
        console.log(
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
    : 1.1;
  const confirmCallback =
    input.options.skipConfirm || isTestnet(input.sourceChainId)
      ? async () => true
      : async (message: string) => {
          console.log(message);
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
      const result = await execute({
        spell: input.sourceSpell,
        runId,
        vault: vault as Address,
        chain: input.sourceChainId,
        params: input.params,
        persistentState: sourceState,
        simulate: input.mode === "simulate",
        executionMode: input.mode === "simulate" ? undefined : input.mode,
        wallet: input.mode === "execute" ? sourceWallet : undefined,
        provider: sourceProvider,
        gasMultiplier,
        confirmCallback,
        skipTestnetConfirmation: input.options.skipConfirm ?? false,
        adapters: configuredAdapters,
        advisorSkillsDirs: advisorSkillsDirs.length > 0 ? advisorSkillsDirs : undefined,
        onAdvisory: sourceOnAdvisory,
        eventCallback: advisoryEventCallback,
        warningCallback: (message) => console.log(chalk.yellow(`Warning: ${message}`)),
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
        vault: vault as Address,
        chain: destinationChainId,
        params,
        persistentState: destinationState,
        simulate: input.mode === "simulate",
        executionMode: input.mode === "simulate" ? undefined : input.mode,
        wallet: input.mode === "execute" ? destinationWallet : undefined,
        provider: destinationProvider,
        gasMultiplier,
        confirmCallback,
        skipTestnetConfirmation: input.options.skipConfirm ?? false,
        adapters: configuredAdapters,
        advisorSkillsDirs: advisorSkillsDirs.length > 0 ? advisorSkillsDirs : undefined,
        onAdvisory: destinationOnAdvisory,
        eventCallback: advisoryEventCallback,
        warningCallback: (message) => console.log(chalk.yellow(`Warning: ${message}`)),
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
    console.log(
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
    console.log();
    console.log(chalk.cyan("🔀 Cross-Chain Run:"));
    console.log(`  ${chalk.dim("Run ID:")} ${runId}`);
    console.log(
      `  ${chalk.dim("Source:")} ${input.sourceSpell.meta.name} (${input.sourceChainId}) -> ${chalk.dim("Destination:")} ${destinationSpell.meta.name} (${destinationChainId})`
    );
    console.log(`  ${chalk.dim("Watch:")} ${input.options.watch === true ? "Yes" : "No"}`);
    console.log(
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
      console.log(
        `  ${chalk.dim(`track:${track.trackId}`)} ${trackStatus} chain=${track.chainId} spell=${track.spellId}`
      );
      if (track.error) {
        console.log(`    ${chalk.red(track.error)}`);
      }
    }
    for (const handoff of orchestration.handoffs) {
      console.log(
        `  ${chalk.dim(`handoff:${handoff.handoffId}`)} ${handoff.status} submitted=${handoff.submittedAmount.toString()} settled=${handoff.settledAmount?.toString() ?? "n/a"}`
      );
    }
    if (orchestration.pending) {
      console.log();
      console.log(chalk.yellow("Run is waiting for handoff settlement. Resume with:"));
      console.log(chalk.yellow(`  grimoire resume ${runId} --watch`));
    }
  }

  if (!orchestration.success && !orchestration.pending) {
    process.exit(1);
  }
}

async function safeGetBlockNumber(provider: Provider): Promise<bigint | undefined> {
  try {
    return await provider.getBlockNumber();
  } catch {
    return undefined;
  }
}

async function resolveKeyConfig(
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
      console.log(chalk.dim("  Run 'grimoire wallet generate' to create one."));
      process.exit(1);
      throw new Error("unreachable");
    }
    const password = await resolveKeystorePassword(options, spinner);
    if (!password) {
      process.exit(1);
      throw new Error("unreachable");
    }
    const keystoreJson = readFileSync(keystorePath, "utf-8");
    return { type: "keystore", source: keystoreJson, password };
  }

  throw new Error("Execution mode requires wallet credentials, but no key source was provided");
}

function resolveVaultAddress(explicitVault?: string, fallbackWalletAddress?: string): string {
  if (explicitVault && explicitVault.length > 0) {
    return explicitVault;
  }
  if (fallbackWalletAddress && fallbackWalletAddress.length > 0) {
    return fallbackWalletAddress;
  }
  return "0x0000000000000000000000000000000000000000";
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

function resolveRpcUrlFromOption(chainId: number, value?: string | string[]): string | undefined {
  const parsed = parseRpcUrlMappings(value);
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
    sourceSpellId: string;
    destinationSpellId: string;
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
      status: "pending",
      idempotencyKey: `${runId}:${trackId}:${planned.stepId}`,
      updatedAt: nowIso,
    });
  }

  for (const tx of result.commit?.transactions ?? []) {
    const existing = byStep.get(tx.stepId);
    if (!existing) continue;
    existing.status = tx.success ? "confirmed" : "failed";
    existing.reference = tx.hash;
    existing.error = tx.error;
  }

  if (result.success && !result.commit) {
    for (const step of byStep.values()) {
      step.status = "confirmed";
    }
  }

  if (!result.success) {
    for (const step of byStep.values()) {
      if (step.status !== "confirmed") {
        step.status = "failed";
      }
    }
  }

  return [...byStep.values()];
}

async function resolveKeystorePassword(
  options: CastOptions,
  spinner: ReturnType<typeof ora>
): Promise<string | null> {
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
  process.exit(1);
  return null;
}

async function promptPassword(message: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(message);

    const silentOutput = new Writable({
      write(_chunk, _encoding, cb) {
        cb();
      },
    });

    const rl = readline.createInterface({
      input: process.stdin,
      output: silentOutput,
      terminal: true,
    });

    rl.question("", (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function confirmPrompt(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      const normalized = answer.toLowerCase().trim();
      resolve(normalized === "yes" || normalized === "y");
    });
  });
}

function resolveNoState(options: { noState?: boolean; state?: boolean }): boolean {
  if (typeof options.noState === "boolean") return options.noState;
  if (options.state === false) return true;
  return false;
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, innerValue) => (typeof innerValue === "bigint" ? innerValue.toString() : innerValue),
    2
  );
}
