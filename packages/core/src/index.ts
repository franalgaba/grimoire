/**
 * @grimoire/core
 * Core compiler and runtime for Grimoire spell execution
 */

// Types
export * from "./types/index.js";

// Compiler
export { compile, compileFile, parseSpell, parseExpression, validateIR } from "./compiler/index.js";
export type { ParseResult, IRGeneratorResult, ValidationResult } from "./compiler/index.js";

// Runtime
export {
  execute,
  createContext,
  InMemoryLedger,
  evaluate,
  evaluateAsync,
} from "./runtime/index.js";
export type {
  ExecuteOptions,
  CreateContextOptions,
  EvalContext,
  EvalValue,
} from "./runtime/index.js";
