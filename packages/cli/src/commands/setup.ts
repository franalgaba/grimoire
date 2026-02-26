/**
 * Setup Command
 * Onboards local execute mode (wallet + RPC + readiness checks)
 */

import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import * as readline from "node:readline";
import { Writable } from "node:stream";
import {
  compile,
  createKeystore,
  createProvider,
  createWalletFromConfig,
  formatWei,
  generatePrivateKey,
  getAddressFromConfig,
  getChainName,
  getNativeCurrencySymbol,
  type KeyConfig,
  preview,
} from "@grimoirelabs/core";
import chalk from "chalk";
import ora from "ora";
import { runVenueDoctor } from "./venue-doctor.js";

const DEFAULT_KEYSTORE_PATH = join(homedir(), ".grimoire", "keystore.json");
const DEFAULT_SETUP_ENV_FILE = join(".grimoire", "setup.env");
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const DEFAULT_PASSWORD_ENV = "KEYSTORE_PASSWORD";

const SETUP_SMOKE_SPELL = `spell SetupSmoke {
  params: {
    amount: 21
  }

  on manual: {
    doubled = params.amount * 2
    emit setup_ok(input=params.amount, doubled=doubled)
  }
}`;

type WalletProvisionMode = "existing_keystore" | "import_env_key" | "generate";

interface SetupOptions {
  chain?: string;
  rpcUrl?: string;
  adapter?: string;
  keystore?: string;
  passwordEnv?: string;
  keyEnv?: string;
  importKey?: boolean;
  walletMode?: WalletProvisionMode;
  noDoctor?: boolean;
  doctor?: boolean;
  savePasswordEnv?: boolean;
  nonInteractive?: boolean;
  json?: boolean;
}

interface WalletSetupResult {
  mode: WalletProvisionMode;
  keyConfig: KeyConfig;
  keystorePath: string;
  address: `0x${string}`;
  password: string;
  passwordSource: "env" | "prompt";
}

interface SetupReport {
  success: boolean;
  mode: "execute";
  chainId: number;
  chainName: string;
  rpcUrl: string;
  rpcBlockNumber: string;
  wallet: {
    address: `0x${string}`;
    keystore: string;
    source: WalletProvisionMode;
    balance: string;
    balanceWei: string;
    currency: string;
  };
  smoke: {
    success: true;
    spell: string;
  };
  passwordEnv: {
    name: string;
    file?: string;
  };
  venueDoctor?: {
    adapter: string;
    ok: boolean;
    failedChecks: string[];
  };
}

interface SetupFailure {
  success: false;
  mode: "execute";
  stage: string;
  error: string;
}

export async function setupCommand(options: SetupOptions): Promise<void> {
  const interactive =
    options.nonInteractive !== true &&
    options.json !== true &&
    process.stdin.isTTY &&
    process.stdout.isTTY;
  const spinner = ora({
    text: "Configuring Grimoire execute mode...",
    isEnabled: interactive,
    discardStdin: false,
  });

  if (!options.json) {
    printSetupStartWarning(options.passwordEnv ?? DEFAULT_PASSWORD_ENV);
  }

  spinner.start();

  let stage = "init";

  try {
    stage = "guidance";
    const effectiveOptions = interactive ? await collectGuidedInputs(options, spinner) : options;
    const passwordEnv = effectiveOptions.passwordEnv ?? DEFAULT_PASSWORD_ENV;

    stage = "chain";
    const chainId = parsePositiveInteger(effectiveOptions.chain, "--chain");
    const chainName = getChainName(chainId);

    stage = "state-dir";
    await mkdir(".grimoire", { recursive: true });

    stage = "smoke";
    spinner.text = "Running local smoke preview...";
    await runSmokePreview(chainId);

    stage = "rpc";
    spinner.text = "Checking RPC connectivity...";
    const explicitRpc = effectiveOptions.rpcUrl?.trim();
    const rpcUrl = resolveSetupRpcUrl(chainId, explicitRpc, process.env);
    const provider = createProvider(chainId, rpcUrl);
    const blockNumber = await provider.getBlockNumber();
    const effectiveRpcUrl = provider.rpcUrl;

    stage = "wallet";
    spinner.text = "Preparing wallet credentials...";
    const walletSetup = await setupWallet(effectiveOptions, spinner, interactive);
    process.env[passwordEnv] = walletSetup.password;
    let passwordEnvFile: string | undefined;
    if (walletSetup.passwordSource === "prompt" && effectiveOptions.savePasswordEnv !== false) {
      stage = "password-env";
      spinner.text = "Saving password env helper...";
      passwordEnvFile = await writeSetupPasswordEnvFile(passwordEnv, walletSetup.password);
    }
    const wallet = createWalletFromConfig(walletSetup.keyConfig, chainId, effectiveRpcUrl);
    const balanceWei = await provider.getBalance(wallet.address);
    const balance = formatWei(balanceWei);
    const currency = getNativeCurrencySymbol(chainId);

    let venueDoctorSummary: SetupReport["venueDoctor"] | undefined;
    if (shouldRunVenueDoctor(effectiveOptions)) {
      stage = "venue-doctor";
      spinner.text = "Running venue doctor checks...";
      const adapter = effectiveOptions.adapter?.trim() || "uniswap";
      const venueDoctorReport = await runVenueDoctor(
        { chainId, adapter, rpcUrl: effectiveRpcUrl },
        {
          env: {
            ...process.env,
            GRIMOIRE_WALLET_ADDRESS: wallet.address,
            WALLET_ADDRESS: wallet.address,
          },
        }
      );

      venueDoctorSummary = {
        adapter,
        ok: venueDoctorReport.ok,
        failedChecks: venueDoctorReport.checks
          .filter((check) => check.status === "fail")
          .map((check) => check.name),
      };

      if (!venueDoctorReport.ok) {
        throw new Error(
          `Venue doctor failed (${adapter}): ${venueDoctorSummary.failedChecks.join(", ")}`
        );
      }
    }

    spinner.succeed(chalk.green("Execute mode setup completed"));

    const report: SetupReport = {
      success: true,
      mode: "execute",
      chainId,
      chainName,
      rpcUrl: effectiveRpcUrl,
      rpcBlockNumber: blockNumber.toString(),
      wallet: {
        address: wallet.address,
        keystore: walletSetup.keystorePath,
        source: walletSetup.mode,
        balance,
        balanceWei: balanceWei.toString(),
        currency,
      },
      smoke: {
        success: true,
        spell: "SetupSmoke",
      },
      passwordEnv: {
        name: passwordEnv,
        file: passwordEnvFile,
      },
      venueDoctor: venueDoctorSummary,
    };

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    const adapter = effectiveOptions.adapter?.trim() || "uniswap";

    console.log();
    console.log(chalk.cyan("Setup Summary"));
    console.log(`  ${chalk.dim("Mode:")} execute`);
    console.log(`  ${chalk.dim("Chain:")} ${chainName} (${chainId})`);
    console.log(`  ${chalk.dim("RPC:")} ${effectiveRpcUrl}`);
    console.log(`  ${chalk.dim("Block:")} ${blockNumber.toString()}`);
    console.log(`  ${chalk.dim("Wallet:")} ${wallet.address}`);
    console.log(`  ${chalk.dim("Keystore:")} ${walletSetup.keystorePath}`);
    console.log(`  ${chalk.dim("Password env:")} ${passwordEnv}`);
    if (passwordEnvFile) {
      console.log(`  ${chalk.dim("Password env file:")} ${passwordEnvFile}`);
    }
    console.log(`  ${chalk.dim("Balance:")} ${balance} ${currency}`);
    if (balanceWei === 0n) {
      console.log(chalk.yellow(`  Warning: wallet balance is zero ${currency}.`));
    }
    if (venueDoctorSummary) {
      console.log(
        `  ${chalk.dim("Venue doctor:")} ${venueDoctorSummary.ok ? "pass" : "fail"} (${adapter})`
      );
    }

    const castCommand = `grimoire cast spells/uniswap-swap-execute.spell --dry-run --chain ${chainId} --rpc-url "${effectiveRpcUrl}" --keystore "${walletSetup.keystorePath}" --password-env ${passwordEnv}`;

    console.log();
    console.log(chalk.cyan("Next steps"));
    console.log(chalk.white(`  1. ${castCommand}`));
    console.log(
      chalk.white(
        `  2. grimoire venue doctor --adapter ${adapter} --chain ${chainId} --rpc-url "${effectiveRpcUrl}" --json`
      )
    );
    printSetupPasswordGuidelines(passwordEnv, passwordEnvFile);
  } catch (error) {
    const message = (error as Error).message;
    spinner.fail(chalk.red(`Setup failed: ${message}`));

    if (options.json) {
      const payload: SetupFailure = {
        success: false,
        mode: "execute",
        stage,
        error: message,
      };
      console.log(JSON.stringify(payload, null, 2));
    }
    process.exit(1);
  }
}

function shouldRunVenueDoctor(options: SetupOptions): boolean {
  if (options.noDoctor === true) {
    return false;
  }
  if (options.doctor === false) {
    return false;
  }
  return true;
}

async function collectGuidedInputs(
  options: SetupOptions,
  spinner: ReturnType<typeof ora>
): Promise<SetupOptions> {
  const guided: SetupOptions = { ...options };

  spinner.stop();
  console.log();
  console.log(chalk.cyan("Guided Setup (Execute Mode)"));
  console.log(chalk.dim("Press Enter to accept defaults."));
  console.log(chalk.dim("Sensitive password prompts are hidden and never echoed."));
  if (guided.savePasswordEnv !== false) {
    console.log(
      chalk.dim(
        `If you enter a password, setup will save ${DEFAULT_SETUP_ENV_FILE} for command reuse.`
      )
    );
  }
  spinner.start();

  if (!guided.chain) {
    guided.chain = await promptValueWithSpinner(spinner, "Chain ID", "1");
  }
  const chainId = parsePositiveInteger(guided.chain, "--chain");

  if (!guided.rpcUrl) {
    const detected = resolveSetupRpcUrl(chainId, undefined, process.env);
    const rpcInput = await promptValueWithSpinner(
      spinner,
      "RPC URL (blank to use default public RPC)",
      detected
    );
    guided.rpcUrl = rpcInput.trim().length > 0 ? rpcInput.trim() : undefined;
  }

  if (guided.noDoctor === undefined && guided.doctor === undefined) {
    const runDoctor = await promptYesNoWithSpinner(spinner, "Run venue doctor checks?", true);
    guided.noDoctor = !runDoctor;
  }

  if (shouldRunVenueDoctor(guided) && (!guided.adapter || guided.adapter.trim().length === 0)) {
    guided.adapter = await promptValueWithSpinner(spinner, "Adapter for venue doctor", "uniswap");
  }

  if (!guided.keystore || guided.keystore.trim().length === 0) {
    guided.keystore = await promptValueWithSpinner(spinner, "Keystore path", DEFAULT_KEYSTORE_PATH);
  }

  const keystorePath = guided.keystore ?? DEFAULT_KEYSTORE_PATH;
  const keyEnvDefault = guided.keyEnv ?? "PRIVATE_KEY";
  const hasDefaultEnvKey = Boolean(process.env[keyEnvDefault]);
  const keystoreExists = existsSync(keystorePath);

  if (guided.importKey === true) {
    guided.walletMode = "import_env_key";
  } else {
    guided.walletMode = await promptWalletModeWithSpinner(
      spinner,
      keystoreExists,
      hasDefaultEnvKey
    );
  }

  guided.importKey = guided.walletMode === "import_env_key";
  if (guided.walletMode === "import_env_key") {
    guided.keyEnv = await promptValueWithSpinner(spinner, "Private key env var", keyEnvDefault);
    const importEnvName = guided.keyEnv ?? keyEnvDefault;
    if (!process.env[importEnvName] || process.env[importEnvName]?.trim().length === 0) {
      throw new Error(
        `Environment variable ${importEnvName} is not set. Export it first or choose wallet generation.`
      );
    }
  }

  if (guided.walletMode !== "existing_keystore" && existsSync(keystorePath)) {
    const overwrite = await promptYesNoWithSpinner(
      spinner,
      `Keystore exists at ${keystorePath}. Overwrite?`,
      false
    );
    if (!overwrite) {
      throw new Error(
        "Setup canceled. Re-run with --keystore <new-path> or choose the existing keystore."
      );
    }
  }

  return guided;
}

async function promptWalletModeWithSpinner(
  spinner: ReturnType<typeof ora>,
  keystoreExists: boolean,
  hasDefaultEnvKey: boolean
): Promise<WalletProvisionMode> {
  if (keystoreExists) {
    const useExisting = await promptYesNoWithSpinner(spinner, "Use existing keystore?", true);
    if (useExisting) {
      return "existing_keystore";
    }
  }

  const importDefault = hasDefaultEnvKey;
  const importFromEnv = await promptYesNoWithSpinner(
    spinner,
    "Import wallet from a private key environment variable?",
    importDefault
  );
  if (importFromEnv) {
    return "import_env_key";
  }
  return "generate";
}

export function resolveSetupRpcUrl(
  chainId: number,
  explicitRpcUrl: string | undefined,
  env: Record<string, string | undefined>
): string | undefined {
  if (explicitRpcUrl && explicitRpcUrl.length > 0) {
    return explicitRpcUrl;
  }
  return env[`RPC_URL_${chainId}`] ?? env.RPC_URL;
}

export function selectWalletProvisionMode(input: {
  keystoreExists: boolean;
  importKey: boolean;
  keyEnvValue?: string;
}): WalletProvisionMode {
  if (input.keystoreExists) {
    return "existing_keystore";
  }
  if (input.importKey || (input.keyEnvValue !== undefined && input.keyEnvValue.length > 0)) {
    return "import_env_key";
  }
  return "generate";
}

async function runSmokePreview(chainId: number): Promise<void> {
  const compileResult = compile(SETUP_SMOKE_SPELL);
  if (!compileResult.success || !compileResult.ir) {
    const firstError = compileResult.errors[0];
    throw new Error(
      firstError ? `${firstError.code}: ${firstError.message}` : "Smoke compile failed"
    );
  }

  const result = await preview({
    spell: compileResult.ir,
    vault: ZERO_ADDRESS,
    chain: chainId,
  });

  if (!result.success) {
    throw new Error(result.error?.message ?? "Smoke preview failed");
  }
}

async function setupWallet(
  options: SetupOptions,
  spinner: ReturnType<typeof ora>,
  interactive: boolean
): Promise<WalletSetupResult> {
  const keystorePath = options.keystore ?? DEFAULT_KEYSTORE_PATH;
  const keyEnvName = options.keyEnv ?? "PRIVATE_KEY";
  const keyEnvValue = process.env[keyEnvName];
  const keystoreExists = existsSync(keystorePath);

  const mode =
    options.walletMode ??
    selectWalletProvisionMode({
      keystoreExists,
      importKey: options.importKey === true,
      keyEnvValue,
    });

  if (mode === "existing_keystore") {
    const password = await resolveExistingKeystorePassword(options, interactive, spinner);
    const keystoreJson = await readFile(keystorePath, "utf8");
    const keyConfig: KeyConfig = {
      type: "keystore",
      source: keystoreJson,
      password: password.value,
    };
    return {
      mode,
      keyConfig,
      keystorePath,
      address: getAddressFromConfig(keyConfig),
      password: password.value,
      passwordSource: password.source,
    };
  }

  if (mode === "import_env_key") {
    if (!keyEnvValue) {
      throw new Error(`Environment variable ${keyEnvName} is required for wallet import.`);
    }
    const normalizedKey = normalizePrivateKey(keyEnvValue);
    const password = await resolveNewKeystorePassword(options, interactive, spinner);
    const keystoreJson = await createKeystore(normalizedKey, password.value);
    await mkdir(dirname(keystorePath), { recursive: true });
    await writeFile(keystorePath, keystoreJson, "utf8");

    const keyConfig: KeyConfig = {
      type: "keystore",
      source: keystoreJson,
      password: password.value,
    };
    return {
      mode,
      keyConfig,
      keystorePath,
      address: getAddressFromConfig(keyConfig),
      password: password.value,
      passwordSource: password.source,
    };
  }

  const privateKey = generatePrivateKey();
  const password = await resolveNewKeystorePassword(options, interactive, spinner);
  const keystoreJson = await createKeystore(privateKey, password.value);
  await mkdir(dirname(keystorePath), { recursive: true });
  await writeFile(keystorePath, keystoreJson, "utf8");

  const keyConfig: KeyConfig = {
    type: "keystore",
    source: keystoreJson,
    password: password.value,
  };
  return {
    mode,
    keyConfig,
    keystorePath,
    address: getAddressFromConfig(keyConfig),
    password: password.value,
    passwordSource: password.source,
  };
}

function parsePositiveInteger(value: string | undefined, flag: string): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function normalizePrivateKey(value: string): `0x${string}` {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("Private key value is empty.");
  }
  return (trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`) as `0x${string}`;
}

async function resolveExistingKeystorePassword(
  options: SetupOptions,
  interactive: boolean,
  spinner: ReturnType<typeof ora>
): Promise<{ value: string; source: "env" | "prompt" }> {
  const envName = options.passwordEnv ?? DEFAULT_PASSWORD_ENV;
  const envValue = process.env[envName];
  if (envValue) {
    return { value: envValue, source: "env" };
  }

  if (!interactive) {
    throw new Error(`No keystore password available. Set ${envName} or run interactively.`);
  }

  return {
    value: await promptPasswordWithSpinner(spinner, "Keystore password: "),
    source: "prompt",
  };
}

async function resolveNewKeystorePassword(
  options: SetupOptions,
  interactive: boolean,
  spinner: ReturnType<typeof ora>
): Promise<{ value: string; source: "env" | "prompt" }> {
  const envName = options.passwordEnv ?? DEFAULT_PASSWORD_ENV;
  const envValue = process.env[envName];
  if (envValue) {
    return { value: envValue, source: "env" };
  }

  if (!interactive) {
    throw new Error(`No keystore password available. Set ${envName} or run interactively.`);
  }

  const password = await promptPasswordWithSpinner(spinner, "New keystore password: ");
  const confirm = await promptPasswordWithSpinner(spinner, "Confirm password: ");
  if (password !== confirm) {
    throw new Error("Passwords do not match.");
  }
  if (password.length === 0) {
    throw new Error("Password must not be empty.");
  }
  return { value: password, source: "prompt" };
}

async function promptPasswordWithSpinner(
  spinner: ReturnType<typeof ora>,
  message: string
): Promise<string> {
  spinner.stop();
  try {
    return await promptPassword(message);
  } finally {
    spinner.start();
  }
}

async function promptValueWithSpinner(
  spinner: ReturnType<typeof ora>,
  label: string,
  defaultValue?: string
): Promise<string> {
  const prompt = defaultValue ? `${label} [${defaultValue}]: ` : `${label}: `;
  const value = (await promptLineWithSpinner(spinner, prompt)).trim();
  if (value.length > 0) {
    return value;
  }
  return defaultValue ?? "";
}

async function promptYesNoWithSpinner(
  spinner: ReturnType<typeof ora>,
  label: string,
  defaultValue: boolean
): Promise<boolean> {
  const suffix = defaultValue ? "Y/n" : "y/N";
  while (true) {
    const answer = (await promptLineWithSpinner(spinner, `${label} [${suffix}]: `))
      .trim()
      .toLowerCase();
    if (answer.length === 0) {
      return defaultValue;
    }
    if (answer === "y" || answer === "yes") {
      return true;
    }
    if (answer === "n" || answer === "no") {
      return false;
    }
    spinner.stop();
    console.log(chalk.yellow("Please answer yes or no."));
    spinner.start();
  }
}

async function promptLineWithSpinner(
  spinner: ReturnType<typeof ora>,
  message: string
): Promise<string> {
  spinner.stop();
  try {
    return await promptLine(message);
  } finally {
    spinner.start();
  }
}

async function promptLine(message: string): Promise<string> {
  return await new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    rl.question(message, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function promptPassword(message: string): Promise<string> {
  return await new Promise((resolve) => {
    process.stdout.write(message);

    const silentOutput = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
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

function printSetupStartWarning(passwordEnv: string): void {
  console.log(
    chalk.yellow("Security warning: never paste passwords or private keys into agent chat.")
  );
  console.log(
    chalk.dim(
      `Use hidden prompts, or preload secrets in your shell/secret manager and pass only --password-env ${passwordEnv}.`
    )
  );
  console.log();
}

function printSetupPasswordGuidelines(passwordEnv: string, passwordEnvFile?: string): void {
  console.log();
  console.log(chalk.cyan("Password Safety"));
  console.log(
    chalk.white("  1. Do not type keystore passwords or private keys in Codex/Claude prompts.")
  );
  console.log(
    chalk.white(
      "  2. Prefer interactive hidden prompts: run commands without inline secret values."
    )
  );
  console.log(
    chalk.white(
      `  3. For non-interactive runs, preload ${passwordEnv} outside the agent and pass only the env var name.`
    )
  );
  if (passwordEnvFile) {
    console.log(
      chalk.white(
        `  4. Grimoire auto-loads ${passwordEnvFile} on startup (existing env vars still take precedence).`
      )
    );
    console.log(
      chalk.white(
        "  5. The env file is plaintext. Keep it local and rotate/delete when not needed."
      )
    );
    return;
  }
  console.log(
    chalk.white(
      "  4. Avoid inline secrets like KEYSTORE_PASSWORD=... grimoire ... because command logs may persist."
    )
  );
}

async function writeSetupPasswordEnvFile(envName: string, password: string): Promise<string> {
  const escaped = password.replaceAll("'", "'\"'\"'");
  const content = [
    "# Generated by grimoire setup. Contains sensitive data.",
    "# Keep this file local and do not commit it.",
    `export ${envName}='${escaped}'`,
    "",
  ].join("\n");
  await writeFile(DEFAULT_SETUP_ENV_FILE, content, { encoding: "utf8", mode: 0o600 });
  await chmod(DEFAULT_SETUP_ENV_FILE, 0o600);
  return DEFAULT_SETUP_ENV_FILE;
}
