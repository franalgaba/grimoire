/**
 * History Command
 * View execution history for spells
 */

import { join } from "node:path";
import { getSessionLedgerView, getSessionPnlView, SqliteStateStore } from "@grimoirelabs/core";
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
      const sessionLedger = await getSessionLedgerView(store, spellId, limit);
      const sessionPnl = await getSessionPnlView(store, spellId, limit);

      if (runs.length === 0) {
        console.log(chalk.dim(`No runs found for spell "${spellId}".`));
        return;
      }

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              runs,
              sessionLedger,
              sessionPnl,
            },
            null,
            2
          )
        );
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

        if (run.crossChain) {
          const trackSummary = run.crossChain.tracks
            .map((track) => `${track.trackId}:${track.status}`)
            .join(", ");
          const handoffSummary = run.crossChain.handoffs
            .map((handoff) => `${handoff.handoffId}:${handoff.status}`)
            .join(", ");
          console.log(`        ${chalk.dim(`cross_chain tracks=[${trackSummary}]`)}`);
          if (handoffSummary.length > 0) {
            console.log(`        ${chalk.dim(`cross_chain handoffs=[${handoffSummary}]`)}`);
          }
        }
      }

      console.log();
      console.log(chalk.cyan("Session ledger:"));
      console.log(
        `  runs=${sessionLedger.runs.total} success=${sessionLedger.runs.success} failed=${sessionLedger.runs.failed}`
      );
      if (sessionLedger.runs.latestRunAt) {
        console.log(`  latest=${chalk.dim(sessionLedger.runs.latestRunAt)}`);
      }
      console.log(`  triggers=${formatCounts(sessionLedger.triggers)}`);
      console.log(`  receipts=${formatCounts(sessionLedger.receipts)}`);

      console.log();
      console.log(chalk.cyan("Session P&L (ledger-derived):"));
      console.log(
        `  runs=${sessionPnl.runCount} deltas=${sessionPnl.deltaCount} accounting=${sessionPnl.accountingPassed ? "ok" : "failed"}`
      );
      console.log(`  net=${sessionPnl.totalNet} total_unaccounted=${sessionPnl.totalUnaccounted}`);
      if (sessionPnl.assets.length === 0) {
        console.log(`  ${chalk.dim("(no value deltas)")}`);
      } else {
        for (const asset of sessionPnl.assets) {
          console.log(
            `  ${asset.asset} net=${asset.net} credits=${asset.credits} debits=${asset.debits} fees=${asset.fees} losses=${asset.losses}`
          );
        }
      }
    }
  } finally {
    store.close();
  }
}

function formatCounts(counter: Record<string, number>): string {
  const entries = Object.entries(counter).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) {
    return "none";
  }
  return entries.map(([key, value]) => `${key}:${value}`).join(", ");
}
