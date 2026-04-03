/**
 * Cast Command
 * Executes a spell with optional live execution via private key
 */

import { existsSync, readFileSync } from "node:fs";
import type { VenueAdapter } from "@grimoirelabs/core";
import {
  type Address,
  compileFile,
  createProvider,
  createWalletFromConfig,
  type ExecutionMode,
  execute,
  formatWei,
  getChainName,
  getNativeCurrencySymbol,
  isTestnet,
  type KeyConfig,
  type SpellIR,
} from "@grimoirelabs/core";
import { adapters, createCompositeQueryProvider } from "@grimoirelabs/venues";
import chalk from "chalk";
import ora from "ora";
import { hydrateParamsFromEnsProfile, resolveEnsProfile } from "../lib/ens-profile.js";
import { resolveNoState, resolveRpcUrlFromOption } from "../lib/execution-helpers.js";
import { stringifyJson } from "../lib/json.js";
import { DEFAULT_KEYSTORE_PATH } from "../lib/keystore.js";
import { confirmPrompt } from "../lib/prompts.js";
import { resolveAdvisorSkillsDirs } from "./advisor-skill-helpers.js";
import { resolveAdvisoryHandler } from "./advisory-handlers.js";
import { createAdvisoryLiveTraceLogger } from "./advisory-live-trace.js";
import {
  configureOffchainAdapters,
  executeCrossChainCast,
  resolveKeystorePassword,
  safeGetBlockNumber,
} from "./cast-cross-chain.js";
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

const DEFAULT_GAS_MULTIPLIER = 1.1;

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

export async function castCommand(
  spellPath: string,
  options: CastOptions
): Promise<Record<string, unknown> | undefined> {
  const spinner = ora(`Loading ${spellPath}...`).start();

  try {
    let params: Record<string, unknown> = {};
    if (options.params) {
      try {
        params = JSON.parse(options.params);
      } catch {
        spinner.fail(chalk.red("Invalid params JSON"));
        throw new Error("Cast failed");
      }
    }

    if (options.ensName) {
      spinner.text = `Resolving ENS profile ${options.ensName}...`;
      const profile = await resolveEnsProfile(options.ensName, { rpcUrl: options.ensRpcUrl });
      params = hydrateParamsFromEnsProfile(params, profile);
      console.error(
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
        console.error(chalk.red(`  [${error.code}] ${error.message}`));
      }
      throw new Error("Cast failed");
    }

    const spell = compileResult.ir;
    spinner.succeed(chalk.green("Spell compiled successfully"));

    // Validate --trigger option against available triggers
    if (options.trigger) {
      const anyTrigger = spell.triggers.find((t) => t.type === "any");
      if (!anyTrigger || anyTrigger.type !== "any" || !spell.triggerStepMap) {
        console.error(
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
      console.error(
        chalk.yellow(
          "Warning: Avoid passing secrets via CLI arguments. Use --key-env or env vars instead."
        )
      );
    }

    console.error();
    console.error(chalk.cyan("Spell Info:"));
    console.error(`  ${chalk.dim("Name:")} ${spell.meta.name}`);
    console.error(`  ${chalk.dim("Version:")} ${spell.version}`);
    console.error(`  ${chalk.dim("Steps:")} ${spell.steps.length}`);
    console.error(`  ${chalk.dim("Mode:")} ${mode}`);

    if (spell.params.length > 0) {
      console.error();
      console.error(chalk.cyan("Parameters:"));
      for (const param of spell.params) {
        const value = params[param.name] ?? param.default;
        console.error(`  ${chalk.dim(param.name)}: ${JSON.stringify(value)}`);
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

    console.error();
    console.error(chalk.cyan("Network:"));
    console.error(`  ${chalk.dim("Chain:")} ${chainName} (${chainId})`);
    console.error(`  ${chalk.dim("Testnet:")} ${isTest ? "Yes" : "No"}`);

    if (hasKey && mode !== "simulate") {
      return await executeWithWallet(
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
      return await executeSimulation(
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
    throw new Error("Cast failed");
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
): Promise<Record<string, unknown>> {
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
      console.error(chalk.dim("  Run 'grimoire wallet generate' to create one."));
      throw new Error("Cast failed");
    }

    const password = await resolveKeystorePassword(options, spinner);
    if (!password) {
      throw new Error("Cast failed");
    }

    const keystoreJson = readFileSync(keystorePath, "utf-8");
    keyConfig = { type: "keystore", source: keystoreJson, password };
  }

  const configuredAdapters: VenueAdapter[] = configureOffchainAdapters(keyConfig);

  const rpcUrl = resolveRpcUrlFromOption(chainId, options.rpcUrl);
  if (!rpcUrl) {
    spinner.warn(chalk.yellow("No RPC URL provided, using default public RPC"));
  }

  const provider = createProvider(chainId, rpcUrl);
  const wallet = createWalletFromConfig(keyConfig, chainId, provider.rpcUrl);

  spinner.succeed(chalk.green(`Wallet loaded: ${wallet.address}`));

  const balance = await provider.getBalance(wallet.address);
  console.error(
    `  ${chalk.dim("Balance:")} ${formatWei(balance)} ${getNativeCurrencySymbol(chainId)}`
  );

  if (balance === 0n) {
    console.error(
      chalk.yellow(`  Warning: Wallet has no ${getNativeCurrencySymbol(chainId)} for gas`)
    );
  }

  const vault = (options.vault ?? wallet.address) as Address;
  const queryProvider = createCompositeQueryProvider({
    provider,
    chainId,
    vault,
    rpcUrl,
    adapters: configuredAdapters,
    venueAliases: spell.aliases,
  });
  console.error(`  ${chalk.dim("Vault:")} ${vault}`);

  if (!isTest) {
    console.error();
    console.error(chalk.red("WARNING: This is MAINNET"));
    console.error(chalk.red("   Real funds will be used!"));
  }

  const executionMode: ExecutionMode = options.dryRun ? "dry-run" : "execute";
  const runtimeMode = executionMode === "dry-run" ? "cast_dry_run" : "cast_execute";
  const gasMultiplier = options.gasMultiplier
    ? Number.parseFloat(options.gasMultiplier)
    : DEFAULT_GAS_MULTIPLIER;
  const advisorSkillsDirs = resolveAdvisorSkillsDirs(options.advisorSkillsDir) ?? [];
  const onAdvisory = await resolveAdvisoryHandler(spell.id, {
    advisoryPi: options.advisoryPi,
    advisoryReplay: options.advisoryReplay,
    advisoryProvider: options.advisoryProvider,
    advisoryModel: options.advisoryModel,
    advisoryThinking: options.advisoryThinking,
    advisoryTools: options.advisoryTools,
    advisoryTraceVerbose: options.advisoryTraceVerbose,
    advisoryTraceLogger: options.json ? undefined : console.error,
    advisorSkillsDirs,
    stateDir: options.stateDir,
    noState,
    agentDir: options.piAgentDir,
    cwd: process.cwd(),
  });
  const eventCallback = options.json
    ? undefined
    : createAdvisoryLiveTraceLogger(console.error, {
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
    console.error(chalk.yellow(`Warning: ${warning}`));
  }

  const confirmCallback =
    options.skipConfirm || isTest
      ? async () => true
      : async (message: string) => {
          console.error(message);
          return await confirmPrompt(chalk.yellow("Proceed? (yes/no): "));
        };

  console.error();
  console.error(chalk.cyan(`Executing spell (${executionMode})...`));

  const execResult = await withStatePersistence(
    spell.id,
    {
      stateDir: options.stateDir,
      noState,
      buildRunProvenance: () => provenance,
      onUnavailable: () => {
        console.error(
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
          console.error(chalk.dim(`  ${message}`));
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
    console.error(chalk.green("Execution completed successfully"));
  } else {
    console.error(chalk.red(`Execution failed: ${execResult.error}`));
  }

  const report = buildRunReportEnvelope({
    spellName: spell.meta.name,
    result: execResult,
    provenance,
  });

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

  console.error();
  if (options.json) {
    console.error(stringifyJson(payload));
  } else {
    console.error(formatRunReportText(report));
  }

  if (!execResult.success) {
    throw new Error("Cast failed");
  }

  return payload;
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
): Promise<Record<string, unknown>> {
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
    console.error(chalk.yellow(`Warning: ${warning}`));
  }

  const vault = (options.vault ?? "0x0000000000000000000000000000000000000000") as Address;
  const simRpcUrl = resolveRpcUrlFromOption(chainId, options.rpcUrl);
  const needsSimProvider = !!simRpcUrl || spellUsesQueryFunctions(spell);
  const simProvider = needsSimProvider ? createProvider(chainId, simRpcUrl) : undefined;
  const simQueryProvider = simProvider
    ? createCompositeQueryProvider({
        provider: simProvider,
        chainId,
        vault,
        rpcUrl: simRpcUrl,
        adapters,
        venueAliases: spell.aliases,
      })
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
    advisoryTraceLogger: options.json ? undefined : console.error,
    advisorSkillsDirs,
    stateDir: options.stateDir,
    noState,
    agentDir: options.piAgentDir,
    cwd: process.cwd(),
  });
  const eventCallback = options.json
    ? undefined
    : createAdvisoryLiveTraceLogger(console.error, {
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
        console.error(
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

  const payload = {
    success: result.success,
    receipt: result.receipt,
    error: result.structuredError,
  };

  console.error();
  if (options.json) {
    console.error(stringifyJson(payload));
  } else {
    console.error(formatRunReportText(report));
  }

  if (!result.success) {
    throw new Error("Cast failed");
  }

  return payload;
}
