#!/usr/bin/env bun
/**
 * Grimoire CLI
 * Command-line interface for spell management and execution
 */

import chalk from "chalk";
import { Command } from "commander";
import { castCommand } from "./commands/cast.js";
import { compileCommand } from "./commands/compile.js";
import { initCommand } from "./commands/init.js";
import { simulateCommand } from "./commands/simulate.js";
import { validateCommand } from "./commands/validate.js";

const program = new Command();

program
  .name("grimoire")
  .description("A Portable Execution Language for Onchain Strategies")
  .version("0.1.0");

// Init command
program
  .command("init")
  .description("Initialize a new .grimoire directory")
  .option("-f, --force", "Overwrite existing files")
  .action(initCommand);

// Compile command
program
  .command("compile <spell>")
  .description("Compile a .spell file to IR")
  .option("-o, --output <file>", "Output file for IR JSON")
  .option("--pretty", "Pretty print JSON output")
  .action(compileCommand);

// Validate command
program
  .command("validate <spell>")
  .description("Validate a .spell file")
  .option("--strict", "Treat warnings as errors")
  .action(validateCommand);

// Simulate command
program
  .command("simulate <spell>")
  .description("Simulate spell execution (dry run)")
  .option("-p, --params <json>", "Parameters as JSON")
  .option("--vault <address>", "Vault address")
  .option("--chain <id>", "Chain ID", "1")
  .action(simulateCommand);

// Cast command
program
  .command("cast <spell>")
  .description("Execute a spell")
  .option("-p, --params <json>", "Parameters as JSON")
  .option("--vault <address>", "Vault address")
  .option("--chain <id>", "Chain ID", "1")
  .option("--dry-run", "Simulate without executing")
  .action(castCommand);

// History command (placeholder)
program
  .command("history [spell]")
  .description("View execution history")
  .action((spell) => {
    console.log(chalk.yellow("History command not yet implemented"));
    if (spell) {
      console.log(`Spell: ${spell}`);
    }
  });

// Log command (placeholder)
program
  .command("log <spell> <runId>")
  .description("View execution log")
  .action((spell, runId) => {
    console.log(chalk.yellow("Log command not yet implemented"));
    console.log(`Spell: ${spell}, Run: ${runId}`);
  });

// Parse and run
program.parse();
