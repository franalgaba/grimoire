export interface ParsedArgs {
  command?: string;
  options: Record<string, string | boolean>;
  positionals: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  let command: string | undefined = argv[0];
  const rest = argv.slice(1);
  const options: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  if (command === "--help" || command === "-h") {
    options.help = true;
    command = undefined;
  }

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg) continue;

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = rest[i + 1];
      if (!next || next.startsWith("--")) {
        options[key] = true;
      } else {
        options[key] = next;
        i++;
      }
    } else {
      positionals.push(arg);
    }
  }

  return { command, options, positionals };
}

export function getOption(
  options: Record<string, string | boolean>,
  key: string
): string | undefined {
  const value = options[key];
  if (typeof value === "string") return value;
  return undefined;
}

export function requireOption(options: Record<string, string | boolean>, key: string): string {
  const value = getOption(options, key);
  if (!value) {
    throw new Error(`Missing required option --${key}`);
  }
  return value;
}

export type OutputFormat = "auto" | "json" | "table";

export function printResult(data: unknown, format: OutputFormat = "auto"): void {
  if (format === "json") {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const table = renderTable(data);

  if (format === "table") {
    if (table) {
      console.log(table);
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
    return;
  }

  console.log(JSON.stringify(data, null, 2));
  if (table) {
    console.log(`\n${table}`);
  }
}

function renderTable(data: unknown): string | null {
  if (Array.isArray(data)) {
    if (data.length === 0) return null;
    const rows = data.filter((row) => typeof row === "object" && row !== null) as Record<
      string,
      unknown
    >[];
    if (rows.length === 0) return null;
    const headers = Array.from(
      rows.reduce((set, row) => {
        for (const key of Object.keys(row)) {
          set.add(key);
        }
        return set;
      }, new Set<string>())
    );
    return formatTable(
      headers,
      rows.map((row) => headers.map((key) => formatValue(row[key])))
    );
  }

  if (data && typeof data === "object") {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length === 0) return null;
    return formatTable(
      ["key", "value"],
      entries.map(([key, value]) => [key, formatValue(value)])
    );
  }

  return null;
}

function formatTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, i) =>
    Math.max(header.length, ...rows.map((row) => (row[i] ? row[i].length : 0)))
  );

  const line = (values: string[]) =>
    values.map((value, i) => value.padEnd(widths[i] ?? 0, " ")).join(" | ");

  const separator = widths.map((width) => "-".repeat(width)).join("-+-");

  return [line(headers), separator, ...rows.map((row) => line(row))].join("\n");
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return value.toString();
  }
  return JSON.stringify(value);
}
