/**
 * Expression parser
 * Converts string expressions to Expression IR nodes
 */

import type { BinaryOp, BuiltinFn, Expression, UnaryOp } from "../types/expressions.js";

/** Token types */
type TokenType =
  | "NUMBER"
  | "STRING"
  | "BOOLEAN"
  | "ADDRESS"
  | "IDENTIFIER"
  | "OPERATOR"
  | "LPAREN"
  | "RPAREN"
  | "LBRACKET"
  | "RBRACKET"
  | "DOT"
  | "COMMA"
  | "QUESTION"
  | "COLON"
  | "EOF";

interface Token {
  type: TokenType;
  value: string;
  position: number;
}

const _BINARY_OPS: BinaryOp[] = [
  "+",
  "-",
  "*",
  "/",
  "%",
  "==",
  "!=",
  "<",
  ">",
  "<=",
  ">=",
  "AND",
  "OR",
];
const _UNARY_OPS: UnaryOp[] = ["NOT", "-", "ABS"];
const BUILTIN_FNS: BuiltinFn[] = [
  "balance",
  "price",
  "get_apy",
  "get_health_factor",
  "get_position",
  "get_debt",
  "min",
  "max",
  "abs",
  "sum",
  "avg",
];

/**
 * Tokenize an expression string
 */
function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;

  while (pos < input.length) {
    // Skip whitespace
    if (/\s/.test(input[pos] ?? "")) {
      pos++;
      continue;
    }

    const start = pos;

    // String literal
    if (input[pos] === '"') {
      pos++;
      let value = "";
      while (pos < input.length && input[pos] !== '"') {
        if (input[pos] === "\\" && pos + 1 < input.length) {
          pos++;
          value += input[pos];
        } else {
          value += input[pos];
        }
        pos++;
      }
      pos++; // Skip closing quote
      tokens.push({ type: "STRING", value, position: start });
      continue;
    }

    // Address (0x...)
    if (input.slice(pos, pos + 2) === "0x") {
      let value = "0x";
      pos += 2;
      while (pos < input.length && /[0-9a-fA-F]/.test(input[pos] ?? "")) {
        value += input[pos];
        pos++;
      }
      tokens.push({ type: "ADDRESS", value, position: start });
      continue;
    }

    // Number
    if (/[0-9]/.test(input[pos] ?? "")) {
      let value = "";
      while (pos < input.length && /[0-9.]/.test(input[pos] ?? "")) {
        value += input[pos];
        pos++;
      }
      tokens.push({ type: "NUMBER", value, position: start });
      continue;
    }

    // Multi-character operators
    if (input.slice(pos, pos + 2) === "==") {
      tokens.push({ type: "OPERATOR", value: "==", position: start });
      pos += 2;
      continue;
    }
    if (input.slice(pos, pos + 2) === "!=") {
      tokens.push({ type: "OPERATOR", value: "!=", position: start });
      pos += 2;
      continue;
    }
    if (input.slice(pos, pos + 2) === "<=") {
      tokens.push({ type: "OPERATOR", value: "<=", position: start });
      pos += 2;
      continue;
    }
    if (input.slice(pos, pos + 2) === ">=") {
      tokens.push({ type: "OPERATOR", value: ">=", position: start });
      pos += 2;
      continue;
    }

    // Single character operators and punctuation
    const char = input[pos] ?? "";
    if ("+-*/%<>".includes(char)) {
      tokens.push({ type: "OPERATOR", value: char, position: start });
      pos++;
      continue;
    }
    if (char === "(") {
      tokens.push({ type: "LPAREN", value: "(", position: start });
      pos++;
      continue;
    }
    if (char === ")") {
      tokens.push({ type: "RPAREN", value: ")", position: start });
      pos++;
      continue;
    }
    if (char === "[") {
      tokens.push({ type: "LBRACKET", value: "[", position: start });
      pos++;
      continue;
    }
    if (char === "]") {
      tokens.push({ type: "RBRACKET", value: "]", position: start });
      pos++;
      continue;
    }
    if (char === ".") {
      tokens.push({ type: "DOT", value: ".", position: start });
      pos++;
      continue;
    }
    if (char === ",") {
      tokens.push({ type: "COMMA", value: ",", position: start });
      pos++;
      continue;
    }
    if (char === "?") {
      tokens.push({ type: "QUESTION", value: "?", position: start });
      pos++;
      continue;
    }
    if (char === ":") {
      tokens.push({ type: "COLON", value: ":", position: start });
      pos++;
      continue;
    }

    // Identifier or keyword
    if (/[a-zA-Z_]/.test(char)) {
      let value = "";
      while (pos < input.length && /[a-zA-Z0-9_]/.test(input[pos] ?? "")) {
        value += input[pos];
        pos++;
      }

      // Check for boolean
      if (value === "true" || value === "false") {
        tokens.push({ type: "BOOLEAN", value, position: start });
        continue;
      }

      // Check for operators
      if (value === "AND" || value === "OR" || value === "NOT") {
        tokens.push({ type: "OPERATOR", value, position: start });
        continue;
      }

      tokens.push({ type: "IDENTIFIER", value, position: start });
      continue;
    }

    throw new Error(`Unexpected character '${char}' at position ${pos}`);
  }

  tokens.push({ type: "EOF", value: "", position: pos });
  return tokens;
}

/**
 * Parser class for expressions
 */
class ExpressionParser {
  private tokens: Token[];
  private pos: number;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.pos = 0;
  }

  private current(): Token {
    const token = this.tokens[this.pos];
    if (!token) {
      throw new Error("Unexpected end of expression tokens");
    }
    return token;
  }

  private advance(): Token {
    const token = this.current();
    this.pos++;
    return token;
  }

  private expect(type: TokenType): Token {
    const token = this.current();
    if (token.type !== type) {
      throw new Error(`Expected ${type} but got ${token.type} at position ${token.position}`);
    }
    return this.advance();
  }

  /**
   * Parse full expression
   */
  parse(): Expression {
    const expr = this.parseTernary();
    if (this.current().type !== "EOF") {
      throw new Error(
        `Unexpected token ${this.current().value} at position ${this.current().position}`
      );
    }
    return expr;
  }

  /**
   * Parse ternary expression: condition ? then : else
   */
  private parseTernary(): Expression {
    const condition = this.parseOr();

    if (this.current().type === "QUESTION") {
      this.advance(); // ?
      const thenExpr = this.parseTernary();
      this.expect("COLON");
      const elseExpr = this.parseTernary();
      return {
        kind: "ternary",
        condition,
        then: thenExpr,
        else: elseExpr,
      };
    }

    return condition;
  }

  /**
   * Parse OR expression
   */
  private parseOr(): Expression {
    let left = this.parseAnd();

    while (this.current().type === "OPERATOR" && this.current().value === "OR") {
      this.advance();
      const right = this.parseAnd();
      left = { kind: "binary", op: "OR", left, right };
    }

    return left;
  }

  /**
   * Parse AND expression
   */
  private parseAnd(): Expression {
    let left = this.parseEquality();

    while (this.current().type === "OPERATOR" && this.current().value === "AND") {
      this.advance();
      const right = this.parseEquality();
      left = { kind: "binary", op: "AND", left, right };
    }

    return left;
  }

  /**
   * Parse equality: == !=
   */
  private parseEquality(): Expression {
    let left = this.parseComparison();

    while (
      this.current().type === "OPERATOR" &&
      (this.current().value === "==" || this.current().value === "!=")
    ) {
      const op = this.advance().value as BinaryOp;
      const right = this.parseComparison();
      left = { kind: "binary", op, left, right };
    }

    return left;
  }

  /**
   * Parse comparison: < > <= >=
   */
  private parseComparison(): Expression {
    let left = this.parseAdditive();

    while (
      this.current().type === "OPERATOR" &&
      ["<", ">", "<=", ">="].includes(this.current().value)
    ) {
      const op = this.advance().value as BinaryOp;
      const right = this.parseAdditive();
      left = { kind: "binary", op, left, right };
    }

    return left;
  }

  /**
   * Parse additive: + -
   */
  private parseAdditive(): Expression {
    let left = this.parseMultiplicative();

    while (
      this.current().type === "OPERATOR" &&
      (this.current().value === "+" || this.current().value === "-")
    ) {
      const op = this.advance().value as BinaryOp;
      const right = this.parseMultiplicative();
      left = { kind: "binary", op, left, right };
    }

    return left;
  }

  /**
   * Parse multiplicative: * / %
   */
  private parseMultiplicative(): Expression {
    let left = this.parseUnary();

    while (this.current().type === "OPERATOR" && ["*", "/", "%"].includes(this.current().value)) {
      const op = this.advance().value as BinaryOp;
      const right = this.parseUnary();
      left = { kind: "binary", op, left, right };
    }

    return left;
  }

  /**
   * Parse unary: NOT -
   */
  private parseUnary(): Expression {
    if (this.current().type === "OPERATOR") {
      if (this.current().value === "NOT") {
        this.advance();
        const arg = this.parseUnary();
        return { kind: "unary", op: "NOT", arg };
      }
      if (this.current().value === "-") {
        this.advance();
        const arg = this.parseUnary();
        return { kind: "unary", op: "-", arg };
      }
    }

    return this.parsePostfix();
  }

  /**
   * Parse postfix: . [] ()
   */
  private parsePostfix(): Expression {
    let expr = this.parsePrimary();

    while (true) {
      if (this.current().type === "DOT") {
        this.advance();
        const prop = this.expect("IDENTIFIER").value;
        expr = { kind: "property_access", object: expr, property: prop };
      } else if (this.current().type === "LBRACKET") {
        this.advance();
        const index = this.parseTernary();
        this.expect("RBRACKET");
        expr = { kind: "array_access", array: expr, index };
      } else {
        break;
      }
    }

    return expr;
  }

  /**
   * Parse primary: literals, identifiers, function calls, parenthesized
   */
  private parsePrimary(): Expression {
    const token = this.current();

    // Number
    if (token.type === "NUMBER") {
      this.advance();
      const value = token.value.includes(".")
        ? Number.parseFloat(token.value)
        : Number.parseInt(token.value, 10);
      return {
        kind: "literal",
        value,
        type: token.value.includes(".") ? "float" : "int",
      };
    }

    // String
    if (token.type === "STRING") {
      this.advance();
      return { kind: "literal", value: token.value, type: "string" };
    }

    // Boolean
    if (token.type === "BOOLEAN") {
      this.advance();
      return { kind: "literal", value: token.value === "true", type: "bool" };
    }

    // Address
    if (token.type === "ADDRESS") {
      this.advance();
      return { kind: "literal", value: token.value, type: "address" };
    }

    // Parenthesized expression
    if (token.type === "LPAREN") {
      this.advance();
      const expr = this.parseTernary();
      this.expect("RPAREN");
      return expr;
    }

    // Identifier or function call
    if (token.type === "IDENTIFIER") {
      const name = this.advance().value;

      // Function call
      if (this.current().type === "LPAREN") {
        this.advance();
        const args: Expression[] = [];

        if (this.current().type !== "RPAREN") {
          args.push(this.parseTernary());
          while (this.current().type === "COMMA") {
            this.advance();
            args.push(this.parseTernary());
          }
        }

        this.expect("RPAREN");

        // Check if it's a builtin
        if (BUILTIN_FNS.includes(name as BuiltinFn)) {
          return { kind: "call", fn: name as BuiltinFn, args };
        }

        throw new Error(`Unknown function '${name}'`);
      }

      // Special identifiers
      if (name === "params") {
        this.expect("DOT");
        const paramName = this.expect("IDENTIFIER").value;
        return { kind: "param", name: paramName };
      }

      if (name === "state") {
        this.expect("DOT");
        const scope = this.expect("IDENTIFIER").value;
        if (scope !== "persistent" && scope !== "ephemeral") {
          throw new Error(`Invalid state scope '${scope}'`);
        }
        this.expect("DOT");
        const key = this.expect("IDENTIFIER").value;
        return { kind: "state", scope, key };
      }

      if (name === "item") {
        return { kind: "item" };
      }

      if (name === "index") {
        return { kind: "index" };
      }

      // Regular binding reference
      return { kind: "binding", name };
    }

    throw new Error(`Unexpected token '${token.value}' at position ${token.position}`);
  }
}

/**
 * Parse an expression string into an Expression AST
 */
export function parseExpression(input: string): Expression {
  const tokens = tokenize(input);
  const parser = new ExpressionParser(tokens);
  return parser.parse();
}

/**
 * Try to parse an expression, returning null on failure
 */
export function tryParseExpression(input: string): Expression | null {
  try {
    return parseExpression(input);
  } catch {
    return null;
  }
}
