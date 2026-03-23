/**
 * Setup UI Helpers
 * Interactive prompts, password resolution, and printing for setup command
 */

import { existsSync } from "node:fs";
import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import type ora from "ora";
import { DEFAULT_KEYSTORE_PATH } from "../lib/keystore.js";
import { promptLine, promptPassword } from "../lib/prompts.js";

export const DEFAULT_SETUP_ENV_FILE = join(".grimoire", "setup.env");
export const DEFAULT_PASSWORD_ENV = "KEYSTORE_PASSWORD";

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

export function shouldRunVenueDoctor(options: SetupOptions): boolean {
  if (options.noDoctor === true) {
    return false;
  }
  if (options.doctor === false) {
    return false;
  }
  return true;
}

export async function collectGuidedInputs(
  options: SetupOptions,
  spinner: ReturnType<typeof ora>
): Promise<SetupOptions> {
  const guided: SetupOptions = { ...options };

  spinner.stop();
  console.error();
  console.error(chalk.cyan("Guided Setup (Execute Mode)"));
  console.error(chalk.dim("Press Enter to accept defaults."));
  console.error(chalk.dim("Sensitive password prompts are hidden and never echoed."));
  if (guided.savePasswordEnv !== false) {
    console.error(
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

export async function promptWalletModeWithSpinner(
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

export function parsePositiveInteger(value: string | undefined, flag: string): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

export function normalizePrivateKey(value: string): `0x${string}` {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("Private key value is empty.");
  }
  return (trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`) as `0x${string}`;
}

export async function resolveExistingKeystorePassword(
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

export async function resolveNewKeystorePassword(
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

export async function promptPasswordWithSpinner(
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

export async function promptValueWithSpinner(
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

export async function promptYesNoWithSpinner(
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
    console.error(chalk.yellow("Please answer yes or no."));
    spinner.start();
  }
}

export async function promptLineWithSpinner(
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

export function printSetupStartWarning(passwordEnv: string): void {
  console.error(
    chalk.yellow("Security warning: never paste passwords or private keys into agent chat.")
  );
  console.error(
    chalk.dim(
      `Use hidden prompts, or preload secrets in your shell/secret manager and pass only --password-env ${passwordEnv}.`
    )
  );
  console.error();
}

export function printSetupPasswordGuidelines(passwordEnv: string, passwordEnvFile?: string): void {
  console.error();
  console.error(chalk.cyan("Password Safety"));
  console.error(
    chalk.white("  1. Do not type keystore passwords or private keys in Codex/Claude prompts.")
  );
  console.error(
    chalk.white(
      "  2. Prefer interactive hidden prompts: run commands without inline secret values."
    )
  );
  console.error(
    chalk.white(
      `  3. For non-interactive runs, preload ${passwordEnv} outside the agent and pass only the env var name.`
    )
  );
  if (passwordEnvFile) {
    console.error(
      chalk.white(
        `  4. Grimoire auto-loads ${passwordEnvFile} on startup (existing env vars still take precedence).`
      )
    );
    console.error(
      chalk.white(
        "  5. The env file is plaintext. Keep it local and rotate/delete when not needed."
      )
    );
    return;
  }
  console.error(
    chalk.white(
      "  4. Avoid inline secrets like KEYSTORE_PASSWORD=... grimoire ... because command logs may persist."
    )
  );
}

export async function writeSetupPasswordEnvFile(
  envName: string,
  password: string
): Promise<string> {
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
