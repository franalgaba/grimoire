/**
 * Grimoire syntax compiler
 *
 * This module provides the new Python-like syntax for spell definitions.
 */

export * from "./errors.js";
export * from "./tokenizer.js";
export * from "./ast.js";
export { Parser, parse } from "./parser.js";
export { Transformer, transform } from "./transformer.js";

import type { CompilationResult, SpellSource } from "../../types/ir.js";
import { generateIR } from "../ir-generator.js";
import { validateIR } from "../validator.js";
import { parse } from "./parser.js";
import { transform } from "./transformer.js";

/**
 * Parse Grimoire source to SpellSource
 */
export function parseGrimoire(source: string, options?: { filePath?: string }): SpellSource {
  const ast = parse(source);
  return transform(ast, options);
}

/**
 * Compile Grimoire source to IR
 */
export function compileGrimoire(
  source: string,
  options?: { filePath?: string }
): CompilationResult {
  try {
    // Step 1: Parse to AST
    const ast = parse(source);

    // Step 2: Transform to SpellSource
    const spellSource = transform(ast, options);

    // Step 3: Generate IR
    const irResult = generateIR(spellSource);
    if (!irResult.success || !irResult.ir) {
      return {
        success: false,
        errors: irResult.errors,
        warnings: irResult.warnings,
      };
    }

    // Step 4: Validate
    const validationResult = validateIR(irResult.ir);

    return {
      success: validationResult.valid,
      ir: validationResult.valid ? irResult.ir : undefined,
      errors: [...irResult.errors, ...validationResult.errors],
      warnings: [...irResult.warnings, ...validationResult.warnings],
    };
  } catch (error) {
    const err = error as Error;
    return {
      success: false,
      errors: [
        {
          code: "GRIMOIRE_PARSE_ERROR",
          message: err.message,
        },
      ],
      warnings: [],
    };
  }
}
