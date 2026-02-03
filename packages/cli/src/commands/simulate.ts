/**
 * Simulate Command
 * Simulates spell execution (dry run)
 */

import { type Address, compileFile, execute } from "@grimoirelabs/core";
import { adapters } from "@grimoirelabs/venues";
import chalk from "chalk";
import ora from "ora";
import { resolveAdvisorSkillsDirs } from "./advisor-skill-helpers.js";
import { withStatePersistence } from "./state-helpers.js";

interface SimulateOptions {
  params?: string;
  vault?: string;
  chain?: string;
  advisorSkillsDir?: string | string[];
  stateDir?: string;
  noState?: boolean;
}

export async function simulateCommand(spellPath: string, options: SimulateOptions): Promise<void> {
  const spinner = ora(`Simulating ${spellPath}...`).start();

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

    // Execute in simulation mode
    spinner.text = "Executing simulation...";
    const vault = (options.vault ?? "0x0000000000000000000000000000000000000000") as Address;
    const chain = Number.parseInt(options.chain ?? "1", 10);
    const spell = compileResult.ir;
    const advisorSkillsDirs = resolveAdvisorSkillsDirs(options.advisorSkillsDir);

    const result = await withStatePersistence(
      spell.id,
      { stateDir: options.stateDir, noState: options.noState },
      async (persistentState) => {
        return execute({
          spell,
          vault,
          chain,
          params,
          persistentState,
          simulate: true,
          adapters,
          advisorSkillsDirs,
        });
      }
    );

    // Report result
    if (result.success) {
      spinner.succeed(chalk.green("Simulation completed successfully"));
    } else {
      spinner.fail(chalk.red(`Simulation failed: ${result.error}`));
    }

    // Show execution summary
    console.log();
    console.log(chalk.cyan("Execution Summary:"));
    console.log(chalk.dim(`  Run ID: ${result.runId}`));
    console.log(chalk.dim(`  Duration: ${result.duration}ms`));
    console.log(chalk.dim(`  Steps executed: ${result.metrics.stepsExecuted}`));
    console.log(chalk.dim(`  Actions executed: ${result.metrics.actionsExecuted}`));
    console.log(chalk.dim(`  Errors: ${result.metrics.errors}`));

    // Show final state
    if (Object.keys(result.finalState).length > 0) {
      console.log();
      console.log(chalk.cyan("Final State:"));
      console.log(chalk.dim(JSON.stringify(result.finalState, null, 2)));
    }

    // Show events
    console.log();
    console.log(chalk.cyan("Event Log:"));
    for (const entry of result.ledgerEvents.slice(-10)) {
      const time = new Date(entry.timestamp).toISOString().split("T")[1]?.replace("Z", "");
      const eventType = chalk.blue(entry.event.type.padEnd(20));
      let details = "";

      if (entry.event.type === "step_started") {
        details = chalk.dim(`step=${entry.event.stepId}`);
      } else if (entry.event.type === "step_completed") {
        details = chalk.dim(`step=${entry.event.stepId}`);
      } else if (entry.event.type === "step_failed") {
        details = chalk.red(`step=${entry.event.stepId} error=${entry.event.error}`);
      } else if (entry.event.type === "binding_set") {
        details = chalk.dim(`${entry.event.name}=${JSON.stringify(entry.event.value)}`);
      } else if (entry.event.type === "guard_failed") {
        details = chalk.yellow(`guard=${entry.event.guardId} msg=${entry.event.message}`);
      }

      console.log(`  ${chalk.dim(time)} ${eventType} ${details}`);
    }

    if (result.ledgerEvents.length > 10) {
      console.log(chalk.dim(`  ... and ${result.ledgerEvents.length - 10} more events`));
    }

    if (!result.success) {
      process.exit(1);
    }
  } catch (error) {
    spinner.fail(chalk.red(`Simulation failed: ${(error as Error).message}`));
    process.exit(1);
  }
}
