/**
 * Indentation-aware tokenizer for Grimoire syntax
 */

import { IndentationError, type SourceLocation, TokenizeError, loc } from "./errors.js";

// =============================================================================
// TOKEN TYPES
// =============================================================================

export type TokenType =
  // Structural
  | "NEWLINE"
  | "INDENT"
  | "DEDENT"
  | "EOF"
  // Literals
  | "NUMBER"
  | "STRING"
  | "BOOLEAN"
  | "ADDRESS"
  | "PERCENTAGE"
  // Identifiers and keywords
  | "IDENTIFIER"
  | "KEYWORD"
  // Special
  | "VENUE_REF" // @name
  | "ADVISORY" // **text**
  // Operators
  | "OPERATOR"
  | "ASSIGN" // =
  | "COLON" // :
  | "COMMA" // ,
  | "DOT" // .
  | "QUESTION" // ?
  // Brackets
  | "LPAREN" // (
  | "RPAREN" // )
  | "LBRACKET" // [
  | "RBRACKET" // ]
  | "LBRACE" // {
  | "RBRACE"; // }

/** Token with location info */
export interface Token {
  type: TokenType;
  value: string;
  location: SourceLocation;
}

/** Keywords in Grimoire syntax */
export const KEYWORDS = new Set([
  "spell",
  "version",
  "description",
  "assets",
  "params",
  "limits",
  "venues",
  "state",
  "skills",
  "advisors",
  "guards",
  "on",
  "if",
  "elif",
  "else",
  "for",
  "in",
  "while",
  "atomic",
  "emit",
  "halt",
  "wait",
  "pass",
  "and",
  "or",
  "not",
  "true",
  "false",
  "max",
  "manual",
  "hourly",
  "daily",
  "persistent",
  "ephemeral",
]);

/** Multi-character operators */
const MULTI_CHAR_OPS = ["==", "!=", "<=", ">=", "**"];

/** Single-character operators */
const SINGLE_CHAR_OPS = new Set(["+", "-", "*", "/", "%", "<", ">"]);

// =============================================================================
// TOKENIZER CLASS
// =============================================================================

export class Tokenizer {
  private readonly source: string;
  private pos = 0;
  private line = 1;
  private column = 1;
  private indentStack: number[] = [0];
  private bracketDepth = 0;
  private tokens: Token[] = [];
  private atLineStart = true;

  constructor(source: string) {
    this.source = source;
  }

  /** Tokenize the entire source */
  tokenize(): Token[] {
    while (this.pos < this.source.length) {
      if (this.atLineStart) {
        this.handleLineStart();
      }
      this.scanToken();
    }

    // Emit final DEDENTs
    while (this.indentStack.length > 1) {
      this.indentStack.pop();
      this.emit("DEDENT", "");
    }

    this.emit("EOF", "");
    return this.tokens;
  }

  /** Get current character */
  private current(): string {
    return this.source[this.pos] ?? "";
  }

  /** Peek at next character */
  private peek(offset = 1): string {
    return this.source[this.pos + offset] ?? "";
  }

  /** Advance position and update line/column tracking */
  private advance(): string {
    const char = this.current();
    this.pos++;
    if (char === "\n") {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return char;
  }

  /** Get current location */
  private location(): SourceLocation {
    return loc(this.line, this.column, this.pos);
  }

  /** Emit a token */
  private emit(type: TokenType, value: string, location?: SourceLocation): void {
    this.tokens.push({
      type,
      value,
      location: location ?? this.location(),
    });
  }

  /** Handle indentation at line start */
  private handleLineStart(): void {
    this.atLineStart = false;

    // Skip blank lines and comment-only lines
    while (this.pos < this.source.length) {
      const _lineStart = this.pos;
      const startLocation = this.location();

      // Count leading whitespace
      let spaces = 0;
      while (this.current() === " ") {
        spaces++;
        this.advance();
      }
      // Tabs are 2 spaces
      while (this.current() === "\t") {
        spaces += 2;
        this.advance();
      }

      // Skip blank line
      if (this.current() === "\n") {
        this.advance();
        continue;
      }

      // Skip comment line
      if (this.current() === "#") {
        this.skipComment();
        if (this.current() === "\n") {
          this.advance();
          continue;
        }
        break;
      }

      // EOF
      if (this.pos >= this.source.length) {
        break;
      }

      // Inside brackets, ignore indentation
      if (this.bracketDepth > 0) {
        break;
      }

      // Compare with current indent level
      const currentIndent = this.indentStack[this.indentStack.length - 1] ?? 0;

      if (spaces > currentIndent) {
        // Deeper indent
        this.indentStack.push(spaces);
        this.emit("INDENT", "", startLocation);
      } else if (spaces < currentIndent) {
        // Dedent - may be multiple levels
        while (this.indentStack.length > 1) {
          const lastIndent = this.indentStack[this.indentStack.length - 1] ?? 0;
          if (spaces >= lastIndent) break;
          this.indentStack.pop();
          this.emit("DEDENT", "", startLocation);
        }

        const finalIndent = this.indentStack[this.indentStack.length - 1] ?? 0;
        // Check for mismatched indent
        if (spaces !== finalIndent) {
          throw new IndentationError(
            `Indentation does not match any outer level (got ${spaces}, expected ${finalIndent})`,
            { location: startLocation, source: this.source }
          );
        }
      }

      break;
    }
  }

  /** Skip a comment (# to end of line) */
  private skipComment(): void {
    while (this.current() !== "\n" && this.pos < this.source.length) {
      this.advance();
    }
  }

  /** Scan a single token */
  private scanToken(): void {
    // Skip whitespace (except newlines)
    while (this.current() === " " || this.current() === "\t") {
      this.advance();
    }

    // EOF
    if (this.pos >= this.source.length) {
      return;
    }

    const startLocation = this.location();
    const char = this.current();

    // Comment
    if (char === "#") {
      this.skipComment();
      return;
    }

    // Newline
    if (char === "\n") {
      if (this.bracketDepth === 0) {
        this.emit("NEWLINE", "\n", startLocation);
      }
      this.advance();
      this.atLineStart = true;
      return;
    }

    // String literal
    if (char === '"' || char === "'") {
      this.scanString(char, startLocation);
      return;
    }

    // Advisory: **text**
    if (char === "*" && this.peek() === "*") {
      this.scanAdvisory(startLocation);
      return;
    }

    // Venue reference: @name
    if (char === "@") {
      this.scanVenueRef(startLocation);
      return;
    }

    // Address (0x...)
    if (char === "0" && this.peek() === "x") {
      this.scanAddress(startLocation);
      return;
    }

    // Number (possibly with %)
    if (/[0-9]/.test(char) || (char === "." && /[0-9]/.test(this.peek()))) {
      this.scanNumber(startLocation);
      return;
    }

    // Multi-character operators
    for (const op of MULTI_CHAR_OPS) {
      if (this.source.slice(this.pos, this.pos + op.length) === op) {
        // Skip ** for advisory (handled above)
        if (op === "**") {
          continue;
        }
        for (let i = 0; i < op.length; i++) this.advance();
        this.emit("OPERATOR", op, startLocation);
        return;
      }
    }

    // Single-character operators
    if (SINGLE_CHAR_OPS.has(char)) {
      this.advance();
      this.emit("OPERATOR", char, startLocation);
      return;
    }

    // Punctuation and brackets
    if (char === "(") {
      this.advance();
      this.bracketDepth++;
      this.emit("LPAREN", "(", startLocation);
      return;
    }
    if (char === ")") {
      this.advance();
      this.bracketDepth = Math.max(0, this.bracketDepth - 1);
      this.emit("RPAREN", ")", startLocation);
      return;
    }
    if (char === "[") {
      this.advance();
      this.bracketDepth++;
      this.emit("LBRACKET", "[", startLocation);
      return;
    }
    if (char === "]") {
      this.advance();
      this.bracketDepth = Math.max(0, this.bracketDepth - 1);
      this.emit("RBRACKET", "]", startLocation);
      return;
    }
    if (char === "{") {
      this.advance();
      this.bracketDepth++;
      this.emit("LBRACE", "{", startLocation);
      return;
    }
    if (char === "}") {
      this.advance();
      this.bracketDepth = Math.max(0, this.bracketDepth - 1);
      this.emit("RBRACE", "}", startLocation);
      return;
    }
    if (char === ":") {
      this.advance();
      this.emit("COLON", ":", startLocation);
      return;
    }
    if (char === ",") {
      this.advance();
      this.emit("COMMA", ",", startLocation);
      return;
    }
    if (char === ".") {
      this.advance();
      this.emit("DOT", ".", startLocation);
      return;
    }
    if (char === "=") {
      this.advance();
      this.emit("ASSIGN", "=", startLocation);
      return;
    }
    if (char === "?") {
      this.advance();
      this.emit("QUESTION", "?", startLocation);
      return;
    }

    // Identifier or keyword
    if (/[a-zA-Z_]/.test(char)) {
      this.scanIdentifier(startLocation);
      return;
    }

    throw new TokenizeError(`Unexpected character '${char}'`, {
      location: startLocation,
      source: this.source,
    });
  }

  /** Scan a string literal */
  private scanString(quote: string, startLocation: SourceLocation): void {
    this.advance(); // opening quote
    let value = "";

    while (this.current() !== quote && this.pos < this.source.length) {
      if (this.current() === "\\" && this.pos + 1 < this.source.length) {
        this.advance(); // backslash
        const escaped = this.current();
        switch (escaped) {
          case "n":
            value += "\n";
            break;
          case "t":
            value += "\t";
            break;
          case "r":
            value += "\r";
            break;
          case "\\":
            value += "\\";
            break;
          case '"':
            value += '"';
            break;
          case "'":
            value += "'";
            break;
          default:
            value += escaped;
        }
        this.advance();
      } else if (this.current() === "\n") {
        throw new TokenizeError("Unterminated string literal", {
          location: startLocation,
          source: this.source,
        });
      } else {
        value += this.advance();
      }
    }

    if (this.current() !== quote) {
      throw new TokenizeError("Unterminated string literal", {
        location: startLocation,
        source: this.source,
      });
    }

    this.advance(); // closing quote
    this.emit("STRING", value, startLocation);
  }

  /** Scan an advisory block: **text** */
  private scanAdvisory(startLocation: SourceLocation): void {
    this.advance(); // first *
    this.advance(); // second *

    let value = "";
    while (this.pos < this.source.length) {
      if (this.current() === "*" && this.peek() === "*") {
        this.advance(); // first *
        this.advance(); // second *
        this.emit("ADVISORY", value.trim(), startLocation);
        return;
      }
      value += this.advance();
    }

    throw new TokenizeError("Unterminated advisory block (missing closing **)", {
      location: startLocation,
      source: this.source,
    });
  }

  /** Scan a venue reference: @name */
  private scanVenueRef(startLocation: SourceLocation): void {
    this.advance(); // @

    let name = "";
    while (/[a-zA-Z0-9_]/.test(this.current())) {
      name += this.advance();
    }

    if (name.length === 0) {
      throw new TokenizeError("Expected venue name after @", {
        location: startLocation,
        source: this.source,
      });
    }

    this.emit("VENUE_REF", name, startLocation);
  }

  /** Scan an address: 0x... */
  private scanAddress(startLocation: SourceLocation): void {
    let value = "0x";
    this.advance(); // 0
    this.advance(); // x

    while (/[0-9a-fA-F]/.test(this.current())) {
      value += this.advance();
    }

    this.emit("ADDRESS", value, startLocation);
  }

  /** Scan a number (possibly with %) */
  private scanNumber(startLocation: SourceLocation): void {
    let value = "";
    let _hasDecimal = false;

    // Integer part
    while (/[0-9]/.test(this.current())) {
      value += this.advance();
    }

    // Decimal part
    if (this.current() === "." && /[0-9]/.test(this.peek())) {
      _hasDecimal = true;
      value += this.advance(); // .
      while (/[0-9]/.test(this.current())) {
        value += this.advance();
      }
    }

    // Check for percentage
    if (this.current() === "%") {
      this.advance();
      const numValue = Number.parseFloat(value) / 100;
      this.emit("PERCENTAGE", numValue.toString(), startLocation);
      return;
    }

    // Check for duration suffix (s, m, h, d)
    if (/[smhd]/.test(this.current()) && !/[a-zA-Z_]/.test(this.peek())) {
      const suffix = this.advance();
      let seconds = Number.parseFloat(value);
      switch (suffix) {
        case "m":
          seconds *= 60;
          break;
        case "h":
          seconds *= 3600;
          break;
        case "d":
          seconds *= 86400;
          break;
      }
      this.emit("NUMBER", seconds.toString(), startLocation);
      return;
    }

    this.emit("NUMBER", value, startLocation);
  }

  /** Scan an identifier or keyword */
  private scanIdentifier(startLocation: SourceLocation): void {
    let value = "";

    while (/[a-zA-Z0-9_]/.test(this.current())) {
      value += this.advance();
    }

    // Check for boolean
    if (value === "true" || value === "false") {
      this.emit("BOOLEAN", value, startLocation);
      return;
    }

    // Check for keyword
    if (KEYWORDS.has(value)) {
      this.emit("KEYWORD", value, startLocation);
      return;
    }

    this.emit("IDENTIFIER", value, startLocation);
  }
}

/**
 * Tokenize source code
 */
export function tokenize(source: string): Token[] {
  const tokenizer = new Tokenizer(source);
  return tokenizer.tokenize();
}
