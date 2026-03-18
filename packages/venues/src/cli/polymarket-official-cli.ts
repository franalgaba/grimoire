import { spawnSync } from "node:child_process";

export const OFFICIAL_CLI_BINARY = process.env.POLYMARKET_OFFICIAL_CLI?.trim() || "polymarket";

const OFFICIAL_CLI_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

export function runOfficialCli(args: string[]): void {
  const result = spawnSync(OFFICIAL_CLI_BINARY, args, { stdio: "inherit" });

  if (result.error) throw formatOfficialCliError(result.error);

  const exitCode = result.status ?? (result.signal ? 1 : 0);
  if (exitCode !== 0) process.exit(exitCode);
}

export function runOfficialJsonCommand(args: string[]): unknown {
  const outputArgs = ["--output", "json", ...args];
  const result = spawnSync(OFFICIAL_CLI_BINARY, outputArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: OFFICIAL_CLI_MAX_BUFFER_BYTES,
  });

  if (result.error) throw formatOfficialCliError(result.error);

  const status = result.status ?? (result.signal ? 1 : 0);
  if (status !== 0) {
    const stderr = (result.stderr ?? "").trim();
    const stdout = (result.stdout ?? "").trim();
    throw new Error(
      `Official polymarket CLI command failed: ${stderr || stdout || `exit code ${status}`}`
    );
  }

  const raw = (result.stdout ?? "").trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`Official polymarket CLI returned non-JSON output: ${raw.slice(0, 280)}`);
  }
}

export function probeOfficialCli(): { installed: boolean; version: string | null } {
  const result = spawnSync(OFFICIAL_CLI_BINARY, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024,
  });

  if (result.error) return { installed: false, version: null };

  const exitCode = result.status ?? (result.signal ? 1 : 0);
  if (exitCode !== 0) return { installed: false, version: null };

  return { installed: true, version: (result.stdout ?? "").trim() || null };
}

function formatOfficialCliError(error: Error): Error {
  const withCode = error as NodeJS.ErrnoException;
  if (withCode.code === "ENOENT") {
    return new Error(
      `Official polymarket CLI binary not found ('${OFFICIAL_CLI_BINARY}'). Install via: brew tap Polymarket/polymarket-cli && brew install polymarket`
    );
  }
  if (withCode.code === "ENOBUFS") {
    return new Error(
      `Official polymarket CLI produced output larger than the local buffer while scanning markets. Re-run with smaller pagination (for example lower --max-pages) or update to this wrapper version (buffer=${OFFICIAL_CLI_MAX_BUFFER_BYTES} bytes).`
    );
  }
  return new Error(`Failed to run official polymarket CLI: ${error.message}`);
}
