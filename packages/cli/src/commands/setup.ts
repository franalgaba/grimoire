/**
 * Setup Command
 * Onboards local execute mode (wallet + RPC + readiness checks)
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
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
import { DEFAULT_KEYSTORE_PATH } from "../lib/keystore.js";
import {
  collectGuidedInputs,
  DEFAULT_PASSWORD_ENV,
  normalizePrivateKey,
  parsePositiveInteger,
  printSetupPasswordGuidelines,
  printSetupStartWarning,
  resolveExistingKeystorePassword,
  resolveNewKeystorePassword,
  resolveSetupRpcUrl,
  shouldRunVenueDoctor,
  writeSetupPasswordEnvFile,
} from "./setup-ui.js";
import { runVenueDoctor } from "./venue-doctor.js";

export { resolveSetupRpcUrl } from "./setup-ui.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

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

export async function setupCommand(options: SetupOptions): Promise<SetupReport> {
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
      console.error(JSON.stringify(report, null, 2));
      return report;
    }

    const adapter = effectiveOptions.adapter?.trim() || "uniswap";

    console.error();
    console.error(chalk.cyan("Setup Summary"));
    console.error(`  ${chalk.dim("Mode:")} execute`);
    console.error(`  ${chalk.dim("Chain:")} ${chainName} (${chainId})`);
    console.error(`  ${chalk.dim("RPC:")} ${effectiveRpcUrl}`);
    console.error(`  ${chalk.dim("Block:")} ${blockNumber.toString()}`);
    console.error(`  ${chalk.dim("Wallet:")} ${wallet.address}`);
    console.error(`  ${chalk.dim("Keystore:")} ${walletSetup.keystorePath}`);
    console.error(`  ${chalk.dim("Password env:")} ${passwordEnv}`);
    if (passwordEnvFile) {
      console.error(`  ${chalk.dim("Password env file:")} ${passwordEnvFile}`);
    }
    console.error(`  ${chalk.dim("Balance:")} ${balance} ${currency}`);
    if (balanceWei === 0n) {
      console.error(chalk.yellow(`  Warning: wallet balance is zero ${currency}.`));
    }
    if (venueDoctorSummary) {
      console.error(
        `  ${chalk.dim("Venue doctor:")} ${venueDoctorSummary.ok ? "pass" : "fail"} (${adapter})`
      );
    }

    const castCommand = `grimoire cast spells/uniswap-swap-execute.spell --dry-run --chain ${chainId} --rpc-url "${effectiveRpcUrl}" --keystore "${walletSetup.keystorePath}" --password-env ${passwordEnv}`;

    console.error();
    console.error(chalk.cyan("Next steps"));
    console.error(chalk.white(`  1. ${castCommand}`));
    console.error(
      chalk.white(
        `  2. grimoire venue doctor --adapter ${adapter} --chain ${chainId} --rpc-url "${effectiveRpcUrl}" --json`
      )
    );
    printSetupPasswordGuidelines(passwordEnv, passwordEnvFile);

    return report;
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
      console.error(JSON.stringify(payload, null, 2));
    }
    throw error;
  }
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
