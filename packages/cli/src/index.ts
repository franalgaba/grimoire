#!/usr/bin/env node
/**
 * Grimoire CLI
 * Command-line interface for spell management and execution
 */

import { Command } from "commander";
import { castCommand } from "./commands/cast.js";
import { compileCommand } from "./commands/compile.js";
import { compileAllCommand } from "./commands/compile-all.js";
import { collectRepeatedOption } from "./commands/cross-chain-helpers.js";
import { historyCommand } from "./commands/history.js";
import { initCommand } from "./commands/init.js";
import { logCommand } from "./commands/log.js";
import { resumeCommand } from "./commands/resume.js";
import { setupCommand } from "./commands/setup.js";
import { simulateCommand } from "./commands/simulate.js";
import { validateCommand } from "./commands/validate.js";
import { venueCommand } from "./commands/venue.js";
import { venuesCommand } from "./commands/venues.js";
import { walletCommand } from "./commands/wallet.js";
import { loadSetupEnv } from "./lib/setup-env.js";

loadSetupEnv();

const program = new Command();
program.enablePositionalOptions();

program
  .name("grimoire")
  .description("A Portable Execution Language for Onchain Strategies")
  .version("0.1.0");

// Init command
program
  .command("init")
  .description("Initialize a new .grimoire directory")
  .option("-f, --force", "Overwrite existing files")
  .option("--runtime-quickstart", "Create an embedded runtime quickstart scaffold")
  .action(initCommand);

// Setup command
program
  .command("setup")
  .description("Guided local execute setup (wallet, RPC, and readiness checks)")
  .option("--chain <id>", "Chain ID for execute setup checks")
  .option("--rpc-url <url>", "RPC URL (or set RPC_URL_<chainId> / RPC_URL)")
  .option("--adapter <name>", "Adapter for venue doctor check")
  .option("--keystore <path>", "Path to keystore file")
  .option("--password-env <name>", "Environment variable for keystore password")
  .option("--key-env <name>", "Environment variable containing private key", "PRIVATE_KEY")
  .option("--import-key", "Import private key from --key-env if keystore is missing")
  .option("--no-save-password-env", "Do not write .grimoire/setup.env after prompting password")
  .option("--no-doctor", "Skip venue doctor readiness check")
  .option("--non-interactive", "Disable interactive prompts")
  .option("--json", "Output setup result as JSON")
  .action(setupCommand);

// Compile command
program
  .command("compile <spell>")
  .description("Compile a .spell file to IR")
  .option("-o, --output <file>", "Output file for IR JSON")
  .option("--pretty", "Pretty print JSON output")
  .action(compileCommand);

// Compile all command
program
  .command("compile-all [dir]")
  .description("Compile all .spell files in a directory (default: spells)")
  .option("--fail-fast", "Stop after the first failure")
  .option("--json", "Output results as JSON")
  .action(compileAllCommand);

// Validate command
program
  .command("validate <spell>")
  .description("Validate a .spell file")
  .option("--strict", "Treat warnings as errors")
  .option("--json", "Output validation report as JSON")
  .action(validateCommand);

// Simulate command
program
  .command("simulate <spell>")
  .description("Simulate spell execution (dry run)")
  .option("-p, --params <json>", "Parameters as JSON")
  .option("--vault <address>", "Vault address")
  .option("--chain <id>", "Chain ID", "1")
  .option(
    "--rpc-url <url>",
    "RPC URL override (single URL) or chain mapping <chainId>=<url> (repeatable)",
    collectRepeatedOption,
    []
  )
  .option("--destination-spell <spell>", "Destination spell path for cross-chain orchestration")
  .option("--destination-chain <id>", "Destination chain ID for cross-chain orchestration")
  .option("--handoff-timeout-sec <seconds>", "Handoff timeout in seconds for cross-chain mode")
  .option("--poll-interval-sec <seconds>", "Handoff polling interval in seconds (default: 30)")
  .option("--watch", "Keep process alive and continue after handoff settlement")
  .option(
    "--morpho-market-id <mapping>",
    "Morpho market mapping <actionRef>=<marketId> (repeatable)",
    collectRepeatedOption,
    []
  )
  .option("--morpho-market-map <path>", "JSON file mapping actionRef -> marketId")
  .option("--json", "Output results as JSON")
  .option("--advisor-skills-dir <dir...>", "Directory to load advisor skills (default: ./skills)")
  .option("--advisory-pi", "Force advisory steps via Pi SDK (auto when configured)")
  .option("--advisory-replay <runId>", "Replay advisory outputs from a previous run")
  .option("--advisory-provider <name>", "Pi provider for advisory (e.g., anthropic)")
  .option("--advisory-model <id>", "Pi model ID for advisory (e.g., claude-sonnet-4-20250514)")
  .option("--advisory-thinking <level>", "Pi thinking level (off|low|medium|high)")
  .option("--advisory-tools <mode>", "Advisory tools: none|read|coding (default: read)")
  .option(
    "--advisory-trace-verbose",
    "Show verbose advisory trace (prompt/schema, tool args/results, model text/thinking deltas)"
  )
  .option("--pi-agent-dir <dir>", "Pi agent directory (defaults to ~/.pi/agent)")
  .option(
    "--data-replay <mode>",
    "Replay external data by runId/snapshotId (or off|auto, default: auto)"
  )
  .option("--data-max-age <sec>", "Maximum external data age in seconds (default: 3600)")
  .option("--on-stale <policy>", "Stale data policy: fail|warn (default: fail)")
  .option("--ens-name <name>", "ENS name to hydrate strategy params from text records")
  .option("--ens-rpc-url <url>", "RPC URL for ENS lookups (defaults to ENS_RPC_URL or RPC_URL)")
  .option("--state-dir <dir>", "Directory for state database")
  .option("--no-state", "Disable state persistence")
  .action(simulateCommand);

// Cast command
program
  .command("cast <spell>")
  .description("Execute a spell")
  .option("-p, --params <json>", "Parameters as JSON")
  .option("--vault <address>", "Vault address")
  .option("--chain <id>", "Chain ID", "1")
  .option("--dry-run", "Simulate without executing")
  .option("--private-key <key>", "Private key (hex) - NOT RECOMMENDED, use --key-env")
  .option("--key-env <name>", "Environment variable containing private key")
  .option("--keystore <path>", "Path to keystore file")
  .option("--password-env <name>", "Environment variable for keystore password")
  .option(
    "--rpc-url <url>",
    "RPC URL (single URL) or chain mapping <chainId>=<url> (repeatable)",
    collectRepeatedOption,
    []
  )
  .option("--destination-spell <spell>", "Destination spell path for cross-chain orchestration")
  .option("--destination-chain <id>", "Destination chain ID for cross-chain orchestration")
  .option("--handoff-timeout-sec <seconds>", "Handoff timeout in seconds for cross-chain mode")
  .option("--poll-interval-sec <seconds>", "Handoff polling interval in seconds (default: 30)")
  .option("--watch", "Keep process alive and continue after handoff settlement")
  .option(
    "--morpho-market-id <mapping>",
    "Morpho market mapping <actionRef>=<marketId> (repeatable)",
    collectRepeatedOption,
    []
  )
  .option("--morpho-market-map <path>", "JSON file mapping actionRef -> marketId")
  .option("--gas-multiplier <n>", "Gas price multiplier (default: 1.1)")
  .option("--skip-confirm", "Skip confirmation prompt (use with caution)")
  .option("-v, --verbose", "Show verbose output")
  .option("--json", "Output results as JSON")
  .option("--advisor-skills-dir <dir...>", "Directory to load advisor skills (default: ./skills)")
  .option("--advisory-pi", "Force advisory steps via Pi SDK (auto when configured)")
  .option("--advisory-replay <runId>", "Replay advisory outputs from a previous run")
  .option("--advisory-provider <name>", "Pi provider for advisory (e.g., anthropic)")
  .option("--advisory-model <id>", "Pi model ID for advisory (e.g., claude-sonnet-4-20250514)")
  .option("--advisory-thinking <level>", "Pi thinking level (off|low|medium|high)")
  .option("--advisory-tools <mode>", "Advisory tools: none|read|coding (default: read)")
  .option(
    "--advisory-trace-verbose",
    "Show verbose advisory trace (prompt/schema, tool args/results, model text/thinking deltas)"
  )
  .option("--pi-agent-dir <dir>", "Pi agent directory (defaults to ~/.pi/agent)")
  .option(
    "--data-replay <mode>",
    "Replay external data by runId/snapshotId (or off|auto; default: auto for dry-run/simulate, off for live cast)"
  )
  .option("--data-max-age <sec>", "Maximum external data age in seconds (default: 3600)")
  .option("--on-stale <policy>", "Stale data policy: fail|warn (default: fail)")
  .option("--ens-name <name>", "ENS name to hydrate strategy params from text records")
  .option("--ens-rpc-url <url>", "RPC URL for ENS lookups (defaults to ENS_RPC_URL or RPC_URL)")
  .option("--state-dir <dir>", "Directory for state database")
  .option("--no-state", "Disable state persistence")
  .action(castCommand);

// Venues command
program
  .command("venues")
  .description("List available venue adapters")
  .option("--json", "Output results as JSON")
  .action(venuesCommand);

// Venue metadata command (proxy)
program
  .command("venue [adapter] [args...]")
  .description("Run venue metadata commands (proxy to @grimoirelabs/venues CLIs)")
  .allowUnknownOption(true)
  .passThroughOptions()
  .helpOption(false)
  .action((adapter, args) => venueCommand(adapter, args));

// History command
program
  .command("history [spell]")
  .description("View execution history")
  .option("--limit <n>", "Maximum number of runs to show", "20")
  .option("--json", "Output results as JSON")
  .option("--state-dir <dir>", "Directory for state database")
  .action(historyCommand);

// Resume cross-chain continuation
program
  .command("resume <runId>")
  .description("Resume a waiting cross-chain orchestration run")
  .option("--watch", "Keep process alive and continue after handoff settlement")
  .option("--poll-interval-sec <seconds>", "Handoff polling interval in seconds (default: 30)")
  .option("--json", "Output results as JSON")
  .option("--state-dir <dir>", "Directory for state database")
  .action(resumeCommand);

// Log command
program
  .command("log <spell> <runId>")
  .description("View ledger events for a run")
  .option("--json", "Output results as JSON")
  .option("--state-dir <dir>", "Directory for state database")
  .action(logCommand);

// Wallet command
program.addCommand(walletCommand);

// Parse and run
program.parse();
