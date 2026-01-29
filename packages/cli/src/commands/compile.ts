/**
 * Compile Command
 * Compiles a .spell file to IR
 */

import { compileFile } from "@grimoire/core";
import chalk from "chalk";
import ora from "ora";

interface CompileOptions {
  output?: string;
  pretty?: boolean;
}

export async function compileCommand(spellPath: string, options: CompileOptions): Promise<void> {
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
        console.log(chalk.red(`  Error [${error.code}]: ${error.message}`));
      }
      process.exit(1);
    }

    spinner.succeed(chalk.green("Compilation successful"));

    // Output IR
    const irJson = options.pretty
      ? JSON.stringify(result.ir, bigintReplacer, 2)
      : JSON.stringify(result.ir, bigintReplacer);

    if (options.output) {
      await Bun.write(options.output, irJson);
      console.log(chalk.dim(`IR written to ${options.output}`));
    } else {
      console.log();
      console.log(irJson);
    }

    // Summary
    console.log();
    console.log(chalk.dim("Summary:"));
    console.log(chalk.dim(`  Spell: ${result.ir.meta.name}`));
    console.log(chalk.dim(`  Version: ${result.ir.version}`));
    console.log(chalk.dim(`  Steps: ${result.ir.steps.length}`));
    console.log(chalk.dim(`  Guards: ${result.ir.guards.length}`));
    console.log(chalk.dim(`  Venues: ${result.ir.aliases.length}`));
    console.log(chalk.dim(`  Assets: ${result.ir.assets.length}`));
    console.log(chalk.dim(`  Params: ${result.ir.params.length}`));
  } catch (error) {
    spinner.fail(chalk.red(`Failed to compile: ${(error as Error).message}`));
    process.exit(1);
  }
}

/**
 * JSON replacer for bigint values
 */
function bigintReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  return value;
}
