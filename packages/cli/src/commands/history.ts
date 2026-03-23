/**
 * History Command
 * View execution history for spells
 */

import { join } from "node:path";
import { getSessionLedgerView, getSessionPnlView, SqliteStateStore } from "@grimoirelabs/core";
import chalk from "chalk";

interface HistoryOptions {
  limit?: string;
  stateDir?: string;
}

export async function historyCommand(
  spellId: string | undefined,
  options: HistoryOptions
): Promise<unknown> {
  const dbPath = options.stateDir ? join(options.stateDir, "grimoire.db") : undefined;

  const store = new SqliteStateStore({ dbPath });

  try {
    if (!spellId) {
      // List all spells with state
      const spells = await store.listSpells();

      if (spells.length === 0) {
        console.error(chalk.dim("No spell state found. Run a spell first."));
        return spells;
      }

      const spellSummaries = [];
      console.error(chalk.cyan("Spells with saved state:"));
      console.error();
      for (const id of spells) {
        const runs = await store.getRuns(id, 1);
        const lastRun = runs[0];
        if (lastRun) {
          const status = lastRun.success ? chalk.green("ok") : chalk.red("fail");
          console.error(`  ${chalk.white(id)}  ${status}  ${chalk.dim(lastRun.timestamp)}`);
        } else {
          console.error(`  ${chalk.white(id)}  ${chalk.dim("(no runs)")}`);
        }
        spellSummaries.push({ id, lastRun: lastRun ?? null });
      }

      return spellSummaries;
    }

    // Show runs for specific spell
    const limit = options.limit ? Number.parseInt(options.limit, 10) : 20;
    const runs = await store.getRuns(spellId, limit);
    const sessionLedger = await getSessionLedgerView(store, spellId, limit);
    const sessionPnl = await getSessionPnlView(store, spellId, limit);

    if (runs.length === 0) {
      console.error(chalk.dim(`No runs found for spell "${spellId}".`));
      return { runs, sessionLedger, sessionPnl };
    }

    console.error(chalk.cyan(`Run history for ${chalk.white(spellId)}:`));
    console.error();

    for (const run of runs) {
      const status = run.success ? chalk.green("ok  ") : chalk.red("FAIL");
      const duration = chalk.dim(`${run.duration}ms`);
      const steps = chalk.dim(`${run.metrics.stepsExecuted} steps`);
      const actions = chalk.dim(`${run.metrics.actionsExecuted} actions`);
      const errors = run.metrics.errors > 0 ? chalk.red(` ${run.metrics.errors} errors`) : "";

      console.error(
        `  ${status}  ${chalk.dim(run.runId.slice(0, 8))}  ${chalk.dim(run.timestamp)}  ${duration}  ${steps}  ${actions}${errors}`
      );

      if (run.error) {
        console.error(`        ${chalk.red(run.error)}`);
      }

      if (run.crossChain) {
        const trackSummary = run.crossChain.tracks
          .map((track) => `${track.trackId}:${track.status}`)
          .join(", ");
        const handoffSummary = run.crossChain.handoffs
          .map((handoff) => `${handoff.handoffId}:${handoff.status}`)
          .join(", ");
        console.error(`        ${chalk.dim(`cross_chain tracks=[${trackSummary}]`)}`);
        if (handoffSummary.length > 0) {
          console.error(`        ${chalk.dim(`cross_chain handoffs=[${handoffSummary}]`)}`);
        }
      }
    }

    console.error();
    console.error(chalk.cyan("Session ledger:"));
    console.error(
      `  runs=${sessionLedger.runs.total} success=${sessionLedger.runs.success} failed=${sessionLedger.runs.failed}`
    );
    if (sessionLedger.runs.latestRunAt) {
      console.error(`  latest=${chalk.dim(sessionLedger.runs.latestRunAt)}`);
    }
    console.error(`  triggers=${formatCounts(sessionLedger.triggers)}`);
    console.error(`  receipts=${formatCounts(sessionLedger.receipts)}`);

    console.error();
    console.error(chalk.cyan("Session P&L (ledger-derived):"));
    console.error(
      `  runs=${sessionPnl.runCount} deltas=${sessionPnl.deltaCount} accounting=${sessionPnl.accountingPassed ? "ok" : "failed"}`
    );
    console.error(`  net=${sessionPnl.totalNet} total_unaccounted=${sessionPnl.totalUnaccounted}`);
    if (sessionPnl.assets.length === 0) {
      console.error(`  ${chalk.dim("(no value deltas)")}`);
    } else {
      for (const asset of sessionPnl.assets) {
        console.error(
          `  ${asset.asset} net=${asset.net} credits=${asset.credits} debits=${asset.debits} fees=${asset.fees} losses=${asset.losses}`
        );
      }
    }

    return { runs, sessionLedger, sessionPnl };
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
