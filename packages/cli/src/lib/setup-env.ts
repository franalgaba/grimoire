import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

const DEFAULT_SETUP_ENV_FILE = join(".grimoire", "setup.env");
const SETUP_ENV_FILE_ENV = "GRIMOIRE_SETUP_ENV_FILE";

type EnvRecord = Record<string, string | undefined>;

export interface LoadSetupEnvResult {
  loadedPath?: string;
  loadedKeys: string[];
}

export function loadSetupEnv(options?: {
  cwd?: string;
  env?: EnvRecord;
  explicitPath?: string;
}): LoadSetupEnvResult {
  const env = options?.env ?? process.env;
  const cwd = options?.cwd ?? process.cwd();
  const envPath = options?.explicitPath ?? env[SETUP_ENV_FILE_ENV];
  const setupEnvPath = resolveSetupEnvPath(cwd, envPath);
  if (!setupEnvPath) {
    return { loadedKeys: [] };
  }

  let content: string;
  try {
    content = readFileSync(setupEnvPath, "utf8");
  } catch {
    return { loadedKeys: [] };
  }

  let parsed: Record<string, string>;
  try {
    parsed = parseSetupEnv(content);
  } catch {
    return { loadedKeys: [] };
  }

  const loadedKeys: string[] = [];
  for (const [name, value] of Object.entries(parsed)) {
    if (env[name] === undefined) {
      env[name] = value;
      loadedKeys.push(name);
    }
  }

  return {
    loadedPath: loadedKeys.length > 0 ? setupEnvPath : undefined,
    loadedKeys,
  };
}

function resolveSetupEnvPath(cwd: string, envPath?: string): string | undefined {
  const trimmedEnvPath = envPath?.trim();
  if (trimmedEnvPath && trimmedEnvPath.length > 0) {
    const explicitPath = isAbsolute(trimmedEnvPath) ? trimmedEnvPath : resolve(cwd, trimmedEnvPath);
    return existsSync(explicitPath) ? explicitPath : undefined;
  }

  let current = resolve(cwd);
  while (true) {
    const candidate = join(current, DEFAULT_SETUP_ENV_FILE);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return undefined;
}

export function parseSetupEnv(content: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  const lines = content.split(/\r?\n/u);

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u);
    if (!match) {
      throw new Error(`Invalid setup env line: ${line}`);
    }

    const name = match[1];
    const rawValue = match[2] ?? "";
    parsed[name] = decodeEnvValue(rawValue);
  }

  return parsed;
}

function decodeEnvValue(rawValue: string): string {
  const value = rawValue.trim();
  if (value.length === 0) {
    return "";
  }

  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("'\"'\"'", "'");
  }

  if (value.startsWith('"') && value.endsWith('"')) {
    return decodeDoubleQuoted(value.slice(1, -1));
  }

  return value;
}

function decodeDoubleQuoted(input: string): string {
  let output = "";
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char !== "\\") {
      output += char;
      continue;
    }
    index += 1;
    if (index >= input.length) {
      output += "\\";
      break;
    }

    const escaped = input[index];
    switch (escaped) {
      case "n":
        output += "\n";
        break;
      case "r":
        output += "\r";
        break;
      case "t":
        output += "\t";
        break;
      case "\\":
      case '"':
      case "$":
      case "`":
        output += escaped;
        break;
      default:
        output += escaped;
        break;
    }
  }
  return output;
}
