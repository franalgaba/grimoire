import { existsSync } from "node:fs";
import { resolve } from "node:path";

function normalizeDirs(input?: string | string[]): string[] {
  if (!input) return [];
  const raw = Array.isArray(input) ? input : [input];
  return raw
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => resolve(entry));
}

export function resolveAdvisorSkillsDirs(input?: string | string[]): string[] | undefined {
  const dirs = normalizeDirs(input);
  if (dirs.length > 0) {
    return dirs;
  }

  const defaultDir = resolve(process.cwd(), "skills");
  if (existsSync(defaultDir)) {
    return [defaultDir];
  }

  return undefined;
}
