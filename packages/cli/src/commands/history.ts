/**
 * History Command
 * View execution history for spells
 */

import { join } from "node:path";
import { SqliteStateStore } from "@grimoire/core";
import chalk from "chalk";

interface HistoryOptions {
  limit?: string;
  json?: boolean;
  stateDir?: string;
}

export async function historyCommand(
  spellId: string | undefined,
  options: HistoryOptions
): Promise<void> {
  const dbPath = options.stateDir ? join(options.stateDir, "grimoire.db") : undefined;

  const store = new SqliteStateStore({ dbPath });

  try {
    if (!spellId) {
      // List all spells with state
      const spells = await store.listSpells();

      if (spells.length === 0) {
        console.log(chalk.dim("No spell state found. Run a spell first."));
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(spells, null, 2));
        return;
      }

      console.log(chalk.cyan("Spells with saved state:"));
      console.log();
      for (const id of spells) {
        const runs = await store.getRuns(id, 1);
        const lastRun = runs[0];
        if (lastRun) {
          const status = lastRun.success ? chalk.green("ok") : chalk.red("fail");
          console.log(`  ${chalk.white(id)}  ${status}  ${chalk.dim(lastRun.timestamp)}`);
        } else {
          console.log(`  ${chalk.white(id)}  ${chalk.dim("(no runs)")}`);
        }
      }
    } else {
      // Show runs for specific spell
      const limit = options.limit ? Number.parseInt(options.limit, 10) : 20;
      const runs = await store.getRuns(spellId, limit);

      if (runs.length === 0) {
        console.log(chalk.dim(`No runs found for spell "${spellId}".`));
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(runs, null, 2));
        return;
      }

      console.log(chalk.cyan(`Run history for ${chalk.white(spellId)}:`));
      console.log();

      for (const run of runs) {
        const status = run.success ? chalk.green("ok  ") : chalk.red("FAIL");
        const duration = chalk.dim(`${run.duration}ms`);
        const steps = chalk.dim(`${run.metrics.stepsExecuted} steps`);
        const actions = chalk.dim(`${run.metrics.actionsExecuted} actions`);
        const errors = run.metrics.errors > 0 ? chalk.red(` ${run.metrics.errors} errors`) : "";

        console.log(
          `  ${status}  ${chalk.dim(run.runId.slice(0, 8))}  ${chalk.dim(run.timestamp)}  ${duration}  ${steps}  ${actions}${errors}`
        );

        if (run.error) {
          console.log(`        ${chalk.red(run.error)}`);
        }
      }
    }
  } finally {
    store.close();
  }
}
