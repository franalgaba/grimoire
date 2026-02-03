/**
 * Advisor Skill Registry (Agent Skills compatible)
 * Loads SKILL.md frontmatter metadata for allowed tools.
 */

import fs from "node:fs";
import path from "node:path";

export interface AdvisorSkillMeta {
  name: string;
  dir: string;
  allowedTools?: string[];
}

export function resolveAdvisorSkill(name: string, searchDirs: string[]): AdvisorSkillMeta | null {
  for (const base of searchDirs) {
    const dir = path.join(base, name);
    const skillPath = path.join(dir, "SKILL.md");
    if (!fs.existsSync(skillPath)) continue;
    const content = fs.readFileSync(skillPath, "utf8");
    const meta = parseFrontmatter(content);
    return {
      name: meta.name ?? name,
      dir,
      allowedTools: meta.allowedTools,
    };
  }
  return null;
}

function parseFrontmatter(content: string): { name?: string; allowedTools?: string[] } {
  if (!content.startsWith("---")) return {};
  const end = content.indexOf("\n---", 3);
  if (end === -1) return {};
  const fm = content.slice(3, end).trim();
  const lines = fm.split("\n");
  const result: { name?: string; allowedTools?: string[] } = {};
  const allowedToolsKeys = new Set(["allowed-tools", "allowed_tools", "allowedTools", "tools"]);

  let currentKey: string | null = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("-") && currentKey && allowedToolsKeys.has(currentKey)) {
      const tool = line.replace(/^-+\s*/, "");
      if (!result.allowedTools) result.allowedTools = [];
      result.allowedTools.push(tool);
      continue;
    }
    const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    currentKey = key;
    if (key === "name") {
      result.name = value.replace(/^\"|\"$/g, "");
    }
    if (allowedToolsKeys.has(key)) {
      if (value.startsWith("[") && value.endsWith("]")) {
        const inner = value.slice(1, -1).trim();
        if (inner) {
          result.allowedTools = inner
            .split(",")
            .map((v) => v.trim().replace(/^\"|\"$/g, ""))
            .filter(Boolean);
        }
      } else if (value) {
        result.allowedTools = [value.replace(/^\"|\"$/g, "")];
      } else {
        result.allowedTools = [];
      }
    }
  }

  return result;
}
