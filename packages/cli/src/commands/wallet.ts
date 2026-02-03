/**
 * Wallet Command
 * Manage wallet lifecycle: generate, address, balance, import
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import * as readline from "node:readline";
import { Writable } from "node:stream";
import {
  type KeyConfig,
  createKeystore,
  createProvider,
  createWalletFromConfig,
  formatWei,
  generatePrivateKey,
  getAddressFromConfig,
  getChainName,
  getNativeCurrencySymbol,
} from "@grimoirelabs/core";
import chalk from "chalk";
import { Command } from "commander";
import ora from "ora";

const DEFAULT_KEYSTORE_DIR = join(homedir(), ".grimoire");
const DEFAULT_KEYSTORE_PATH = join(DEFAULT_KEYSTORE_DIR, "keystore.json");

interface SharedOptions {
  keystore?: string;
  passwordEnv?: string;
}

/**
 * Resolve the keystore file path from options or default
 */
function resolveKeystorePath(options: SharedOptions): string {
  return options.keystore ?? DEFAULT_KEYSTORE_PATH;
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
 * Resolve keystore password from env var, interactive prompt, or error
 */
async function resolveKeystorePassword(options: SharedOptions): Promise<string> {
  const envName = options.passwordEnv ?? "KEYSTORE_PASSWORD";
  const envValue = process.env[envName];

  if (envValue) {
    return envValue;
  }

  if (process.stdin.isTTY) {
    return await promptPassword("Keystore password: ");
  }

  throw new Error(`No password available. Set ${envName} or run interactively.`);
}

/**
 * Prompt for password with confirmation (for create/import flows)
 */
async function resolveNewKeystorePassword(options: SharedOptions): Promise<string> {
  const envName = options.passwordEnv ?? "KEYSTORE_PASSWORD";
  const envValue = process.env[envName];

  if (envValue) {
    return envValue;
  }

  if (process.stdin.isTTY) {
    const password = await promptPassword("New keystore password: ");
    const confirm = await promptPassword("Confirm password: ");

    if (password !== confirm) {
      throw new Error("Passwords do not match.");
    }

    if (!password) {
      throw new Error("Password must not be empty.");
    }

    return password;
  }

  throw new Error(`No password available. Set ${envName} or run interactively.`);
}

// ── Subcommands ─────────────────────────────────────────────────────

async function generateAction(options: SharedOptions & { printKey?: boolean; json?: boolean }) {
  const spinner = ora("Generating wallet...").start();

  try {
    // 1. Generate key
    const privateKey = generatePrivateKey();

    // 2. Derive address (use viem via getAddressFromConfig with raw key)
    const address = getAddressFromConfig({ type: "raw", source: privateKey });

    spinner.text = "Waiting for password...";
    spinner.stop();

    // 3. Prompt password
    const password = await resolveNewKeystorePassword(options);

    spinner.start("Encrypting keystore...");

    // 4. Encrypt
    const keystoreJson = await createKeystore(privateKey, password);

    // 5. Write file
    const keystorePath = resolveKeystorePath(options);
    const dir = dirname(keystorePath);

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(keystorePath, keystoreJson, "utf-8");

    spinner.succeed(chalk.green("Wallet generated"));

    if (options.json) {
      const output: Record<string, string> = {
        address,
        keystore: keystorePath,
      };
      if (options.printKey) {
        output.privateKey = privateKey;
      }
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`  ${chalk.dim("Address:")}  ${address}`);
      console.log(`  ${chalk.dim("Keystore:")} ${keystorePath}`);

      if (options.printKey) {
        console.log();
        console.log(
          chalk.yellow("  WARNING: Store this private key securely. It will not be shown again.")
        );
        console.log(`  ${chalk.dim("Private key:")} ${privateKey}`);
      }
    }
  } catch (error) {
    spinner.fail(chalk.red(`Failed: ${(error as Error).message}`));
    process.exit(1);
  }
}

async function addressAction(
  options: SharedOptions & { keyEnv?: string; mnemonic?: string; json?: boolean }
) {
  try {
    let keyConfig: KeyConfig;

    if (options.mnemonic) {
      keyConfig = { type: "mnemonic", source: options.mnemonic };
    } else if (options.keyEnv) {
      keyConfig = { type: "env", source: options.keyEnv };
    } else {
      // Default: keystore
      const keystorePath = resolveKeystorePath(options);
      if (!existsSync(keystorePath)) {
        console.error(chalk.red(`Keystore not found: ${keystorePath}`));
        console.error(chalk.dim("Run 'grimoire wallet generate' to create one."));
        process.exit(1);
      }

      const password = await resolveKeystorePassword(options);
      const keystoreJson = readFileSync(keystorePath, "utf-8");
      keyConfig = { type: "keystore", source: keystoreJson, password };
    }

    const address = getAddressFromConfig(keyConfig);

    if (options.json) {
      console.log(JSON.stringify({ address }));
    } else {
      console.log(address);
    }
  } catch (error) {
    console.error(chalk.red(`Failed: ${(error as Error).message}`));
    process.exit(1);
  }
}

async function balanceAction(
  options: SharedOptions & {
    chain?: string;
    rpcUrl?: string;
    keyEnv?: string;
    mnemonic?: string;
    json?: boolean;
  }
) {
  try {
    let keyConfig: KeyConfig;

    if (options.mnemonic) {
      keyConfig = { type: "mnemonic", source: options.mnemonic };
    } else if (options.keyEnv) {
      keyConfig = { type: "env", source: options.keyEnv };
    } else {
      const keystorePath = resolveKeystorePath(options);
      if (!existsSync(keystorePath)) {
        console.error(chalk.red(`Keystore not found: ${keystorePath}`));
        console.error(chalk.dim("Run 'grimoire wallet generate' to create one."));
        process.exit(1);
      }

      const password = await resolveKeystorePassword(options);
      const keystoreJson = readFileSync(keystorePath, "utf-8");
      keyConfig = { type: "keystore", source: keystoreJson, password };
    }

    const address = getAddressFromConfig(keyConfig);
    const chainId = Number.parseInt(options.chain ?? "1", 10);
    const chainName = getChainName(chainId);

    const spinner = ora(`Fetching balance on ${chainName}...`).start();

    const provider = createProvider(chainId, options.rpcUrl);
    const balance = await provider.getBalance(address);

    spinner.succeed(chalk.green("Balance retrieved"));

    if (options.json) {
      console.log(
        JSON.stringify({
          address,
          chain: chainId,
          chainName,
          balanceWei: balance.toString(),
          balance: formatWei(balance),
        })
      );
    } else {
      console.log(`  ${chalk.dim("Address:")} ${address}`);
      console.log(`  ${chalk.dim("Chain:")}   ${chainName} (${chainId})`);
      console.log(
        `  ${chalk.dim("Balance:")} ${formatWei(balance)} ${getNativeCurrencySymbol(chainId)}`
      );
    }
  } catch (error) {
    console.error(chalk.red(`Failed: ${(error as Error).message}`));
    process.exit(1);
  }
}

async function importAction(options: SharedOptions & { keyEnv?: string; json?: boolean }) {
  const spinner = ora("Importing wallet...").start();

  try {
    // Load existing key from env
    const envName = options.keyEnv ?? "PRIVATE_KEY";
    const rawKey = process.env[envName];

    if (!rawKey) {
      spinner.fail(chalk.red(`Environment variable ${envName} is not set`));
      process.exit(1);
    }

    // Derive address for validation
    const address = getAddressFromConfig({ type: "raw", source: rawKey });

    spinner.text = "Waiting for password...";
    spinner.stop();

    // Prompt new keystore password
    const password = await resolveNewKeystorePassword(options);

    spinner.start("Encrypting keystore...");

    // Normalize key
    const normalizedKey = rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`;

    // Encrypt
    const keystoreJson = await createKeystore(normalizedKey as `0x${string}`, password);

    // Write file
    const keystorePath = resolveKeystorePath(options);
    const dir = dirname(keystorePath);

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(keystorePath, keystoreJson, "utf-8");

    spinner.succeed(chalk.green("Wallet imported"));

    if (options.json) {
      console.log(JSON.stringify({ address, keystore: keystorePath }));
    } else {
      console.log(`  ${chalk.dim("Address:")}  ${address}`);
      console.log(`  ${chalk.dim("Keystore:")} ${keystorePath}`);
    }
  } catch (error) {
    spinner.fail(chalk.red(`Failed: ${(error as Error).message}`));
    process.exit(1);
  }
}

// ── WETH Constants ──────────────────────────────────────────────────

const WETH_ADDRESSES: Record<number, `0x${string}`> = {
  1: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  8453: "0x4200000000000000000000000000000000000006",
  10: "0x4200000000000000000000000000000000000006",
  42161: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
};

const WETH_DEPOSIT_SELECTOR = "0xd0e30db0";
const WETH_WITHDRAW_SELECTOR = "0x2e1a7d4d";

function ethToWei(eth: string): bigint {
  const [whole = "0", frac = ""] = eth.split(".");
  const padded = frac.padEnd(18, "0").slice(0, 18);
  return BigInt(whole) * 10n ** 18n + BigInt(padded);
}

async function wrapAction(
  options: SharedOptions & { amount: string; chain?: string; rpcUrl?: string; json?: boolean }
) {
  try {
    const keystorePath = resolveKeystorePath(options);
    if (!existsSync(keystorePath)) {
      console.error(chalk.red(`Keystore not found: ${keystorePath}`));
      console.error(chalk.dim("Run 'grimoire wallet generate' to create one."));
      process.exit(1);
    }

    const password = await resolveKeystorePassword(options);
    const keystoreJson = readFileSync(keystorePath, "utf-8");
    const keyConfig: KeyConfig = { type: "keystore", source: keystoreJson, password };

    const chainId = Number.parseInt(options.chain ?? "8453", 10);
    const nativeSymbol = getNativeCurrencySymbol(chainId);
    if (nativeSymbol !== "ETH") {
      console.error(
        chalk.red(`WETH only exists on ETH-native chains. Chain ${chainId} uses ${nativeSymbol}.`)
      );
      process.exit(1);
    }

    const wethAddress = WETH_ADDRESSES[chainId];
    if (!wethAddress) {
      console.error(chalk.red(`No known WETH address for chain ${chainId}`));
      process.exit(1);
    }

    const provider = createProvider(chainId, options.rpcUrl);
    const wallet = createWalletFromConfig(keyConfig, chainId, provider.rpcUrl);
    const amountWei = ethToWei(options.amount);

    const spinner = ora(`Wrapping ${options.amount} ETH → WETH on chain ${chainId}...`).start();

    const receipt = await wallet.sendTransaction({
      to: wethAddress,
      value: amountWei,
      data: WETH_DEPOSIT_SELECTOR,
    });

    if (receipt.status === "reverted") {
      spinner.fail(chalk.red("Transaction reverted"));
      console.error(`  Tx: ${receipt.hash}`);
      process.exit(1);
    }

    spinner.succeed(chalk.green(`Wrapped ${options.amount} ETH → WETH`));

    const balance = await provider.getBalance(wallet.address);

    if (options.json) {
      console.log(
        JSON.stringify({
          tx: receipt.hash,
          amount: options.amount,
          chain: chainId,
          balance: formatWei(balance),
        })
      );
    } else {
      console.log(`  ${chalk.dim("Tx:")}      ${receipt.hash}`);
      console.log(`  ${chalk.dim("Balance:")} ${formatWei(balance)} ETH`);
    }
  } catch (error) {
    console.error(chalk.red(`Failed: ${(error as Error).message}`));
    process.exit(1);
  }
}

async function unwrapAction(
  options: SharedOptions & { amount: string; chain?: string; rpcUrl?: string; json?: boolean }
) {
  try {
    const keystorePath = resolveKeystorePath(options);
    if (!existsSync(keystorePath)) {
      console.error(chalk.red(`Keystore not found: ${keystorePath}`));
      console.error(chalk.dim("Run 'grimoire wallet generate' to create one."));
      process.exit(1);
    }

    const password = await resolveKeystorePassword(options);
    const keystoreJson = readFileSync(keystorePath, "utf-8");
    const keyConfig: KeyConfig = { type: "keystore", source: keystoreJson, password };

    const chainId = Number.parseInt(options.chain ?? "8453", 10);
    const nativeSymbol = getNativeCurrencySymbol(chainId);
    if (nativeSymbol !== "ETH") {
      console.error(
        chalk.red(`WETH only exists on ETH-native chains. Chain ${chainId} uses ${nativeSymbol}.`)
      );
      process.exit(1);
    }

    const wethAddress = WETH_ADDRESSES[chainId];
    if (!wethAddress) {
      console.error(chalk.red(`No known WETH address for chain ${chainId}`));
      process.exit(1);
    }

    const provider = createProvider(chainId, options.rpcUrl);
    const wallet = createWalletFromConfig(keyConfig, chainId, provider.rpcUrl);
    const amountWei = ethToWei(options.amount);

    const amountHex = amountWei.toString(16).padStart(64, "0");
    const data = `${WETH_WITHDRAW_SELECTOR}${amountHex}`;

    const spinner = ora(`Unwrapping ${options.amount} WETH → ETH on chain ${chainId}...`).start();

    const receipt = await wallet.sendTransaction({
      to: wethAddress,
      data,
    });

    if (receipt.status === "reverted") {
      spinner.fail(chalk.red("Transaction reverted"));
      console.error(`  Tx: ${receipt.hash}`);
      process.exit(1);
    }

    spinner.succeed(chalk.green(`Unwrapped ${options.amount} WETH → ETH`));

    const balance = await provider.getBalance(wallet.address);

    if (options.json) {
      console.log(
        JSON.stringify({
          tx: receipt.hash,
          amount: options.amount,
          chain: chainId,
          balance: formatWei(balance),
        })
      );
    } else {
      console.log(`  ${chalk.dim("Tx:")}      ${receipt.hash}`);
      console.log(`  ${chalk.dim("Balance:")} ${formatWei(balance)} ETH`);
    }
  } catch (error) {
    console.error(chalk.red(`Failed: ${(error as Error).message}`));
    process.exit(1);
  }
}

// ── Command tree ────────────────────────────────────────────────────

export const walletCommand = new Command("wallet").description("Manage wallets and keystores");

walletCommand
  .command("generate")
  .description("Generate a new wallet and save to keystore")
  .option("--keystore <path>", "Path to keystore file")
  .option("--password-env <name>", "Environment variable for keystore password")
  .option("--print-key", "Print the private key (one-time backup)")
  .option("--json", "Output as JSON")
  .action(generateAction);

walletCommand
  .command("address")
  .description("Show wallet address")
  .option("--keystore <path>", "Path to keystore file")
  .option("--password-env <name>", "Environment variable for keystore password")
  .option("--key-env <name>", "Environment variable containing private key")
  .option("--mnemonic <phrase>", "Mnemonic phrase")
  .option("--json", "Output as JSON")
  .action(addressAction);

walletCommand
  .command("balance")
  .description("Check wallet balance")
  .option("--keystore <path>", "Path to keystore file")
  .option("--password-env <name>", "Environment variable for keystore password")
  .option("--key-env <name>", "Environment variable containing private key")
  .option("--mnemonic <phrase>", "Mnemonic phrase")
  .option("--chain <id>", "Chain ID", "1")
  .option("--rpc-url <url>", "RPC URL")
  .option("--json", "Output as JSON")
  .action(balanceAction);

walletCommand
  .command("import")
  .description("Import an existing private key into a keystore")
  .option("--keystore <path>", "Path to keystore file")
  .option("--password-env <name>", "Environment variable for keystore password")
  .option("--key-env <name>", "Environment variable containing private key", "PRIVATE_KEY")
  .option("--json", "Output as JSON")
  .action(importAction);

walletCommand
  .command("wrap")
  .description("Wrap native currency to WETH")
  .requiredOption("--amount <eth>", "Amount to wrap")
  .option("--chain <id>", "Chain ID", "8453")
  .option("--keystore <path>", "Path to keystore file")
  .option("--password-env <name>", "Environment variable for keystore password")
  .option("--rpc-url <url>", "RPC URL")
  .option("--json", "Output as JSON")
  .action(wrapAction);

walletCommand
  .command("unwrap")
  .description("Unwrap WETH to native currency")
  .requiredOption("--amount <eth>", "Amount to unwrap")
  .option("--chain <id>", "Chain ID", "8453")
  .option("--keystore <path>", "Path to keystore file")
  .option("--password-env <name>", "Environment variable for keystore password")
  .option("--rpc-url <url>", "RPC URL")
  .option("--json", "Output as JSON")
  .action(unwrapAction);
