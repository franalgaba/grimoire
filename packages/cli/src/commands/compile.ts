/**
 * Compile Command
 * Compiles a .spell file to IR
 */

import { writeFile } from "node:fs/promises";
import { compileFile } from "@grimoirelabs/core";
import chalk from "chalk";
import ora from "ora";
import { stringifyJson } from "../lib/json.js";

interface CompileOptions {
  output?: string;
  pretty?: boolean;
}

export async function compileCommand(spellPath: string, options: CompileOptions): Promise<unknown> {
  const spinner = ora(`Compiling ${spellPath}...`).start();

  try {
    const result = await compileFile(spellPath);

    // Report warnings
    for (const warning of result.warnings) {
      spinner.warn(chalk.yellow(`Warning [${warning.code}]: ${warning.message}`));
    }

    // Report errors
    if (!result.success || !result.ir) {
      spinner.fail(chalk.red("Compilation failed"));
      for (const error of result.errors) {
        console.error(chalk.red(`  Error [${error.code}]: ${error.message}`));
      }
      throw new Error("Compilation failed");
    }

    spinner.succeed(chalk.green("Compilation successful"));

    // Output IR
    const irJson = options.pretty
      ? stringifyJson(result.ir)
      : JSON.stringify(result.ir, (_key, v) => (typeof v === "bigint" ? v.toString() : v));

    if (options.output) {
      await writeFile(options.output, irJson, "utf8");
      console.error(chalk.dim(`IR written to ${options.output}`));
    } else {
      console.error();
      console.error(irJson);
    }

    // Summary
    console.error();
    console.error(chalk.dim("Summary:"));
    console.error(chalk.dim(`  Spell: ${result.ir.meta.name}`));
    console.error(chalk.dim(`  Version: ${result.ir.version}`));
    console.error(chalk.dim(`  Steps: ${result.ir.steps.length}`));
    console.error(chalk.dim(`  Guards: ${result.ir.guards.length}`));
    console.error(chalk.dim(`  Venues: ${result.ir.aliases.length}`));
    console.error(chalk.dim(`  Assets: ${result.ir.assets.length}`));
    console.error(chalk.dim(`  Params: ${result.ir.params.length}`));

    return result.ir as unknown;
  } catch (error) {
    if ((error as Error).message === "Compilation failed") {
      throw error;
    }
    spinner.fail(chalk.red(`Failed to compile: ${(error as Error).message}`));
    throw error;
  }
}
