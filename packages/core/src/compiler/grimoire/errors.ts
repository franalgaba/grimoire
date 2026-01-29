/**
 * Error types and formatting for Grimoire parser
 */

/** Source location for error reporting */
export interface SourceLocation {
  line: number;
  column: number;
  offset: number;
}

/** Source span (start to end) */
export interface SourceSpan {
  start: SourceLocation;
  end: SourceLocation;
}

/** Base error class for Grimoire parsing */
export class GrimoireError extends Error {
  readonly code: string;
  readonly location?: SourceLocation;
  readonly span?: SourceSpan;
  readonly source?: string;

  constructor(
    code: string,
    message: string,
    options?: {
      location?: SourceLocation;
      span?: SourceSpan;
      source?: string;
    }
  ) {
    super(message);
    this.name = "GrimoireError";
    this.code = code;
    this.location = options?.location;
    this.span = options?.span;
    this.source = options?.source;
  }

  /** Format error with source context */
  format(): string {
    const lines: string[] = [];

    // Error header
    const loc = this.location;
    if (loc) {
      lines.push(`Error [${this.code}] at line ${loc.line}, column ${loc.column}:`);
    } else {
      lines.push(`Error [${this.code}]:`);
    }

    lines.push(`  ${this.message}`);

    // Source context
    if (this.source && this.location) {
      const sourceLines = this.source.split("\n");
      const lineIdx = this.location.line - 1;

      if (lineIdx >= 0 && lineIdx < sourceLines.length) {
        lines.push("");
        lines.push(`  ${this.location.line} | ${sourceLines[lineIdx]}`);

        // Pointer to error location
        const padding = " ".repeat(String(this.location.line).length + 3);
        const pointer = `${" ".repeat(this.location.column - 1)}^`;
        lines.push(`  ${padding}${pointer}`);
      }
    }

    return lines.join("\n");
  }
}

/** Tokenization error */
export class TokenizeError extends GrimoireError {
  constructor(
    message: string,
    options?: {
      location?: SourceLocation;
      source?: string;
    }
  ) {
    super("TOKENIZE_ERROR", message, options);
    this.name = "TokenizeError";
  }
}

/** Parse error */
export class ParseError extends GrimoireError {
  constructor(
    message: string,
    options?: {
      location?: SourceLocation;
      span?: SourceSpan;
      source?: string;
    }
  ) {
    super("PARSE_ERROR", message, options);
    this.name = "ParseError";
  }
}

/** Indentation error */
export class IndentationError extends GrimoireError {
  constructor(
    message: string,
    options?: {
      location?: SourceLocation;
      source?: string;
    }
  ) {
    super("INDENTATION_ERROR", message, options);
    this.name = "IndentationError";
  }
}

/** Transform error (AST to SpellSource) */
export class TransformError extends GrimoireError {
  constructor(
    message: string,
    options?: {
      location?: SourceLocation;
      span?: SourceSpan;
      source?: string;
    }
  ) {
    super("TRANSFORM_ERROR", message, options);
    this.name = "TransformError";
  }
}

/** Create a source location from line, column, offset */
export function loc(line: number, column: number, offset: number): SourceLocation {
  return { line, column, offset };
}

/** Create a source span from start and end locations */
export function span(start: SourceLocation, end: SourceLocation): SourceSpan {
  return { start, end };
}

/** Format multiple errors */
export function formatErrors(errors: GrimoireError[]): string {
  return errors.map((e) => e.format()).join("\n\n");
}
