/**
 * Init Command
 * Scaffolds a new .grimoire directory
 */

import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import ora from "ora";

interface InitOptions {
  force?: boolean;
}

const DEFAULT_CONFIG = `# Grimoire Configuration

# RPC endpoints
rpc:
  ethereum: "https://eth.llamarpc.com"
  arbitrum: "https://arb1.arbitrum.io/rpc"
  base: "https://mainnet.base.org"

# Wallet configuration
wallet:
  mode: approval-required  # read-only | approval-required | limited
  connector: mcp-wallet    # mcp-wallet | walletconnect | hardware

# Default constraints
defaults:
  max_slippage_bps: 50
  tx_deadline_seconds: 300
  simulation_required: true
`;

const DEFAULT_ALIASES = `# Default Venue Aliases

# Ethereum Mainnet (Chain ID: 1)
uniswap_v3_eth:
  chain: 1
  address: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45"
  label: "Uniswap V3 Router"

aave_v3_eth:
  chain: 1
  address: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2"
  label: "Aave V3 Pool"

morpho_eth:
  chain: 1
  address: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb"
  label: "Morpho Blue"

# Arbitrum (Chain ID: 42161)
uniswap_v3_arb:
  chain: 42161
  address: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45"
  label: "Uniswap V3 Router"

aave_v3_arb:
  chain: 42161
  address: "0x794a61358D6845594F94dc1DB02A252b5b4814aD"
  label: "Aave V3 Pool"

# Base (Chain ID: 8453)
uniswap_v3_base:
  chain: 8453
  address: "0x2626664c2603336E57B271c5C0b26F421741e481"
  label: "Uniswap V3 Router"

aave_v3_base:
  chain: 8453
  address: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5"
  label: "Aave V3 Pool"

morpho_base:
  chain: 8453
  address: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb"
  label: "Morpho Blue"
`;

const EXAMPLE_SPELL = `# Example: Simple USDC to ETH swap

spell: example-swap
version: "1.0.0"
description: "Swap USDC for ETH on Uniswap V3"

venues:
  uniswap:
    chain: 1
    address: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45"
    label: "Uniswap V3 Router"

params:
  amount: 1000000000  # 1000 USDC (6 decimals)

assets:
  USDC:
    chain: 1
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
    decimals: 6
  WETH:
    chain: 1
    address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
    decimals: 18

trigger:
  manual: true

steps:
  - id: check_balance
    compute:
      usdc_balance: balance(USDC)
      has_enough: usdc_balance >= params.amount

  - id: do_swap
    if: has_enough
    action:
      type: swap
      venue: uniswap
      asset_in: USDC
      asset_out: WETH
      amount: params.amount
      mode: exact_in
    constraints:
      max_slippage: 50
    on_failure: revert

guards:
  - id: has_usdc
    check: balance(USDC) >= params.amount
    severity: halt
    message: "Insufficient USDC balance"
`;

export async function initCommand(options: InitOptions): Promise<void> {
  const spinner = ora("Initializing Grimoire...").start();
  const baseDir = ".grimoire";

  try {
    const pathExists = async (path: string): Promise<boolean> => {
      try {
        await access(path);
        return true;
      } catch {
        return false;
      }
    };

    // Check if already exists
    if (await pathExists(baseDir)) {
      if (!options.force) {
        spinner.fail(chalk.red(`Directory ${baseDir} already exists. Use --force to overwrite.`));
        process.exit(1);
      }
    }

    // Create directory structure
    await mkdir(baseDir, { recursive: true });
    await mkdir(join(baseDir, "aliases"), { recursive: true });
    await mkdir(join(baseDir, "spells"), { recursive: true });

    // Write config file
    await Bun.write(join(baseDir, "config.yaml"), DEFAULT_CONFIG);

    // Write default aliases
    await Bun.write(join(baseDir, "aliases", "default.yaml"), DEFAULT_ALIASES);

    // Write example spell
    await mkdir(join(baseDir, "spells", "example-swap"), { recursive: true });
    await Bun.write(join(baseDir, "spells", "example-swap", "spell.spell"), EXAMPLE_SPELL);

    spinner.succeed(chalk.green("Grimoire initialized successfully!"));

    console.log();
    console.log(chalk.dim("Created:"));
    console.log(chalk.dim(`  ${baseDir}/config.yaml`));
    console.log(chalk.dim(`  ${baseDir}/aliases/default.yaml`));
    console.log(chalk.dim(`  ${baseDir}/spells/example-swap/spell.spell`));
    console.log();
    console.log(chalk.cyan("Next steps:"));
    console.log(chalk.white("  1. Edit your spell in .grimoire/spells/example-swap/spell.spell"));
    console.log(
      chalk.white("  2. Run: grimoire validate .grimoire/spells/example-swap/spell.spell")
    );
    console.log(
      chalk.white("  3. Run: grimoire simulate .grimoire/spells/example-swap/spell.spell")
    );
  } catch (error) {
    spinner.fail(chalk.red(`Failed to initialize: ${(error as Error).message}`));
    process.exit(1);
  }
}
