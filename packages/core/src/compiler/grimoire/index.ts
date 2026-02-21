/**
 * Grimoire syntax compiler
 *
 * This module provides the new Python-like syntax for spell definitions.
 */

export * from "./ast.js";
export * from "./errors.js";
export { Parser, parse } from "./parser.js";
export * from "./tokenizer.js";
export { Transformer, transform } from "./transformer.js";

import type { CompilationResult, SpellSource } from "../../types/ir.js";
import { generateIR } from "../ir-generator.js";
import { typeCheckIR } from "../type-checker.js";
import { validateIR } from "../validator.js";
import { GrimoireError } from "./errors.js";
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

    // Step 3.5: Type check
    const typeCheckResult = typeCheckIR(irResult.ir);

    // Step 4: Validate
    const validationResult = validateIR(irResult.ir);

    // Type errors block compilation
    const allErrors = [...irResult.errors, ...typeCheckResult.errors, ...validationResult.errors];
    const allWarnings = [
      ...irResult.warnings,
      ...typeCheckResult.warnings,
      ...validationResult.warnings,
    ];

    return {
      success: allErrors.length === 0,
      ir: allErrors.length === 0 ? irResult.ir : undefined,
      errors: allErrors,
      warnings: allWarnings,
    };
  } catch (error) {
    const err = error as Error;
    const grimoireError = error instanceof GrimoireError ? error : undefined;
    const code = grimoireError?.code ?? "GRIMOIRE_PARSE_ERROR";
    return {
      success: false,
      errors: [
        {
          code,
          message: err.message,
          line: grimoireError?.location?.line,
          column: grimoireError?.location?.column,
        },
      ],
      warnings: [],
    };
  }
}
