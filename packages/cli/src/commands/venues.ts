/**
 * Venues Command
 * Lists available adapters and supported chains
 */

import { adapters } from "@grimoirelabs/venues";
import chalk from "chalk";

interface VenuesOptions {
  json?: boolean;
}

export async function venuesCommand(options: VenuesOptions): Promise<void> {
  const metas = adapters
    .map((adapter) => adapter.meta)
    .sort((a, b) => a.name.localeCompare(b.name));

  if (options.json) {
    console.log(JSON.stringify(metas, null, 2));
    return;
  }

  const headers = ["Name", "Exec", "Actions", "Chains", "Description"];
  const rows = metas.map((meta) => [
    meta.name,
    meta.executionType ?? "evm",
    meta.actions.join(", "),
    meta.supportedChains.join(", "),
    meta.description ?? "",
  ]);

  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0))
  );

  const formatRow = (row: string[]): string =>
    row.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ");

  console.log(chalk.bold(formatRow(headers)));
  console.log(chalk.dim(widths.map((width) => "-".repeat(width)).join("  ")));
  for (const row of rows) {
    console.log(formatRow(row));
  }
}
