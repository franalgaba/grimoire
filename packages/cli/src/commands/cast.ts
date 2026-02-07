/**
 * Cast Command
 * Executes a spell with optional live execution via private key
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as readline from "node:readline";
import { Writable } from "node:stream";
import {
  type Address,
  type ExecutionMode,
  type KeyConfig,
  type SpellIR,
  compileFile,
  createProvider,
  createWalletFromConfig,
  execute,
  formatWei,
  getChainName,
  getNativeCurrencySymbol,
  isTestnet,
  loadPrivateKey,
} from "@grimoirelabs/core";
import type { Provider, VenueAdapter } from "@grimoirelabs/core";
import { adapters, createHyperliquidAdapter } from "@grimoirelabs/venues";
import chalk from "chalk";
import ora from "ora";
import { resolveAdvisorSkillsDirs } from "./advisor-skill-helpers.js";
import { resolveAdvisoryHandler } from "./advisory-handlers.js";
import {
  type ReplayResolution,
  type RuntimeDataPolicy,
  type RuntimeFlow,
  buildRuntimeProvenanceManifest,
  enforceFreshnessPolicy,
  resolveDataPolicy,
  resolveReplayParams,
} from "./data-provenance.js";
import { buildRunReportEnvelope, formatRunReportText } from "./run-report.js";
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
  piAgentDir?: string;
  // Key options
  privateKey?: string;
  keyEnv?: string;
  mnemonic?: string;
  keystore?: string;
  passwordEnv?: string;
  // Execution options
  rpcUrl?: string;
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
  state?: boolean;
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

  const rpcUrl = options.rpcUrl ?? process.env.RPC_URL;
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
    advisorSkillsDirs,
    stateDir: options.stateDir,
    noState,
    agentDir: options.piAgentDir,
    cwd: process.cwd(),
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
    console.log(JSON.stringify(report, null, 2));
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
        chain: chainId,
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
    spinner.succeed(chalk.green("Simulation successful"));
  } else {
    spinner.fail(chalk.red(`Simulation failed: ${result.error}`));
  }

  const report = buildRunReportEnvelope({
    spellName: spell.meta.name,
    result,
    provenance,
  });

  console.log();
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatRunReportText(report));
  }

  if (!result.success) {
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
