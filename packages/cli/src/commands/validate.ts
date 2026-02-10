/**
 * Validate Command
 * Validates a .spell file
 */

import { compileFile, validateIR } from "@grimoirelabs/core";
import chalk from "chalk";
import ora from "ora";

interface ValidateOptions {
  strict?: boolean;
  json?: boolean;
}

export async function validateCommand(spellPath: string, options: ValidateOptions): Promise<void> {
  const spinner = options.json ? undefined : ora(`Validating ${spellPath}...`).start();

  try {
    const result = await compileFile(spellPath);
    const advisorySummaries = result.ir ? validateIR(result.ir).advisorySummaries : [];

    // Count issues
    const errorCount = result.errors.length;
    const warningCount = result.warnings.length;
    const strictFailure = Boolean(options.strict && warningCount > 0);
    const success = result.success && !strictFailure;

    if (options.json) {
      const payload = {
        success,
        strict: Boolean(options.strict),
        spell: result.ir
          ? {
              id: result.ir.id,
              name: result.ir.meta.name,
              version: result.ir.version,
              steps: result.ir.steps.length,
              guards: result.ir.guards.length,
            }
          : undefined,
        errors: result.errors,
        warnings: result.warnings,
        advisory_summaries: advisorySummaries,
      };
      console.log(JSON.stringify(payload, null, 2));
      if (!success) {
        process.exit(1);
      }
      return;
    }

    // Report warnings
    if (warningCount > 0) {
      spinner?.info(chalk.yellow(`${warningCount} warning(s)`));
      for (const warning of result.warnings) {
        console.log(chalk.yellow(`  [${warning.code}] ${warning.message}`));
        if (warning.line !== undefined) {
          console.log(chalk.dim(`    at line ${warning.line}`));
        }
      }
    }

    // Report errors
    if (errorCount > 0) {
      spinner?.fail(chalk.red(`${errorCount} error(s)`));
      for (const error of result.errors) {
        console.log(chalk.red(`  [${error.code}] ${error.message}`));
        if (error.line !== undefined) {
          console.log(chalk.dim(`    at line ${error.line}`));
        }
      }
    }

    // Final result
    if (!result.success) {
      console.log();
      console.log(chalk.red("✗ Validation failed"));
      process.exit(1);
    }

    if (strictFailure) {
      console.log();
      console.log(chalk.red("✗ Validation failed (strict mode)"));
      process.exit(1);
    }

    if (errorCount === 0 && warningCount === 0) {
      spinner?.succeed(chalk.green("✓ Spell is valid"));
    } else {
      spinner?.succeed(chalk.green("✓ Spell is valid (with warnings)"));
    }

    // Show spell info
    if (result.ir) {
      console.log();
      console.log(chalk.dim("Spell info:"));
      console.log(chalk.dim(`  Name: ${result.ir.meta.name}`));
      console.log(chalk.dim(`  Version: ${result.ir.version}`));
      console.log(chalk.dim(`  Steps: ${result.ir.steps.length}`));
      console.log(chalk.dim(`  Guards: ${result.ir.guards.length}`));
      if (advisorySummaries.length > 0) {
        console.log(chalk.dim(`  Advisory summaries: ${advisorySummaries.length}`));
      }
    }
  } catch (error) {
    spinner?.fail(chalk.red(`Failed to validate: ${(error as Error).message}`));
    process.exit(1);
  }
}
