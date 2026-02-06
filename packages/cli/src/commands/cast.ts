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
import type { VenueAdapter } from "@grimoirelabs/core";
import { adapters, createHyperliquidAdapter } from "@grimoirelabs/venues";
import chalk from "chalk";
import ora from "ora";
import { resolveAdvisorSkillsDirs } from "./advisor-skill-helpers.js";
import { resolveAdvisoryHandler } from "./advisory-handlers.js";
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
}

export async function castCommand(spellPath: string, options: CastOptions): Promise<void> {
  const spinner = ora(`Loading ${spellPath}...`).start();

  try {
    // Parse params
    let params: Record<string, unknown> = {};
    if (options.params) {
      try {
        params = JSON.parse(options.params);
      } catch {
        spinner.fail(chalk.red("Invalid params JSON"));
        process.exit(1);
      }
    }

    // Compile spell
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

    // Determine execution mode
    const hasExplicitKey = !!(options.privateKey || options.mnemonic || options.keystore);
    const hasEnvKey = !!(options.keyEnv && process.env[options.keyEnv]);
    const hasDefaultKeystore = !hasExplicitKey && !hasEnvKey && existsSync(DEFAULT_KEYSTORE_PATH);
    const hasKey = hasExplicitKey || hasEnvKey || hasDefaultKeystore;
    const mode: ExecutionMode = options.dryRun ? "dry-run" : hasKey ? "execute" : "simulate";

    if (options.privateKey || options.mnemonic) {
      console.log(
        chalk.yellow(
          "⚠️  Avoid passing secrets via CLI arguments. Use --key-env or env vars instead."
        )
      );
    }

    // Show spell info
    console.log();
    console.log(chalk.cyan("📜 Spell Info:"));
    console.log(`  ${chalk.dim("Name:")} ${spell.meta.name}`);
    console.log(`  ${chalk.dim("Version:")} ${spell.version}`);
    console.log(`  ${chalk.dim("Steps:")} ${spell.steps.length}`);
    console.log(`  ${chalk.dim("Mode:")} ${mode}`);

    // Show params being used
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

    // If we have a key, set up wallet execution
    if (hasKey && mode !== "simulate") {
      await executeWithWallet(spell, params, options, chainId, isTest);
    } else {
      // Simulation mode (existing behavior)
      await executeSimulation(spell, params, options, chainId);
    }
  } catch (error) {
    spinner.fail(chalk.red(`Cast failed: ${(error as Error).message}`));
    if (options.verbose) {
      console.error(error);
    }
    process.exit(1);
  }
}

/**
 * Execute spell with wallet (live execution)
 */
async function executeWithWallet(
  spell: SpellIR,
  params: Record<string, unknown>,
  options: CastOptions,
  chainId: number,
  isTest: boolean
): Promise<void> {
  const spinner = ora("Setting up wallet...").start();

  // Load wallet
  let keyConfig: KeyConfig;
  if (options.privateKey) {
    keyConfig = { type: "raw", source: options.privateKey };
  } else if (options.keyEnv && process.env[options.keyEnv]) {
    keyConfig = { type: "env", source: options.keyEnv };
  } else if (options.mnemonic) {
    keyConfig = { type: "mnemonic", source: options.mnemonic };
  } else {
    // Resolve keystore: explicit --keystore or default path
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

  // Wire Hyperliquid adapter with extracted private key
  let configuredAdapters: VenueAdapter[] = adapters;
  try {
    const rawKey = loadPrivateKey(keyConfig);
    configuredAdapters = adapters.map((a) => {
      if (a.meta.name === "hyperliquid") {
        return createHyperliquidAdapter({
          privateKey: rawKey,
          assetMap: { ETH: 4 },
        });
      }
      return a;
    });
  } catch {
    // If key extraction fails (e.g. mnemonic), keep default adapters
  }

  // Get RPC URL
  const rpcUrl = options.rpcUrl ?? process.env.RPC_URL;
  if (!rpcUrl) {
    spinner.warn(chalk.yellow("No RPC URL provided, using default public RPC"));
  }

  // Create provider and wallet
  const provider = createProvider(chainId, rpcUrl);
  const wallet = createWalletFromConfig(keyConfig, chainId, provider.rpcUrl);

  spinner.succeed(chalk.green(`Wallet loaded: ${wallet.address}`));

  // Check wallet balance
  const balance = await provider.getBalance(wallet.address);
  console.log(
    `  ${chalk.dim("Balance:")} ${formatWei(balance)} ${getNativeCurrencySymbol(chainId)}`
  );

  if (balance === 0n) {
    console.log(chalk.yellow(`  ⚠️  Wallet has no ${getNativeCurrencySymbol(chainId)} for gas`));
  }

  // Vault address (use wallet address if not provided)
  const vault = (options.vault ?? wallet.address) as Address;
  console.log(`  ${chalk.dim("Vault:")} ${vault}`);

  // Mainnet warning
  if (!isTest) {
    console.log();
    console.log(chalk.red("⚠️  WARNING: This is MAINNET"));
    console.log(chalk.red("   Real funds will be used!"));
  }

  const executionMode: ExecutionMode = options.dryRun ? "dry-run" : "execute";
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
    noState: options.noState,
    agentDir: options.piAgentDir,
    cwd: process.cwd(),
  });

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
    { stateDir: options.stateDir, noState: options.noState },
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

  // Show execution summary
  console.log();
  console.log(chalk.cyan("📊 Execution Summary:"));
  console.log(`  ${chalk.dim("Run ID:")} ${execResult.runId}`);
  console.log(`  ${chalk.dim("Duration:")} ${execResult.duration}ms`);
  console.log(`  ${chalk.dim("Steps executed:")} ${execResult.metrics.stepsExecuted}`);
  console.log(`  ${chalk.dim("Actions executed:")} ${execResult.metrics.actionsExecuted}`);

  if (execResult.metrics.gasUsed > 0n) {
    console.log(`  ${chalk.dim("Gas used:")} ${execResult.metrics.gasUsed.toString()}`);
  }

  if (execResult.metrics.errors > 0) {
    console.log(`  ${chalk.red("Errors:")} ${execResult.metrics.errors}`);
  }

  showFinalState(execResult.finalState);

  if (!execResult.success) {
    process.exit(1);
  }
}

/**
 * Execute spell in simulation mode (no wallet)
 */
async function executeSimulation(
  spell: SpellIR,
  params: Record<string, unknown>,
  options: CastOptions,
  chainId: number
): Promise<void> {
  const spinner = ora("Running simulation...").start();

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
    noState: options.noState,
    agentDir: options.piAgentDir,
    cwd: process.cwd(),
  });

  const result = await withStatePersistence(
    spell.id,
    { stateDir: options.stateDir, noState: options.noState },
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

  // Show execution summary
  console.log();
  console.log(chalk.cyan("📊 Execution Summary:"));
  console.log(`  ${chalk.dim("Run ID:")} ${result.runId}`);
  console.log(`  ${chalk.dim("Duration:")} ${result.duration}ms`);
  console.log(`  ${chalk.dim("Steps executed:")} ${result.metrics.stepsExecuted}`);
  console.log(`  ${chalk.dim("Actions executed:")} ${result.metrics.actionsExecuted}`);

  if (result.metrics.gasUsed > 0n) {
    console.log(`  ${chalk.dim("Gas used:")} ${result.metrics.gasUsed.toString()}`);
  }

  if (result.metrics.errors > 0) {
    console.log(`  ${chalk.red("Errors:")} ${result.metrics.errors}`);
  }

  showFinalState(result.finalState);

  if (!result.success) {
    process.exit(1);
  }
}

/**
 * Show final state if any
 */
function showFinalState(finalState: Record<string, unknown>): void {
  if (Object.keys(finalState).length > 0) {
    console.log();
    console.log(chalk.cyan("📦 Final State:"));
    for (const [key, value] of Object.entries(finalState)) {
      console.log(`  ${chalk.dim(key)}: ${JSON.stringify(value)}`);
    }
  }
}

/**
 * Resolve keystore password from env, interactive prompt, or error
 */
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

/**
 * Prompt for a password interactively (hides input)
 */
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

/**
 * Prompt for confirmation
 */
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
