/**
 * Compiler exports
 */

export { parseExpression, tryParseExpression } from "./expression-parser.js";
export { generateIR, type IRGeneratorResult } from "./ir-generator.js";
export { validateIR, type ValidationResult } from "./validator.js";

// Export new Grimoire syntax compiler
export {
  parse as parseGrimoireAST,
  transform as transformGrimoireAST,
  parseGrimoire,
  compileGrimoire,
  type SpellAST,
  type SectionNode,
  type TriggerHandler,
  type StatementNode,
  type ExpressionNode,
} from "./grimoire/index.js";

import type { CompilationResult, SpellSource } from "../types/ir.js";
import { compileGrimoire, parseGrimoire } from "./grimoire/index.js";

/** Parse result */
export interface ParseResult {
  success: boolean;
  source?: SpellSource;
  errors: Array<{ code: string; message: string; line?: number; column?: number }>;
  warnings: Array<{ code: string; message: string; line?: number; column?: number }>;
}

/**
 * Parse a .spell file from string content
 * Uses the new Grimoire syntax parser
 */
export function parseSpell(content: string): ParseResult {
  try {
    const source = parseGrimoire(content);
    return {
      success: true,
      source,
      errors: [],
      warnings: [],
    };
  } catch (error) {
    const err = error as Error;
    return {
      success: false,
      errors: [
        {
          code: "PARSE_ERROR",
          message: err.message,
        },
      ],
      warnings: [],
    };
  }
}

/**
 * Parse a spell file from a file path
 */
export async function parseSpellFile(filePath: string): Promise<ParseResult> {
  try {
    const content = await Bun.file(filePath).text();
    return parseSpell(content);
  } catch (e) {
    const error = e as Error;
    return {
      success: false,
      errors: [
        {
          code: "FILE_READ_ERROR",
          message: `Failed to read file: ${error.message}`,
        },
      ],
      warnings: [],
    };
  }
}

/**
 * Compile a .spell file from source string
 * This is the main entry point for compilation
 * Uses the new Grimoire syntax
 */
export function compile(source: string): CompilationResult {
  return compileGrimoire(source);
}

/**
 * Compile a .spell file from file path
 */
export async function compileFile(filePath: string): Promise<CompilationResult> {
  try {
    const content = await Bun.file(filePath).text();
    return compile(content);
  } catch (e) {
    const error = e as Error;
    return {
      success: false,
      errors: [
        {
          code: "FILE_READ_ERROR",
          message: `Failed to read file: ${error.message}`,
        },
      ],
      warnings: [],
    };
  }
}
