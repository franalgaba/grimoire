#!/usr/bin/env bun
/**
 * Migration script: convert indentation-based .spell files to brace-delimited syntax.
 *
 * Rules:
 *  - `spell Name` → `spell Name {` … `}`
 *  - Section headers like `params:`, `venues:`, `state:` etc. with indented body → `section: {` … `}`
 *  - Control flow `if cond:` → `if cond {` … `}`
 *  - `elif cond:` → `} elif cond {`
 *  - `else:` → `} else {`
 *  - `try:` → `try {`, `catch E:` → `} catch E {`, `finally:` → `} finally {`
 *  - `parallel …:` → `parallel … {`, branch `name:` + indent → `name: {` … `}`
 *  - `for x in y:` → `for x in y {`
 *  - `repeat N:` → `repeat N {`
 *  - `loop until … max N:` → `loop until … max N {`
 *  - `atomic …:` → `atomic … {`
 *  - `block name(…):` → `block name(…) {`
 *  - `on trigger:` → `on trigger: {`
 *  - Pipeline `| op …:` → `| op …: {`
 *  - Advise sub-block indent → `{` … `}`
 *  - Nested config blocks (rate_limit:, default_constraints:, retry:) → `key: {` … `}`
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function indentLevel(line: string): number {
  let spaces = 0;
  for (const ch of line) {
    if (ch === " ") spaces++;
    else if (ch === "\t") spaces += 2;
    else break;
  }
  return spaces;
}

function trimmedContent(line: string): string {
  return line.trimStart();
}

function isBlankOrComment(line: string): boolean {
  const t = line.trim();
  return t === "" || t.startsWith("#");
}

// Which keywords introduce a colon-terminated block?
const SECTION_HEADERS = new Set([
  "params",
  "venues",
  "limits",
  "state",
  "skills",
  "advisors",
  "guards",
]);

// These are nested config keys that also introduce indented blocks
const NESTED_CONFIG_KEYS = new Set(["rate_limit", "default_constraints", "retry", "output"]);

// Control-flow keywords that use Pattern B (keyword ... { ... })
// The colon at end of line gets removed and replaced with opening brace.
const CONTROL_FLOW_RE =
  /^(if\s+.+|elif\s+.+|else|for\s+.+\s+in\s+.+|repeat\s+\d+|loop\s+until\s+.+|try|catch\s+.+|catch\s*\*|finally|atomic(?:\s+(?:skip|halt|revert))?):\s*$/;

const BLOCK_DEF_RE = /^(block\s+\w+(?:\([^)]*\))?):\s*$/;

// on trigger: (Pattern A — keeps colon)
const ON_TRIGGER_RE = /^(on\s+.+?):\s*$/;

// Pipeline stage: | op ...:
const PIPELINE_RE = /^(\|\s+\w+(?:\s+.+?)?):\s*$/;

// Section header: keyword:
const SECTION_RE = /^(\w+):\s*$/;

// Branch label inside parallel: name:
const BRANCH_RE = /^(\w+):\s*$/;

// Assets block form: assets:  (with no inline value)
const _ASSETS_BLOCK_RE = /^assets:\s*$/;

// Advise sub-block field: output:, timeout:, fallback: etc.
// We only brace-wrap `output:` if it starts a nested block
// retry: and rate_limit: and default_constraints: also get braces

// ─────────────────────────────────────────────────────────────────────────────
// Core transformer
// ─────────────────────────────────────────────────────────────────────────────

function migrateSpell(source: string): string {
  const lines = source.split("\n");
  const out: string[] = [];

  let i = 0;

  /** Emit a line with given indent (in spaces). */
  function emitLine(indent: number, content: string): void {
    if (content === "") {
      out.push("");
    } else {
      out.push(" ".repeat(indent) + content);
    }
  }

  /** Consume blank/comment lines, copying them to output */
  function copyBlanks(outputIndent: number): void {
    while (i < lines.length && isBlankOrComment(lines[i])) {
      const t = lines[i].trim();
      if (t === "") {
        out.push("");
      } else {
        emitLine(outputIndent, t);
      }
      i++;
    }
  }

  /** Read the body lines at a given indentation level, returning them.
   *  Does NOT consume them — just peeks. */
  function bodyIndent(): number {
    // Find the indentation of the first non-blank line after current position
    let j = i;
    while (j < lines.length && isBlankOrComment(lines[j])) j++;
    if (j >= lines.length) return 0;
    return indentLevel(lines[j]);
  }

  /**
   * Process a block at `blockIndent` level of the original source.
   * Emits with `outputIndent` in the output.
   */
  function processBlock(blockIndent: number, outputIndent: number): void {
    while (i < lines.length) {
      // Skip blank/comment lines
      if (isBlankOrComment(lines[i])) {
        copyBlanks(outputIndent);
        continue;
      }

      const lineIndent = indentLevel(lines[i]);
      // If we've dedented out of this block, stop
      if (lineIndent < blockIndent) break;

      const content = trimmedContent(lines[i]);

      // ── spell declaration ─────────────────────────────────────────
      if (content.startsWith("spell ") && !content.includes("{")) {
        const spellLine = content; // e.g. "spell SimpleSwap"
        emitLine(outputIndent, `${spellLine} {`);
        i++;
        const childIndent = bodyIndent();
        if (childIndent > lineIndent) {
          processBlock(childIndent, outputIndent + 2);
        }
        emitLine(outputIndent, "}");
        continue;
      }

      // ── block definition: block name(args): ───────────────────────
      const blockDefMatch = content.match(BLOCK_DEF_RE);
      if (blockDefMatch) {
        emitLine(outputIndent, `${blockDefMatch[1]} {`);
        i++;
        const childIndent = bodyIndent();
        if (childIndent > lineIndent) {
          processBlock(childIndent, outputIndent + 2);
        }
        emitLine(outputIndent, "}");
        continue;
      }

      // ── on trigger: ──────────────────────────────────────────────
      const triggerMatch = content.match(ON_TRIGGER_RE);
      if (triggerMatch && content.startsWith("on ")) {
        emitLine(outputIndent, `${triggerMatch[1]}: {`);
        i++;
        const childIndent = bodyIndent();
        if (childIndent > lineIndent) {
          processBlock(childIndent, outputIndent + 2);
        }
        emitLine(outputIndent, "}");
        continue;
      }

      // ── control flow (if/elif/else/for/repeat/loop/try/catch/finally/atomic) ──
      const controlMatch = content.match(CONTROL_FLOW_RE);
      if (controlMatch) {
        const keyword = controlMatch[1];

        // elif and else need to close the previous if/elif block
        if (keyword.startsWith("elif") || keyword === "else") {
          // Remove the last closing brace we emitted (it'll be on the previous line of output)
          // and combine with this keyword
          let lastIdx = out.length - 1;
          while (lastIdx >= 0 && out[lastIdx].trim() === "") lastIdx--;
          if (lastIdx >= 0 && out[lastIdx].trim() === "}") {
            const closeBraceIndent = indentLevel(out[lastIdx]);
            out.splice(lastIdx, 1);
            // Also remove trailing blanks after splice
            while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();
            emitLine(closeBraceIndent, `} ${keyword} {`);
          } else {
            emitLine(outputIndent, `${keyword} {`);
          }
        } else if (keyword.startsWith("catch") || keyword === "finally") {
          // catch/finally close the try/previous-catch block
          let lastIdx = out.length - 1;
          while (lastIdx >= 0 && out[lastIdx].trim() === "") lastIdx--;
          if (lastIdx >= 0 && out[lastIdx].trim() === "}") {
            const closeBraceIndent = indentLevel(out[lastIdx]);
            out.splice(lastIdx, 1);
            while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();
            emitLine(closeBraceIndent, `} ${keyword} {`);
          } else {
            emitLine(outputIndent, `${keyword} {`);
          }
        } else {
          emitLine(outputIndent, `${keyword} {`);
        }
        i++;
        const childIndent = bodyIndent();
        if (childIndent > lineIndent) {
          processBlock(childIndent, outputIndent + 2);
        }
        emitLine(outputIndent, "}");
        continue;
      }

      // ── parallel ...: ─────────────────────────────────────────────
      if (content.startsWith("parallel ") && content.endsWith(":")) {
        const header = content.slice(0, -1).trim(); // remove trailing colon
        emitLine(outputIndent, `${header} {`);
        i++;
        const childIndent = bodyIndent();
        if (childIndent > lineIndent) {
          processParallelBranches(childIndent, outputIndent + 2);
        }
        emitLine(outputIndent, "}");
        continue;
      }

      // ── pipeline stage: | op ...: ────────────────────────────────
      const pipelineMatch = content.match(PIPELINE_RE);
      if (pipelineMatch) {
        emitLine(outputIndent, `${pipelineMatch[1]}: {`);
        i++;
        const childIndent = bodyIndent();
        if (childIndent > lineIndent) {
          processBlock(childIndent, outputIndent + 2);
        }
        emitLine(outputIndent, "}");
        continue;
      }

      // ── section headers (params:, venues:, etc.) ──────────────────
      const sectionMatch = content.match(SECTION_RE);
      if (sectionMatch && SECTION_HEADERS.has(sectionMatch[1])) {
        // Check if next non-blank line is indented (block form)
        const nextIndent = peekNextContentIndent(i + 1, lineIndent);
        if (nextIndent > lineIndent) {
          emitLine(outputIndent, `${sectionMatch[1]}: {`);
          i++;
          processSection(nextIndent, outputIndent + 2, sectionMatch[1]);
          emitLine(outputIndent, "}");
        } else {
          // Inline or empty — just emit as-is
          emitLine(outputIndent, content);
          i++;
        }
        continue;
      }

      // ── assets: (block form without inline) ──────────────────────
      if (content === "assets:") {
        const nextIndent = peekNextContentIndent(i + 1, lineIndent);
        if (nextIndent > lineIndent) {
          emitLine(outputIndent, "assets: {");
          i++;
          processSection(nextIndent, outputIndent + 2, "assets");
          emitLine(outputIndent, "}");
        } else {
          emitLine(outputIndent, content);
          i++;
        }
        continue;
      }

      // ── advise sub-block (output:, etc. with indent body) ─────────
      if (
        content.match(/^(output|retry|rate_limit|default_constraints):\s*$/) &&
        NESTED_CONFIG_KEYS.has(content.replace(":", "").trim())
      ) {
        const key = content.replace(":", "").trim();
        const nextIndent = peekNextContentIndent(i + 1, lineIndent);
        if (nextIndent > lineIndent) {
          emitLine(outputIndent, `${key}: {`);
          i++;
          processSection(nextIndent, outputIndent + 2, key);
          emitLine(outputIndent, "}");
        } else {
          emitLine(outputIndent, content);
          i++;
        }
        continue;
      }

      // ── named sub-block within a section (e.g. skill_name:, advisor_name:, persistent:, ephemeral:) ──
      // These are identifier: followed by an indented block
      if (content.match(/^\w+:\s*$/) && !SECTION_HEADERS.has(content.replace(":", "").trim())) {
        const key = content.replace(":", "").trim();
        const nextIndent = peekNextContentIndent(i + 1, lineIndent);
        if (nextIndent > lineIndent) {
          emitLine(outputIndent, `${key}: {`);
          i++;
          processSection(nextIndent, outputIndent + 2, key);
          emitLine(outputIndent, "}");
        } else {
          // Inline or empty
          emitLine(outputIndent, content);
          i++;
        }
        continue;
      }

      // ── default: just copy the line ───────────────────────────────
      emitLine(outputIndent, content);
      i++;
    }
  }

  /** Process parallel branches (each is name: + indented body) */
  function processParallelBranches(blockIndent: number, outputIndent: number): void {
    while (i < lines.length) {
      if (isBlankOrComment(lines[i])) {
        copyBlanks(outputIndent);
        continue;
      }
      const lineIndent = indentLevel(lines[i]);
      if (lineIndent < blockIndent) break;

      const content = trimmedContent(lines[i]);
      const branchMatch = content.match(BRANCH_RE);
      if (branchMatch) {
        const name = branchMatch[1];
        const nextIndent = peekNextContentIndent(i + 1, lineIndent);
        if (nextIndent > lineIndent) {
          emitLine(outputIndent, `${name}: {`);
          i++;
          processBlock(nextIndent, outputIndent + 2);
          emitLine(outputIndent, "}");
        } else {
          emitLine(outputIndent, content);
          i++;
        }
      } else {
        // Not a branch label — might be a statement after parallel
        break;
      }
    }
  }

  /** Process a section's indented body (key: value lines, or nested blocks) */
  function processSection(blockIndent: number, outputIndent: number, _sectionName: string): void {
    while (i < lines.length) {
      if (isBlankOrComment(lines[i])) {
        copyBlanks(outputIndent);
        continue;
      }
      const lineIndent = indentLevel(lines[i]);
      if (lineIndent < blockIndent) break;

      const content = trimmedContent(lines[i]);

      // Check if this line ends with : and has an indented block below
      if (content.match(/^\w+:\s*$/) && !content.startsWith("on ")) {
        const key = content.replace(":", "").trim();
        const nextIndent = peekNextContentIndent(i + 1, lineIndent);
        if (nextIndent > lineIndent) {
          emitLine(outputIndent, `${key}: {`);
          i++;
          processSection(nextIndent, outputIndent + 2, key);
          emitLine(outputIndent, "}");
          continue;
        }
      }

      // Check for advise-related: output: with indented body
      // (already handled above by the general pattern)

      // Default: emit line as-is
      emitLine(outputIndent, content);
      i++;
    }
  }

  /** Peek at the indentation level of the next non-blank line after position j */
  function peekNextContentIndent(start: number, minIndent: number): number {
    let j = start;
    while (j < lines.length && isBlankOrComment(lines[j])) j++;
    if (j >= lines.length) return 0;
    const indent = indentLevel(lines[j]);
    return indent > minIndent ? indent : 0;
  }

  // Start processing at the top level
  processBlock(0, 0);

  // Clean up trailing whitespace
  let result = out.join("\n");
  // Ensure file ends with single newline
  result = result.replace(/\n+$/, "\n");
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

function collectSpellFiles(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      result.push(...collectSpellFiles(full));
    } else if (entry.endsWith(".spell")) {
      result.push(full);
    }
  }
  return result;
}

const spellsDir = resolve(process.argv[2] || "spells");
const files = collectSpellFiles(spellsDir);

console.log(`Migrating ${files.length} .spell files in ${spellsDir}...`);

for (const file of files) {
  const source = readFileSync(file, "utf-8");
  const migrated = migrateSpell(source);
  writeFileSync(file, migrated, "utf-8");
  console.log(`  ✓ ${file}`);
}

console.log(`Done. ${files.length} files migrated.`);
