#!/usr/bin/env node
/**
 * Grimoire CLI
 * Command-line interface for spell management and execution
 */

import { Cli, z } from "incur";
import { castCommand } from "./commands/cast.js";
import { compileCommand } from "./commands/compile.js";
import { compileAllCommand } from "./commands/compile-all.js";
import { formatCommandFromArgv } from "./commands/format.js";
import { historyCommand } from "./commands/history.js";
import { initCommand } from "./commands/init.js";
import { logCommand } from "./commands/log.js";
import { resumeCommand } from "./commands/resume.js";
import { setupCommand } from "./commands/setup.js";
import { simulateCommand } from "./commands/simulate.js";
import { validateCommand } from "./commands/validate.js";
import { venueCommand } from "./commands/venue.js";
import { venuesCommand } from "./commands/venues.js";
import { walletCli } from "./commands/wallet.js";
import { loadSetupEnv } from "./lib/setup-env.js";

loadSetupEnv();

// ── Shared option fragments ────────────────────────────────────────

const advisoryOptions = {
  advisorSkillsDir: z
    .array(z.string())
    .optional()
    .describe("Directory to load advisor skills (default: ./skills)"),
  advisoryPi: z
    .boolean()
    .optional()
    .describe("Force advisory steps via Pi SDK (auto when configured)"),
  advisoryReplay: z.string().optional().describe("Replay advisory outputs from a previous run"),
  advisoryProvider: z.string().optional().describe("Pi provider for advisory (e.g., anthropic)"),
  advisoryModel: z
    .string()
    .optional()
    .describe("Pi model ID for advisory (e.g., claude-sonnet-4-20250514)"),
  advisoryThinking: z
    .enum(["off", "low", "medium", "high"])
    .optional()
    .describe("Pi thinking level (off|low|medium|high)"),
  advisoryTools: z
    .enum(["none", "read", "coding"])
    .optional()
    .describe("Advisory tools: none|read|coding (default: read)"),
  advisoryTraceVerbose: z.boolean().optional().describe("Show verbose advisory trace"),
  piAgentDir: z.string().optional().describe("Pi agent directory (defaults to ~/.pi/agent)"),
};

const dataProvenanceOptions = {
  dataReplay: z
    .string()
    .optional()
    .describe("Replay external data by runId/snapshotId (or off|auto)"),
  dataMaxAge: z
    .string()
    .optional()
    .describe("Maximum external data age in seconds (default: 3600)"),
  onStale: z.string().optional().describe("Stale data policy: fail|warn (default: fail)"),
};

const ensOptions = {
  ensName: z.string().optional().describe("ENS name to hydrate strategy params from text records"),
  ensRpcUrl: z.string().optional().describe("RPC URL for ENS lookups"),
};

const stateOptions = {
  stateDir: z.string().optional().describe("Directory for state database"),
  noState: z.boolean().optional().describe("Disable state persistence"),
};

const crossChainOptions = {
  destinationSpell: z
    .string()
    .optional()
    .describe("Destination spell path for cross-chain orchestration"),
  destinationChain: z
    .string()
    .optional()
    .describe("Destination chain ID for cross-chain orchestration"),
  handoffTimeoutSec: z
    .string()
    .optional()
    .describe("Handoff timeout in seconds for cross-chain mode"),
  pollIntervalSec: z
    .string()
    .optional()
    .describe("Handoff polling interval in seconds (default: 30)"),
  watch: z
    .boolean()
    .optional()
    .describe("Keep process alive and continue after handoff settlement"),
};

const morphoOptions = {
  morphoMarketId: z
    .array(z.string())
    .optional()
    .describe("Morpho market mapping <actionRef>=<marketId> (repeatable)"),
  morphoMarketMap: z.string().optional().describe("JSON file mapping actionRef -> marketId"),
};

const venuePassThroughArgsSchema = z.union([z.string(), z.array(z.string())]);

// ── CLI ────────────────────────────────────────────────────────────

const cli = Cli.create("grimoire", {
  description: "A Portable Execution Language for Onchain Strategies",
  sync: {
    suggestions: [
      "compile a spell",
      "simulate a spell",
      "list available venues",
      "set up local execute mode",
    ],
  },
})
  .use(async (c, next) => {
    const start = performance.now();
    await next();
    if (!c.agent) console.error(`Done in ${(performance.now() - start).toFixed(0)}ms`);
  })

  // ── Init ─────────────────────────────────────────────────────────
  .command("init", {
    description: "Initialize a new .grimoire directory",
    options: z.object({
      force: z.boolean().optional().describe("Overwrite existing files"),
      runtimeQuickstart: z
        .boolean()
        .optional()
        .describe("Create an embedded runtime quickstart scaffold"),
    }),
    async run(c) {
      const result = await initCommand(c.options);
      return c.ok(result, {
        cta: {
          commands: [
            "validate .grimoire/spells/example-swap/spell.spell",
            "simulate .grimoire/spells/example-swap/spell.spell",
          ],
        },
      });
    },
  })

  // ── Setup ────────────────────────────────────────────────────────
  .command("setup", {
    description: "Guided local execute setup (wallet, RPC, and readiness checks)",
    options: z.object({
      chain: z.string().optional().describe("Chain ID for execute setup checks"),
      rpcUrl: z.string().optional().describe("RPC URL (or set RPC_URL_<chainId> / RPC_URL)"),
      adapter: z.string().optional().describe("Adapter for venue doctor check"),
      keystore: z.string().optional().describe("Path to keystore file"),
      passwordEnv: z.string().optional().describe("Environment variable for keystore password"),
      keyEnv: z
        .string()
        .optional()
        .default("PRIVATE_KEY")
        .describe("Environment variable containing private key"),
      importKey: z
        .boolean()
        .optional()
        .describe("Import private key from --key-env if keystore is missing"),
      noSavePasswordEnv: z
        .boolean()
        .optional()
        .describe("Do not write .grimoire/setup.env after prompting password"),
      noDoctor: z.boolean().optional().describe("Skip venue doctor readiness check"),
      nonInteractive: z.boolean().optional().describe("Disable interactive prompts"),
    }),
    async run(c) {
      const options = {
        ...c.options,
        // Map noSavePasswordEnv -> savePasswordEnv (inverse)
        savePasswordEnv: c.options.noSavePasswordEnv === true ? false : undefined,
        // Map noDoctor -> doctor (inverse)
        doctor: c.options.noDoctor === true ? false : undefined,
        json: c.agent,
      };
      const result = await setupCommand(options);
      return c.ok(result, {
        cta: { commands: ["cast <spell> --dry-run", "venue doctor"] },
      });
    },
  })

  // ── Format ───────────────────────────────────────────────────────
  .command("format", {
    description: "Format .spell source files",
    options: z.object({
      write: z.boolean().optional().describe("Write formatted output in place"),
      check: z.boolean().optional().describe("Check whether files are already canonical"),
      diff: z.boolean().optional().describe("Print unified diff for changed files"),
      stdin: z.boolean().optional().describe("Read source from stdin"),
      stdinFilepath: z.string().optional().describe("Virtual filepath label for stdin"),
    }),
    async run() {
      const exitCode = await formatCommandFromArgv(process.argv);
      if (exitCode !== 0) {
        process.exitCode = exitCode;
        throw new Error(`Format failed (exit ${exitCode})`);
      }
      return { success: true };
    },
  })

  // ── Compile ──────────────────────────────────────────────────────
  .command("compile", {
    description: "Compile a .spell file to IR",
    args: z.object({
      spell: z.string().describe("Path to .spell file"),
    }),
    options: z.object({
      output: z.string().optional().describe("Output file for IR JSON"),
      pretty: z.boolean().optional().describe("Pretty print JSON output"),
    }),
    async run(c) {
      const result = await compileCommand(c.args.spell, c.options);
      return c.ok(result, {
        cta: { commands: ["validate <spell>", "simulate <spell>"] },
      });
    },
  })

  // ── Compile All ──────────────────────────────────────────────────
  .command("compile-all", {
    description: "Compile all .spell files in a directory (default: spells)",
    args: z.object({
      dir: z.string().optional().describe("Directory to compile"),
    }),
    options: z.object({
      failFast: z.boolean().optional().describe("Stop after the first failure"),
    }),
    async run(c) {
      const results = await compileAllCommand(c.args.dir, c.options);
      return c.ok(results);
    },
  })

  // ── Validate ─────────────────────────────────────────────────────
  .command("validate", {
    description: "Validate a .spell file",
    args: z.object({
      spell: z.string().describe("Path to .spell file"),
    }),
    options: z.object({
      strict: z.boolean().optional().describe("Treat warnings as errors"),
    }),
    async run(c) {
      const result = await validateCommand(c.args.spell, c.options);
      return c.ok(result, {
        cta: { commands: ["compile <spell>", "simulate <spell>"] },
      });
    },
  })

  // ── Simulate ─────────────────────────────────────────────────────
  .command("simulate", {
    description: "Simulate spell execution (dry run)",
    args: z.object({
      spell: z.string().describe("Path to .spell file"),
    }),
    options: z.object({
      params: z.string().optional().describe("Parameters as JSON"),
      vault: z.string().optional().describe("Vault address"),
      chain: z.string().optional().default("1").describe("Chain ID"),
      rpcUrl: z
        .array(z.string())
        .optional()
        .describe("RPC URL override or chain mapping <chainId>=<url> (repeatable)"),
      ...crossChainOptions,
      ...morphoOptions,
      ...advisoryOptions,
      ...dataProvenanceOptions,
      ...ensOptions,
      ...stateOptions,
    }),
    alias: { params: "p" },
    async run(c) {
      const result = await simulateCommand(c.args.spell, { ...c.options, json: c.agent });
      return c.ok(result ?? { success: true }, {
        cta: { commands: ["cast <spell>", "cast <spell> --dry-run"] },
      });
    },
  })

  // ── Cast ─────────────────────────────────────────────────────────
  .command("cast", {
    description: "Execute a spell",
    args: z.object({
      spell: z.string().describe("Path to .spell file"),
    }),
    options: z.object({
      params: z.string().optional().describe("Parameters as JSON"),
      vault: z.string().optional().describe("Vault address"),
      chain: z.string().optional().default("1").describe("Chain ID"),
      dryRun: z.boolean().optional().describe("Simulate without executing"),
      privateKey: z
        .string()
        .optional()
        .describe("Private key (hex) - NOT RECOMMENDED, use --key-env"),
      keyEnv: z.string().optional().describe("Environment variable containing private key"),
      keystore: z.string().optional().describe("Path to keystore file"),
      passwordEnv: z.string().optional().describe("Environment variable for keystore password"),
      rpcUrl: z
        .array(z.string())
        .optional()
        .describe("RPC URL or chain mapping <chainId>=<url> (repeatable)"),
      ...crossChainOptions,
      ...morphoOptions,
      gasMultiplier: z.string().optional().describe("Gas price multiplier (default: 1.1)"),
      skipConfirm: z.boolean().optional().describe("Skip confirmation prompt (use with caution)"),
      verbose: z.boolean().optional().describe("Show verbose output"),
      ...advisoryOptions,
      ...dataProvenanceOptions,
      ...ensOptions,
      ...stateOptions,
      trigger: z
        .string()
        .optional()
        .describe("Run only the specified trigger handler (e.g., manual, hourly)"),
    }),
    alias: { params: "p", verbose: "v" },
    async run(c) {
      const result = await castCommand(c.args.spell, { ...c.options, json: c.agent });
      return c.ok(result ?? { success: true }, {
        cta: { commands: ["history <spell>", "log <spell> <runId>"] },
      });
    },
  })

  // ── Venues ───────────────────────────────────────────────────────
  .command("venues", {
    description: "List available venue adapters",
    async run(c) {
      const metas = await venuesCommand();
      return c.ok(metas, {
        cta: { commands: ["venue <adapter> --help"] },
      });
    },
  })

  // ── Venue ────────────────────────────────────────────────────────
  .command("venue", {
    description: "Run venue metadata commands (proxy to @grimoirelabs/venues CLIs)",
    args: z.object({
      adapter: z.string().optional().describe("Venue adapter name"),
      venue: z.string().optional().describe("Alias for adapter (agent/JSON mode)"),
      args: venuePassThroughArgsSchema.optional().describe("Pass-through arguments for venue CLI"),
    }),
    options: z.object({
      adapter: z.string().optional().describe("Venue adapter name"),
      venue: z.string().optional().describe("Alias for adapter"),
      args: venuePassThroughArgsSchema.optional().describe("Pass-through arguments for venue CLI"),
    }),
    hint: "Pass additional arguments after the adapter name, e.g.: grimoire venue uniswap tokens --chain 1",
    async run(c) {
      const adapter = resolveVenueAdapter(c.args, c.options);
      const passArgs = getVenuePassArgsFromArgv(process.argv);
      const structuredArgs = resolveStructuredVenueArgs(c.args, c.options);
      await venueCommand(adapter, passArgs.length > 0 ? passArgs : structuredArgs);
      return c.ok({ success: true });
    },
  })

  // ── History ──────────────────────────────────────────────────────
  .command("history", {
    description: "View execution history",
    args: z.object({
      spell: z.string().optional().describe("Spell ID to show runs for"),
    }),
    options: z.object({
      limit: z.string().optional().default("20").describe("Maximum number of runs to show"),
      ...stateOptions,
    }),
    async run(c) {
      const result = await historyCommand(c.args.spell, c.options);
      return c.ok(result, {
        cta: { commands: ["log <spell> <runId>"] },
      });
    },
  })

  // ── Resume ───────────────────────────────────────────────────────
  .command("resume", {
    description: "Resume a waiting cross-chain orchestration run",
    args: z.object({
      runId: z.string().describe("Run ID to resume"),
    }),
    options: z.object({
      watch: z
        .boolean()
        .optional()
        .describe("Keep process alive and continue after handoff settlement"),
      pollIntervalSec: z
        .string()
        .optional()
        .describe("Handoff polling interval in seconds (default: 30)"),
      ...stateOptions,
    }),
    async run(c) {
      const result = await resumeCommand(c.args.runId, { ...c.options, json: c.agent });
      return c.ok(result ?? { success: true });
    },
  })

  // ── Log ──────────────────────────────────────────────────────────
  .command("log", {
    description: "View ledger events for a run",
    args: z.object({
      spell: z.string().describe("Spell ID"),
      runId: z.string().describe("Run ID"),
    }),
    options: z.object({
      ...stateOptions,
    }),
    async run(c) {
      const result = await logCommand(c.args.spell, c.args.runId, c.options);
      return c.ok(result);
    },
  })

  // ── Wallet (nested CLI) ──────────────────────────────────────────
  .command(walletCli);

// ── Serve ──────────────────────────────────────────────────────────

// Bypass incur's parser for `venue` — it rejects unknown flags that
// are actually meant for the proxied venue CLI (e.g. --query, --chain).
const firstArg = process.argv[2];
const secondArg = process.argv[3] ?? "";
const shouldBypassFormatParser = firstArg === "format";
const shouldBypassVenueParser = firstArg === "venue" && isPositionalVenueAdapter(secondArg);
if (shouldBypassFormatParser) {
  formatCommandFromArgv(process.argv)
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${msg}`);
      process.exitCode = 3;
    });
} else if (shouldBypassVenueParser) {
  const adapter = process.argv[3] ?? "";
  const passArgs = getVenuePassArgsFromArgv(process.argv);
  venueCommand(adapter, passArgs).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${msg}`);
    process.exitCode = 1;
  });
} else {
  cli.serve();
}

function getVenuePassArgsFromArgv(argv: string[]): string[] {
  const venueIdx = argv.indexOf("venue");
  if (venueIdx < 0) return [];
  const adapterToken = argv[venueIdx + 1];
  if (!isPositionalVenueAdapter(adapterToken)) return [];
  return argv.slice(venueIdx + 2);
}

function resolveVenueAdapter(
  args: { adapter?: string; venue?: string },
  options: { adapter?: string; venue?: string }
): string {
  return args.adapter ?? args.venue ?? options.adapter ?? options.venue ?? "";
}

function resolveStructuredVenueArgs(
  args: { args?: string | string[] },
  options: { args?: string | string[] }
): string | string[] {
  return args.args ?? options.args ?? [];
}

function isPositionalVenueAdapter(token: string | undefined): boolean {
  return Boolean(token && !token.startsWith("-"));
}
