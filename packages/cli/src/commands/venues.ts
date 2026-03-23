/**
 * Venues Command
 * Lists available adapters and supported chains
 */

import chalk from "chalk";
import { loadAllAdapters } from "../lib/venue-discovery.js";

export async function venuesCommand(): Promise<unknown[]> {
  const allAdapters = await loadAllAdapters();
  const metas = allAdapters
    .map((adapter) => adapter.meta)
    .sort((a, b) => a.name.localeCompare(b.name));

  const headers = [
    "Name",
    "Exec",
    "Actions",
    "Chains",
    "Constraints",
    "Quote",
    "Sim",
    "Preview/Commit",
    "Env",
    "Endpoints",
    "Description",
  ];
  const rows = metas.map((meta) => [
    meta.name,
    meta.executionType ?? "evm",
    meta.actions.join(", "),
    meta.supportedChains.join(", "),
    meta.supportedConstraints.join(", "),
    formatBoolean(meta.supportsQuote),
    formatBoolean(meta.supportsSimulation),
    formatBoolean(meta.supportsPreviewCommit),
    formatArray(meta.requiredEnv),
    formatArray(meta.dataEndpoints),
    meta.description ?? "",
  ]);

  printTable(headers, rows);

  return metas;
}

function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0))
  );

  const formatRow = (row: string[]): string =>
    row.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ");

  console.error(chalk.bold(formatRow(headers)));
  console.error(chalk.dim(widths.map((width) => "-".repeat(width)).join("  ")));
  for (const row of rows) {
    console.error(formatRow(row));
  }
}

function formatArray(values: string[] | undefined): string {
  if (!values || values.length === 0) return "-";
  return values.join(", ");
}

function formatBoolean(value: boolean | undefined): string {
  if (value === true) return "yes";
  if (value === false) return "no";
  return "-";
}
