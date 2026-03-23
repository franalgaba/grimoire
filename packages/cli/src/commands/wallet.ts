/**
 * Wallet Command
 * Manage wallet lifecycle: generate, address, balance, import, wrap, unwrap
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  createKeystore,
  createProvider,
  formatWei,
  generatePrivateKey,
  getAddressFromConfig,
  getChainName,
  getNativeCurrencySymbol,
  type KeyConfig,
} from "@grimoirelabs/core";
import chalk from "chalk";
import { Cli, z } from "incur";
import ora from "ora";
import { resolveKeystorePath } from "../lib/keystore.js";
import { promptPassword } from "../lib/prompts.js";
import { unwrapAction, wrapAction } from "./wallet-weth.js";

interface SharedOptions {
  keystore?: string;
  passwordEnv?: string;
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

// ── Subcommand handlers ────────────────────────────────────────────

async function generateHandler(options: SharedOptions & { printKey?: boolean }) {
  const spinner = ora("Generating wallet...").start();

  const privateKey = generatePrivateKey();
  const address = getAddressFromConfig({ type: "raw", source: privateKey });

  spinner.text = "Waiting for password...";
  spinner.stop();

  const password = await resolveNewKeystorePassword(options);

  spinner.start("Encrypting keystore...");
  const keystoreJson = await createKeystore(privateKey, password);

  const keystorePath = resolveKeystorePath(options);
  const dir = dirname(keystorePath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(keystorePath, keystoreJson, "utf-8");
  spinner.succeed(chalk.green("Wallet generated"));

  const output: Record<string, string> = { address, keystore: keystorePath };
  if (options.printKey) {
    console.error();
    console.error(
      chalk.yellow("  WARNING: Store this private key securely. It will not be shown again.")
    );
    console.error(`  ${chalk.dim("Private key:")} ${privateKey}`);
    output.privateKey = privateKey;
  } else {
    console.error(`  ${chalk.dim("Address:")}  ${address}`);
    console.error(`  ${chalk.dim("Keystore:")} ${keystorePath}`);
  }

  return output;
}

async function addressHandler(options: SharedOptions & { keyEnv?: string; mnemonic?: string }) {
  let keyConfig: KeyConfig;

  if (options.mnemonic) {
    keyConfig = { type: "mnemonic", source: options.mnemonic };
  } else if (options.keyEnv) {
    keyConfig = { type: "env", source: options.keyEnv };
  } else {
    const keystorePath = resolveKeystorePath(options);
    if (!existsSync(keystorePath)) {
      throw new Error(
        `Keystore not found: ${keystorePath}. Run 'grimoire wallet generate' to create one.`
      );
    }

    const password = await resolveKeystorePassword(options);
    const keystoreJson = readFileSync(keystorePath, "utf-8");
    keyConfig = { type: "keystore", source: keystoreJson, password };
  }

  const address = getAddressFromConfig(keyConfig);
  console.error(address);
  return { address };
}

async function balanceHandler(
  options: SharedOptions & {
    chain?: string;
    rpcUrl?: string;
    keyEnv?: string;
    mnemonic?: string;
  }
) {
  let keyConfig: KeyConfig;

  if (options.mnemonic) {
    keyConfig = { type: "mnemonic", source: options.mnemonic };
  } else if (options.keyEnv) {
    keyConfig = { type: "env", source: options.keyEnv };
  } else {
    const keystorePath = resolveKeystorePath(options);
    if (!existsSync(keystorePath)) {
      throw new Error(
        `Keystore not found: ${keystorePath}. Run 'grimoire wallet generate' to create one.`
      );
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

  console.error(`  ${chalk.dim("Address:")} ${address}`);
  console.error(`  ${chalk.dim("Chain:")}   ${chainName} (${chainId})`);
  console.error(
    `  ${chalk.dim("Balance:")} ${formatWei(balance)} ${getNativeCurrencySymbol(chainId)}`
  );

  return {
    address,
    chain: chainId,
    chainName,
    balanceWei: balance.toString(),
    balance: formatWei(balance),
  };
}

async function importHandler(options: SharedOptions & { keyEnv?: string }) {
  const spinner = ora("Importing wallet...").start();

  const envName = options.keyEnv ?? "PRIVATE_KEY";
  const rawKey = process.env[envName];

  if (!rawKey) {
    spinner.fail(chalk.red(`Environment variable ${envName} is not set`));
    throw new Error(`Environment variable ${envName} is not set`);
  }

  const address = getAddressFromConfig({ type: "raw", source: rawKey });

  spinner.text = "Waiting for password...";
  spinner.stop();

  const password = await resolveNewKeystorePassword(options);

  spinner.start("Encrypting keystore...");

  const normalizedKey = rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`;
  const keystoreJson = await createKeystore(normalizedKey as `0x${string}`, password);

  const keystorePath = resolveKeystorePath(options);
  const dir = dirname(keystorePath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(keystorePath, keystoreJson, "utf-8");
  spinner.succeed(chalk.green("Wallet imported"));

  console.error(`  ${chalk.dim("Address:")}  ${address}`);
  console.error(`  ${chalk.dim("Keystore:")} ${keystorePath}`);

  return { address, keystore: keystorePath };
}

// ── Shared option schemas ──────────────────────────────────────────

const keystoreOptions = z.object({
  keystore: z.string().optional().describe("Path to keystore file"),
  passwordEnv: z.string().optional().describe("Environment variable for keystore password"),
});

// ── Incur CLI ──────────────────────────────────────────────────────

export const walletCli = Cli.create("wallet", {
  description: "Manage wallets and keystores",
})
  .command("generate", {
    description: "Generate a new wallet and save to keystore",
    options: keystoreOptions.extend({
      printKey: z.boolean().optional().describe("Print the private key (one-time backup)"),
    }),
    async run(c) {
      const result = await generateHandler(c.options);
      return c.ok(result, { cta: { commands: ["wallet address", "wallet balance"] } });
    },
  })
  .command("address", {
    description: "Show wallet address",
    options: keystoreOptions.extend({
      keyEnv: z.string().optional().describe("Environment variable containing private key"),
      mnemonic: z.string().optional().describe("Mnemonic phrase"),
    }),
    async run(c) {
      const result = await addressHandler(c.options);
      return c.ok(result);
    },
  })
  .command("balance", {
    description: "Check wallet balance",
    options: keystoreOptions.extend({
      keyEnv: z.string().optional().describe("Environment variable containing private key"),
      mnemonic: z.string().optional().describe("Mnemonic phrase"),
      chain: z.string().optional().default("1").describe("Chain ID"),
      rpcUrl: z.string().optional().describe("RPC URL"),
    }),
    async run(c) {
      const result = await balanceHandler(c.options);
      return c.ok(result);
    },
  })
  .command("import", {
    description: "Import an existing private key into a keystore",
    options: keystoreOptions.extend({
      keyEnv: z
        .string()
        .optional()
        .default("PRIVATE_KEY")
        .describe("Environment variable containing private key"),
    }),
    async run(c) {
      const result = await importHandler(c.options);
      return c.ok(result, { cta: { commands: ["wallet balance"] } });
    },
  })
  .command("wrap", {
    description: "Wrap native currency to WETH",
    options: keystoreOptions.extend({
      amount: z.string().describe("Amount to wrap"),
      chain: z.string().optional().default("8453").describe("Chain ID"),
      rpcUrl: z.string().optional().describe("RPC URL"),
    }),
    async run(c) {
      await wrapAction(c.options);
      return c.ok({ success: true });
    },
  })
  .command("unwrap", {
    description: "Unwrap WETH to native currency",
    options: keystoreOptions.extend({
      amount: z.string().describe("Amount to unwrap"),
      chain: z.string().optional().default("8453").describe("Chain ID"),
      rpcUrl: z.string().optional().describe("RPC URL"),
    }),
    async run(c) {
      await unwrapAction(c.options);
      return c.ok({ success: true });
    },
  });
