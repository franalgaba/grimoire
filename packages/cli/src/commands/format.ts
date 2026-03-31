import { readFile, writeFile } from "node:fs/promises";
import { formatGrimoire } from "@grimoirelabs/core";

export type FormatMode = "write" | "check" | "stdout" | "stdin";

export interface FormatFileResult {
  path: string;
  changed: boolean;
  formatted: boolean;
  error: {
    code: string;
    message: string;
    line?: number;
    column?: number;
  } | null;
}

export interface FormatCommandResult {
  success: boolean;
  mode: FormatMode;
  files: FormatFileResult[];
  summary: {
    total: number;
    changed: number;
    failed: number;
  };
}

export interface ParsedFormatArgs {
  mode: FormatMode;
  paths: string[];
  diff: boolean;
  json: boolean;
  stdinFilepath?: string;
}

interface ParseArgsOk {
  ok: true;
  args: ParsedFormatArgs;
}

interface ParseArgsFail {
  ok: false;
  code: string;
  message: string;
}

interface ParseArgsHelp {
  ok: true;
  help: true;
}

type ParseArgsResult = ParseArgsOk | ParseArgsFail | ParseArgsHelp;

export interface RunFormatResult {
  exitCode: number;
  result: FormatCommandResult;
  stdout?: string;
  stderrLines: string[];
  diffOutput: string[];
}

interface FormatCommandIO {
  writeStdout: (text: string) => void;
  writeStderr: (text: string) => void;
  readStdin: () => Promise<string>;
}

const DEFAULT_IO: FormatCommandIO = {
  writeStdout: (text) => {
    process.stdout.write(text);
  },
  writeStderr: (text) => {
    process.stderr.write(text);
  },
  readStdin: async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf8");
  },
};

export async function formatCommandFromArgv(
  argv: string[],
  ioOverrides?: Partial<FormatCommandIO>
): Promise<number> {
  const io: FormatCommandIO = {
    writeStdout: ioOverrides?.writeStdout ?? DEFAULT_IO.writeStdout,
    writeStderr: ioOverrides?.writeStderr ?? DEFAULT_IO.writeStderr,
    readStdin: ioOverrides?.readStdin ?? DEFAULT_IO.readStdin,
  };

  const parsed = parseFormatCliArgs(argv.slice(3));
  if ("help" in parsed) {
    io.writeStdout(formatHelpText());
    return 0;
  }

  if (!parsed.ok) {
    io.writeStderr(`[${parsed.code}] ${parsed.message}\n`);
    io.writeStderr(`\n${formatHelpText()}`);
    return 3;
  }

  const parsedArgs = parsed.args;
  const run = await runFormatCommand(parsedArgs, io);
  emitRunOutput(run, parsedArgs, io);
  return run.exitCode;
}

export function parseFormatCliArgs(tokens: string[]): ParseArgsResult {
  const args = {
    paths: [] as string[],
    write: false,
    check: false,
    diff: false,
    json: false,
    stdin: false,
    stdinFilepath: undefined as string | undefined,
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;

    if (token === "-h" || token === "--help") {
      return { ok: true, help: true };
    }

    if (!token.startsWith("-")) {
      args.paths.push(token);
      continue;
    }

    switch (token) {
      case "--write":
        args.write = true;
        break;
      case "--check":
        args.check = true;
        break;
      case "--diff":
        args.diff = true;
        break;
      case "--json":
        args.json = true;
        break;
      case "--stdin":
        args.stdin = true;
        break;
      case "--stdin-filepath": {
        const value = tokens[i + 1];
        if (!value || value.startsWith("-")) {
          return {
            ok: false,
            code: "ERR_FORMAT_USAGE",
            message: "--stdin-filepath requires a value",
          };
        }
        args.stdinFilepath = value;
        i += 1;
        break;
      }
      default:
        return {
          ok: false,
          code: "ERR_FORMAT_USAGE",
          message: `Unknown option '${token}'`,
        };
    }
  }

  if (args.write && args.check) {
    return {
      ok: false,
      code: "ERR_FORMAT_USAGE",
      message: "--write and --check cannot be combined",
    };
  }

  if (args.stdin && args.paths.length > 0) {
    return {
      ok: false,
      code: "ERR_FORMAT_USAGE",
      message: "Do not pass file paths when using --stdin",
    };
  }

  if (args.stdin && !args.stdinFilepath) {
    return {
      ok: false,
      code: "ERR_FORMAT_USAGE",
      message: "--stdin requires --stdin-filepath",
    };
  }

  if (!args.stdin && args.stdinFilepath) {
    return {
      ok: false,
      code: "ERR_FORMAT_USAGE",
      message: "--stdin-filepath requires --stdin",
    };
  }

  let mode: FormatMode;
  if (args.stdin) {
    mode = "stdin";
  } else if (args.write) {
    mode = "write";
  } else if (args.check) {
    mode = "check";
  } else {
    mode = "stdout";
  }

  if (!args.stdin && args.paths.length === 0) {
    return {
      ok: false,
      code: "ERR_FORMAT_USAGE",
      message: "At least one path is required unless using --stdin",
    };
  }

  if (mode === "stdout" && args.paths.length !== 1) {
    return {
      ok: false,
      code: "ERR_FORMAT_USAGE",
      message: "stdout mode requires exactly one path",
    };
  }

  return {
    ok: true,
    args: {
      mode,
      paths: args.paths,
      diff: args.diff,
      json: args.json,
      stdinFilepath: args.stdinFilepath,
    },
  };
}

interface FormatSourceEntry {
  path: string;
  source: string | null;
  writeBack: boolean;
  readError?: string;
}

export async function runFormatCommand(
  args: ParsedFormatArgs,
  ioOverrides?: { readStdin?: () => Promise<string> }
): Promise<RunFormatResult> {
  const readStdin = ioOverrides?.readStdin ?? DEFAULT_IO.readStdin;

  const sources: FormatSourceEntry[] = [];
  const stderrLines: string[] = [];

  if (args.mode === "stdin") {
    try {
      const source = await readStdin();
      sources.push({
        path: args.stdinFilepath ?? "<stdin>",
        source,
        writeBack: false,
      });
    } catch (error) {
      const message = (error as Error).message;
      const result: FormatCommandResult = {
        success: false,
        mode: args.mode,
        files: [
          {
            path: args.stdinFilepath ?? "<stdin>",
            changed: false,
            formatted: false,
            error: {
              code: "ERR_FORMAT_IO",
              message,
            },
          },
        ],
        summary: {
          total: 1,
          changed: 0,
          failed: 1,
        },
      };
      return {
        exitCode: 3,
        result,
        stderrLines: [`[ERR_FORMAT_IO] ${message}`],
        diffOutput: [],
      };
    }
  } else {
    for (const path of args.paths) {
      try {
        const source = await readFile(path, "utf8");
        sources.push({ path, source, writeBack: args.mode === "write" });
      } catch (error) {
        const message = (error as Error).message;
        stderrLines.push(`[ERR_FORMAT_IO] ${path}: ${message}`);
        sources.push({ path, source: null, writeBack: false, readError: message });
      }
    }
  }

  const files: FormatFileResult[] = [];
  const diffOutput: string[] = [];
  let stdout: string | undefined;
  let ioFailures = 0;

  for (const entry of sources) {
    if (entry.source === null) {
      const report: FormatFileResult = {
        path: entry.path,
        changed: false,
        formatted: false,
        error: {
          code: "ERR_FORMAT_IO",
          message: entry.readError ?? "Failed to read file",
        },
      };
      files.push(report);
      ioFailures += 1;
      continue;
    }

    const formattedResult = formatGrimoire(entry.source);
    if (!formattedResult.success || !formattedResult.formatted) {
      const parseError = formattedResult.error;
      const report: FormatFileResult = {
        path: entry.path,
        changed: false,
        formatted: false,
        error: {
          code: "ERR_FORMAT_PARSE",
          message: parseError?.message ?? "Unable to parse source",
          line: parseError?.line,
          column: parseError?.column,
        },
      };
      files.push(report);
      const location =
        parseError?.line !== undefined && parseError.column !== undefined
          ? ` (${parseError.line}:${parseError.column})`
          : "";
      const parseMessage = report.error?.message ?? "Unable to parse source";
      stderrLines.push(`[ERR_FORMAT_PARSE] ${entry.path}: ${parseMessage}${location}`);
      continue;
    }

    const formatted = formattedResult.formatted;
    const changed = entry.source !== formatted;

    if (args.diff && changed) {
      diffOutput.push(createUnifiedDiff(entry.path, entry.source, formatted));
    }

    if (entry.writeBack && changed) {
      try {
        await writeFile(entry.path, formatted, "utf8");
      } catch (error) {
        const message = (error as Error).message;
        files.push({
          path: entry.path,
          changed,
          formatted: false,
          error: {
            code: "ERR_FORMAT_IO",
            message,
          },
        });
        ioFailures += 1;
        stderrLines.push(`[ERR_FORMAT_IO] ${entry.path}: ${message}`);
        continue;
      }
    }

    if (args.mode === "stdout" || args.mode === "stdin") {
      stdout = formatted;
    }

    files.push({
      path: entry.path,
      changed,
      formatted: true,
      error: null,
    });
  }

  const failed = files.filter((file) => file.error !== null).length;
  const changed = files.filter((file) => file.changed).length;

  const result: FormatCommandResult = {
    success: failed === 0 && !(args.mode === "check" && changed > 0),
    mode: args.mode,
    files,
    summary: {
      total: files.length,
      changed,
      failed,
    },
  };

  const parseFailures = files.filter((file) => file.error?.code === "ERR_FORMAT_PARSE").length;

  let exitCode = 0;
  if (ioFailures > 0) {
    exitCode = 3;
  } else if (parseFailures > 0) {
    exitCode = 2;
  } else if (args.mode === "check" && changed > 0) {
    exitCode = 1;
  }

  return {
    exitCode,
    result,
    stdout,
    stderrLines,
    diffOutput,
  };
}

function emitRunOutput(
  run: RunFormatResult,
  args: ParsedFormatArgs,
  io: Pick<FormatCommandIO, "writeStdout" | "writeStderr">
): void {
  if (args.json) {
    io.writeStdout(`${JSON.stringify(run.result, null, 2)}\n`);
    return;
  }

  if (run.stdout !== undefined) {
    io.writeStdout(run.stdout);
  }

  if (run.diffOutput.length > 0) {
    io.writeStderr(`${run.diffOutput.join("\n")}\n`);
  }

  for (const line of run.stderrLines) {
    io.writeStderr(`${line}\n`);
  }

  if (args.mode === "write" && run.exitCode === 0) {
    io.writeStderr(`Formatted ${run.result.summary.changed} file(s).\n`);
  }

  if (args.mode === "check" && run.exitCode === 0) {
    io.writeStderr("All files are canonical.\n");
  }

  if (args.mode === "check" && run.exitCode === 1) {
    io.writeStderr(`${run.result.summary.changed} file(s) are not canonical.\n`);
  }
}

function createUnifiedDiff(path: string, before: string, after: string): string {
  const normalizedBefore = before.replace(/\r\n/g, "\n");
  const normalizedAfter = after.replace(/\r\n/g, "\n");
  if (normalizedBefore === normalizedAfter) {
    return "";
  }

  const beforeLines = splitLines(normalizedBefore);
  const afterLines = splitLines(normalizedAfter);

  const header = [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
  ];

  const removed = beforeLines.map((line) => `-${line}`);
  const added = afterLines.map((line) => `+${line}`);

  return [...header, ...removed, ...added].join("\n");
}

function splitLines(text: string): string[] {
  if (text.length === 0) {
    return [];
  }
  const withoutTrailingNewline = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (withoutTrailingNewline.length === 0) {
    return [];
  }
  return withoutTrailingNewline.split("\n");
}

export function formatHelpText(): string {
  return [
    "Usage:",
    "  grimoire format <paths...> --write",
    "  grimoire format <paths...> --check",
    "  grimoire format <path>",
    "  grimoire format --stdin --stdin-filepath <virtual-path>",
    "",
    "Options:",
    "  --write              Write formatted output in place",
    "  --check              Exit non-zero if files are not canonical",
    "  --diff               Print unified diff for changed files",
    "  --json               Print machine-readable result payload",
    "  --stdin              Read source from stdin",
    "  --stdin-filepath     Virtual filepath label for stdin diagnostics",
    "  -h, --help           Show this help",
  ].join("\n");
}
