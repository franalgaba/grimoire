/**
 * Cast Command
 * Executes a spell
 */

import { type Address, compileFile, execute } from "@grimoire/core";
import chalk from "chalk";
import ora from "ora";

interface CastOptions {
  params?: string;
  vault?: string;
  chain?: string;
  dryRun?: boolean;
}

export async function castCommand(spellPath: string, options: CastOptions): Promise<void> {
  const spinner = ora(`Casting ${spellPath}...`).start();

  try {
    // Parse params
    let params: Record<string, unknown> = {};
    if (options.params) {
      try {
        params = JSON.parse(options.params);
      } catch {
        spinner.fail(chalk.red("Invalid params JSON"));
        process.exit(1);
      }
    }

    // Require vault address for non-dry-run
    if (!options.dryRun && !options.vault) {
      spinner.fail(
        chalk.red("Vault address required for live execution. Use --vault or --dry-run")
      );
      process.exit(1);
    }

    // Compile spell
    spinner.text = "Compiling spell...";
    const compileResult = await compileFile(spellPath);

    if (!compileResult.success || !compileResult.ir) {
      spinner.fail(chalk.red("Compilation failed"));
      for (const error of compileResult.errors) {
        console.log(chalk.red(`  [${error.code}] ${error.message}`));
      }
      process.exit(1);
    }

    const spell = compileResult.ir;

    // Show spell info
    console.log();
    console.log(chalk.cyan("Spell Info:"));
    console.log(chalk.dim(`  Name: ${spell.meta.name}`));
    console.log(chalk.dim(`  Version: ${spell.version}`));
    console.log(chalk.dim(`  Steps: ${spell.steps.length}`));

    // Show params being used
    if (spell.params.length > 0) {
      console.log();
      console.log(chalk.cyan("Parameters:"));
      for (const param of spell.params) {
        const value = params[param.name] ?? param.default;
        console.log(chalk.dim(`  ${param.name}: ${JSON.stringify(value)}`));
      }
    }

    // Confirmation for live execution
    if (!options.dryRun) {
      console.log();
      console.log(chalk.yellow("⚠️  Live execution mode"));
      console.log(chalk.yellow("    This will execute real transactions on-chain."));
      console.log();

      // For now, we only support simulation
      spinner.warn(chalk.yellow("Live execution not yet implemented. Running in simulation mode."));
      options.dryRun = true;
    }

    // Execute
    spinner.text = options.dryRun ? "Simulating spell..." : "Casting spell...";

    const vault = (options.vault ?? "0x0000000000000000000000000000000000000000") as Address;
    const chain = Number.parseInt(options.chain ?? "1", 10);

    const result = await execute({
      spell,
      vault,
      chain,
      params,
      simulate: options.dryRun,
    });

    // Report result
    if (result.success) {
      spinner.succeed(
        chalk.green(options.dryRun ? "Simulation successful" : "Spell cast successfully")
      );
    } else {
      spinner.fail(
        chalk.red(`${options.dryRun ? "Simulation" : "Execution"} failed: ${result.error}`)
      );
    }

    // Show execution summary
    console.log();
    console.log(chalk.cyan("Execution Summary:"));
    console.log(`  ${chalk.dim("Run ID:")} ${result.runId}`);
    console.log(`  ${chalk.dim("Duration:")} ${result.duration}ms`);
    console.log(`  ${chalk.dim("Steps executed:")} ${result.metrics.stepsExecuted}`);
    console.log(`  ${chalk.dim("Actions executed:")} ${result.metrics.actionsExecuted}`);

    if (result.metrics.gasUsed > 0n) {
      console.log(`  ${chalk.dim("Gas used:")} ${result.metrics.gasUsed.toString()}`);
    }

    if (result.metrics.errors > 0) {
      console.log(`  ${chalk.red("Errors:")} ${result.metrics.errors}`);
    }

    // Show final state
    if (Object.keys(result.finalState).length > 0) {
      console.log();
      console.log(chalk.cyan("Final State:"));
      for (const [key, value] of Object.entries(result.finalState)) {
        console.log(`  ${chalk.dim(key)}: ${JSON.stringify(value)}`);
      }
    }

    // Exit with error if failed
    if (!result.success) {
      process.exit(1);
    }
  } catch (error) {
    spinner.fail(chalk.red(`Cast failed: ${(error as Error).message}`));
    process.exit(1);
  }
}
