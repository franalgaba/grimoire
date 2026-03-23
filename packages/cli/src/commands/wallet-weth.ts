/**
 * WETH Wrap/Unwrap Operations
 * Handles wrapping ETH → WETH and unwrapping WETH → ETH
 */

import { existsSync, readFileSync } from "node:fs";
import {
  createProvider,
  createWalletFromConfig,
  formatWei,
  getNativeCurrencySymbol,
  type KeyConfig,
} from "@grimoirelabs/core";
import chalk from "chalk";
import ora from "ora";
import { resolveKeystorePath } from "../lib/keystore.js";
import { promptPassword } from "../lib/prompts.js";

interface SharedOptions {
  keystore?: string;
  passwordEnv?: string;
}

const ETH_DECIMALS = 18;
const DEFAULT_WETH_CHAIN_ID = "8453";

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
  const padded = frac.padEnd(ETH_DECIMALS, "0").slice(0, ETH_DECIMALS);
  return BigInt(whole) * 10n ** BigInt(ETH_DECIMALS) + BigInt(padded);
}

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

export async function wrapAction(
  options: SharedOptions & { amount: string; chain?: string; rpcUrl?: string; json?: boolean }
): Promise<void> {
  try {
    const keystorePath = resolveKeystorePath(options);
    if (!existsSync(keystorePath)) {
      console.error(chalk.red(`Keystore not found: ${keystorePath}`));
      console.error(chalk.dim("Run 'grimoire wallet generate' to create one."));
      throw new Error("Wallet WETH operation failed");
    }

    const password = await resolveKeystorePassword(options);
    const keystoreJson = readFileSync(keystorePath, "utf-8");
    const keyConfig: KeyConfig = { type: "keystore", source: keystoreJson, password };

    const chainId = Number.parseInt(options.chain ?? DEFAULT_WETH_CHAIN_ID, 10);
    const nativeSymbol = getNativeCurrencySymbol(chainId);
    if (nativeSymbol !== "ETH") {
      console.error(
        chalk.red(`WETH only exists on ETH-native chains. Chain ${chainId} uses ${nativeSymbol}.`)
      );
      throw new Error("Wallet WETH operation failed");
    }

    const wethAddress = WETH_ADDRESSES[chainId];
    if (!wethAddress) {
      console.error(chalk.red(`No known WETH address for chain ${chainId}`));
      throw new Error("Wallet WETH operation failed");
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
      throw new Error("Wallet WETH operation failed");
    }

    spinner.succeed(chalk.green(`Wrapped ${options.amount} ETH → WETH`));

    const balance = await provider.getBalance(wallet.address);

    if (options.json) {
      console.error(
        JSON.stringify({
          tx: receipt.hash,
          amount: options.amount,
          chain: chainId,
          balance: formatWei(balance),
        })
      );
    } else {
      console.error(`  ${chalk.dim("Tx:")}      ${receipt.hash}`);
      console.error(`  ${chalk.dim("Balance:")} ${formatWei(balance)} ETH`);
    }
  } catch (error) {
    console.error(chalk.red(`Failed: ${(error as Error).message}`));
    throw new Error("Wallet WETH operation failed");
  }
}

export async function unwrapAction(
  options: SharedOptions & { amount: string; chain?: string; rpcUrl?: string; json?: boolean }
): Promise<void> {
  try {
    const keystorePath = resolveKeystorePath(options);
    if (!existsSync(keystorePath)) {
      console.error(chalk.red(`Keystore not found: ${keystorePath}`));
      console.error(chalk.dim("Run 'grimoire wallet generate' to create one."));
      throw new Error("Wallet WETH operation failed");
    }

    const password = await resolveKeystorePassword(options);
    const keystoreJson = readFileSync(keystorePath, "utf-8");
    const keyConfig: KeyConfig = { type: "keystore", source: keystoreJson, password };

    const chainId = Number.parseInt(options.chain ?? DEFAULT_WETH_CHAIN_ID, 10);
    const nativeSymbol = getNativeCurrencySymbol(chainId);
    if (nativeSymbol !== "ETH") {
      console.error(
        chalk.red(`WETH only exists on ETH-native chains. Chain ${chainId} uses ${nativeSymbol}.`)
      );
      throw new Error("Wallet WETH operation failed");
    }

    const wethAddress = WETH_ADDRESSES[chainId];
    if (!wethAddress) {
      console.error(chalk.red(`No known WETH address for chain ${chainId}`));
      throw new Error("Wallet WETH operation failed");
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
      throw new Error("Wallet WETH operation failed");
    }

    spinner.succeed(chalk.green(`Unwrapped ${options.amount} WETH → ETH`));

    const balance = await provider.getBalance(wallet.address);

    if (options.json) {
      console.error(
        JSON.stringify({
          tx: receipt.hash,
          amount: options.amount,
          chain: chainId,
          balance: formatWei(balance),
        })
      );
    } else {
      console.error(`  ${chalk.dim("Tx:")}      ${receipt.hash}`);
      console.error(`  ${chalk.dim("Balance:")} ${formatWei(balance)} ETH`);
    }
  } catch (error) {
    console.error(chalk.red(`Failed: ${(error as Error).message}`));
    throw new Error("Wallet WETH operation failed");
  }
}
