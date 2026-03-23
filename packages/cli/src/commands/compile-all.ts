/**
 * Compile All Command
 * Compiles all .spell files in a directory
 */

import { readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { compileFile } from "@grimoirelabs/core";
import chalk from "chalk";

interface CompileAllOptions {
  failFast?: boolean;
}

type CompileResultSummary = {
  file: string;
  success: boolean;
  errors: Array<{ code: string; message: string; line?: number }>;
  warnings: Array<{ code: string; message: string; line?: number }>;
};

export async function compileAllCommand(
  directory: string | undefined,
  options: CompileAllOptions
): Promise<CompileResultSummary[]> {
  const targetDir = resolve(directory ?? "spells");
  const files = await collectSpellFiles(targetDir);

  if (files.length === 0) {
    throw new Error(`No .spell files found in ${targetDir}`);
  }

  const results: CompileResultSummary[] = [];
  let hasErrors = false;

  for (const file of files) {
    const result = await compileFile(file);
    const summary: CompileResultSummary = {
      file: relative(process.cwd(), file),
      success: result.success,
      errors: result.errors.map((error) => ({
        code: error.code,
        message: error.message,
        line: error.line,
      })),
      warnings: result.warnings.map((warning) => ({
        code: warning.code,
        message: warning.message,
        line: warning.line,
      })),
    };

    results.push(summary);

    if (summary.success) {
      console.error(chalk.green(`✓ ${summary.file}`));
    } else {
      console.error(chalk.red(`✗ ${summary.file}`));
    }

    for (const warning of summary.warnings) {
      const lineInfo = warning.line !== undefined ? ` (line ${warning.line})` : "";
      console.error(chalk.yellow(`  [${warning.code}] ${warning.message}${lineInfo}`));
    }

    for (const error of summary.errors) {
      const lineInfo = error.line !== undefined ? ` (line ${error.line})` : "";
      console.error(chalk.red(`  [${error.code}] ${error.message}${lineInfo}`));
    }

    if (!summary.success) {
      hasErrors = true;
      if (options.failFast) {
        break;
      }
    }
  }

  if (hasErrors) {
    throw new Error("One or more spells failed to compile");
  }

  return results;
}

async function collectSpellFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectSpellFiles(fullPath);
      files.push(...nested);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".spell")) {
      const info = await stat(fullPath);
      if (info.isFile()) {
        files.push(fullPath);
      }
    }
  }

  return files.sort();
}
