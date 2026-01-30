/**
 * Log Command
 * View ledger events for a specific spell run
 */

import { join } from "node:path";
import { SqliteStateStore } from "@grimoire/core";
import chalk from "chalk";

interface LogOptions {
  json?: boolean;
  stateDir?: string;
}

export async function logCommand(
  spellId: string,
  runId: string,
  options: LogOptions
): Promise<void> {
  const dbPath = options.stateDir ? join(options.stateDir, "grimoire.db") : undefined;

  const store = new SqliteStateStore({ dbPath });

  try {
    const entries = await store.loadLedger(spellId, runId);

    if (!entries) {
      console.log(chalk.dim(`No ledger found for spell "${spellId}" run "${runId}".`));

      // Suggest checking history
      const runs = await store.getRuns(spellId, 5);
      if (runs.length > 0) {
        console.log();
        console.log(chalk.dim("Recent runs:"));
        for (const run of runs) {
          console.log(chalk.dim(`  ${run.runId}`));
        }
      }
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(entries, null, 2));
      return;
    }

    console.log(
      chalk.cyan(`Ledger for ${chalk.white(spellId)} run ${chalk.white(runId.slice(0, 8))}:`)
    );
    console.log();

    for (const entry of entries) {
      const time = new Date(entry.timestamp).toISOString().split("T")[1]?.replace("Z", "");
      const eventType = chalk.blue(entry.event.type.padEnd(24));
      let details = "";

      switch (entry.event.type) {
        case "run_started":
          details = chalk.dim(`spell=${entry.event.spellId}`);
          break;
        case "run_completed":
          details = entry.event.success ? chalk.green("success") : chalk.red("failed");
          break;
        case "run_failed":
          details = chalk.red(entry.event.error);
          break;
        case "step_started":
          details = chalk.dim(`step=${entry.event.stepId} kind=${entry.event.kind}`);
          break;
        case "step_completed":
          details = chalk.dim(`step=${entry.event.stepId}`);
          break;
        case "step_failed":
          details = chalk.red(`step=${entry.event.stepId} error=${entry.event.error}`);
          break;
        case "step_skipped":
          details = chalk.yellow(`step=${entry.event.stepId} reason=${entry.event.reason}`);
          break;
        case "binding_set":
          details = chalk.dim(`${entry.event.name}=${JSON.stringify(entry.event.value)}`);
          break;
        case "guard_passed":
          details = chalk.dim(`guard=${entry.event.guardId}`);
          break;
        case "guard_failed":
          details = chalk.yellow(`guard=${entry.event.guardId} msg=${entry.event.message}`);
          break;
        case "action_simulated":
          details = chalk.dim(`venue=${entry.event.venue}`);
          break;
        case "action_submitted":
          details = chalk.dim(`tx=${entry.event.txHash}`);
          break;
        case "action_confirmed":
          details = chalk.green(`tx=${entry.event.txHash} gas=${entry.event.gasUsed}`);
          break;
        case "action_reverted":
          details = chalk.red(`tx=${entry.event.txHash} reason=${entry.event.reason}`);
          break;
        default:
          details = chalk.dim(JSON.stringify(entry.event));
      }

      console.log(`  ${chalk.dim(time)} ${eventType} ${details}`);
    }
  } finally {
    store.close();
  }
}
