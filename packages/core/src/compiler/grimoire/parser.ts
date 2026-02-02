/**
 * Recursive descent parser for Grimoire syntax
 */

import type {
  AdvisorsSection,
  AdvisoryExpr,
  ArrayAccessNode,
  ArrayLiteralNode,
  AssetItem,
  AssetsSection,
  AssignmentNode,
  AtomicNode,
  BinaryExprNode,
  BinaryOperator,
  CallExprNode,
  ConstraintClause,
  DescriptionSection,
  EmitNode,
  ExpressionNode,
  ForNode,
  GuardItem,
  GuardsSection,
  HaltNode,
  IdentifierNode,
  IfNode,
  LimitItem,
  LimitsSection,
  LiteralNode,
  MethodCallNode,
  ObjectLiteralNode,
  ParamItem,
  ParamsSection,
  PassNode,
  PercentageExpr,
  PropertyAccessNode,
  SectionNode,
  SkillsSection,
  SpellAST,
  StateItem,
  StateSection,
  StatementNode,
  TriggerHandler,
  TriggerType,
  UnaryExprNode,
  VenueGroup,
  VenueRef,
  VenueRefExpr,
  VenuesSection,
  VersionSection,
  WaitNode,
} from "./ast.js";
import { ParseError, type SourceSpan } from "./errors.js";
import { type Token, type TokenType, tokenize } from "./tokenizer.js";

// =============================================================================
// PARSER CLASS
// =============================================================================

export class Parser {
  private readonly tokens: Token[];
  private readonly source: string;
  private pos = 0;

  constructor(tokens: Token[], source: string) {
    this.tokens = tokens;
    this.source = source;
  }

  // ===========================================================================
  // UTILITIES
  // ===========================================================================

  /** Get current token */
  private current(): Token {
    return (
      this.tokens[this.pos] ?? {
        type: "EOF",
        value: "",
        location: { line: 0, column: 0, offset: 0 },
      }
    );
  }

  /** Peek at token at offset */
  private peek(offset = 1): Token {
    return (
      this.tokens[this.pos + offset] ?? {
        type: "EOF",
        value: "",
        location: { line: 0, column: 0, offset: 0 },
      }
    );
  }

  /** Check if current token matches */
  private check(type: TokenType, value?: string): boolean {
    const token = this.current();
    if (token.type !== type) return false;
    if (value !== undefined && token.value !== value) return false;
    return true;
  }

  /** Advance and return previous token */
  private advance(): Token {
    const token = this.current();
    if (token.type !== "EOF") {
      this.pos++;
    }
    return token;
  }

  /** Expect and consume a specific token */
  private expect(type: TokenType, value?: string): Token {
    const token = this.current();
    if (token.type !== type) {
      throw new ParseError(
        `Expected ${type}${value ? ` '${value}'` : ""} but got ${token.type} '${token.value}'`,
        { location: token.location, source: this.source }
      );
    }
    if (value !== undefined && token.value !== value) {
      throw new ParseError(`Expected '${value}' but got '${token.value}'`, {
        location: token.location,
        source: this.source,
      });
    }
    return this.advance();
  }

  /** Skip newlines */
  private skipNewlines(): void {
    while (this.check("NEWLINE")) {
      this.advance();
    }
  }

  /** Consume a newline (required) */
  private expectNewline(): void {
    if (!this.check("NEWLINE") && !this.check("EOF")) {
      throw new ParseError(
        `Expected newline but got ${this.current().type} '${this.current().value}'`,
        { location: this.current().location, source: this.source }
      );
    }
    if (this.check("NEWLINE")) {
      this.advance();
    }
  }

  /** Create a source span from a start location to the current token's location */
  private makeSpan(startToken: Token): SourceSpan {
    const end = this.current().location;
    return { start: startToken.location, end };
  }

  // ===========================================================================
  // TOP-LEVEL PARSING
  // ===========================================================================

  /** Parse a complete spell file */
  parseSpellFile(): SpellAST {
    this.skipNewlines();

    // Expect: spell Name
    this.expect("KEYWORD", "spell");
    const nameToken = this.expect("IDENTIFIER");
    const name = nameToken.value;

    this.expectNewline();
    this.skipNewlines();

    // Parse sections and triggers
    const sections: SectionNode[] = [];
    const triggers: TriggerHandler[] = [];

    // Expect INDENT for spell body
    if (!this.check("INDENT")) {
      throw new ParseError("Expected indented spell body", {
        location: this.current().location,
        source: this.source,
      });
    }
    this.advance(); // INDENT

    while (!this.check("DEDENT") && !this.check("EOF")) {
      this.skipNewlines();
      if (this.check("DEDENT") || this.check("EOF")) break;

      // Check for trigger: on <trigger>:
      if (this.check("KEYWORD", "on")) {
        triggers.push(this.parseTriggerHandler());
      } else {
        sections.push(this.parseSection());
      }

      this.skipNewlines();
    }

    // Consume DEDENT
    if (this.check("DEDENT")) {
      this.advance();
    }

    return {
      kind: "spell",
      name,
      sections,
      triggers,
    };
  }

  // ===========================================================================
  // SECTION PARSING
  // ===========================================================================

  /** Parse a section (version, assets, params, etc.) */
  private parseSection(): SectionNode {
    const token = this.current();

    if (token.type === "KEYWORD") {
      switch (token.value) {
        case "version":
          return this.parseVersionSection();
        case "description":
          return this.parseDescriptionSection();
        case "assets":
          return this.parseAssetsSection();
        case "params":
          return this.parseParamsSection();
        case "limits":
          return this.parseLimitsSection();
        case "venues":
          return this.parseVenuesSection();
        case "state":
          return this.parseStateSection();
        case "skills":
          return this.parseSkillsSection();
        case "advisors":
          return this.parseAdvisorsSection();
        case "guards":
          return this.parseGuardsSection();
      }
    }

    // Could be a simple key: value
    if (token.type === "IDENTIFIER") {
      const key = token.value;
      this.advance();
      this.expect("COLON");

      // Handle known identifiers as sections
      if (key === "version") {
        const value = this.parseSimpleValue();
        this.expectNewline();
        return { kind: "version", value: String(value) } as VersionSection;
      }
    }

    throw new ParseError(`Unexpected token in section: ${token.type} '${token.value}'`, {
      location: token.location,
      source: this.source,
    });
  }

  /** Parse version: "1.0.0" */
  private parseVersionSection(): VersionSection {
    this.expect("KEYWORD", "version");
    this.expect("COLON");
    const value = this.parseSimpleValue();
    this.expectNewline();
    return { kind: "version", value: String(value) };
  }

  /** Parse description: "..." */
  private parseDescriptionSection(): DescriptionSection {
    this.expect("KEYWORD", "description");
    this.expect("COLON");
    const value = this.parseSimpleValue();
    this.expectNewline();
    return { kind: "description", value: String(value) };
  }

  /** Parse simple value (string, number, boolean) */
  private parseSimpleValue(): string | number | boolean {
    const token = this.current();
    if (token.type === "STRING") {
      this.advance();
      return token.value;
    }
    if (token.type === "NUMBER") {
      this.advance();
      return Number.parseFloat(token.value);
    }
    if (token.type === "BOOLEAN") {
      this.advance();
      return token.value === "true";
    }
    throw new ParseError(`Expected value but got ${token.type}`, {
      location: token.location,
      source: this.source,
    });
  }

  /** Parse assets: [USDC, USDT] or assets block */
  private parseAssetsSection(): AssetsSection {
    this.expect("KEYWORD", "assets");
    this.expect("COLON");

    const items: AssetItem[] = [];

    // Inline array: [USDC, USDT, DAI]
    if (this.check("LBRACKET")) {
      this.advance();
      while (!this.check("RBRACKET")) {
        const symbol = this.expect("IDENTIFIER").value;
        items.push({ symbol });
        if (this.check("COMMA")) {
          this.advance();
        }
      }
      this.expect("RBRACKET");
      this.expectNewline();
    } else {
      // Block form (not currently supported in the new syntax, but could be added)
      this.expectNewline();
    }

    return { kind: "assets", items };
  }

  /** Parse params section */
  private parseParamsSection(): ParamsSection {
    this.expect("KEYWORD", "params");
    this.expect("COLON");
    this.expectNewline();

    const items: ParamItem[] = [];

    if (this.check("INDENT")) {
      this.advance();
      while (!this.check("DEDENT") && !this.check("EOF")) {
        this.skipNewlines();
        if (this.check("DEDENT")) break;

        const name = this.expect("IDENTIFIER").value;
        this.expect("COLON");
        const value = this.parseExpression();
        items.push({ name, value });
        this.expectNewline();
        this.skipNewlines();
      }
      if (this.check("DEDENT")) this.advance();
    }

    return { kind: "params", items };
  }

  /** Parse limits section */
  private parseLimitsSection(): LimitsSection {
    this.expect("KEYWORD", "limits");
    this.expect("COLON");
    this.expectNewline();

    const items: LimitItem[] = [];

    if (this.check("INDENT")) {
      this.advance();
      while (!this.check("DEDENT") && !this.check("EOF")) {
        this.skipNewlines();
        if (this.check("DEDENT")) break;

        const name = this.expect("IDENTIFIER").value;
        this.expect("COLON");
        const value = this.parseExpression();
        items.push({ name, value });
        this.expectNewline();
        this.skipNewlines();
      }
      if (this.check("DEDENT")) this.advance();
    }

    return { kind: "limits", items };
  }

  /** Parse venues section */
  private parseVenuesSection(): VenuesSection {
    this.expect("KEYWORD", "venues");
    this.expect("COLON");
    this.expectNewline();

    const groups: VenueGroup[] = [];

    if (this.check("INDENT")) {
      this.advance();
      while (!this.check("DEDENT") && !this.check("EOF")) {
        this.skipNewlines();
        if (this.check("DEDENT")) break;

        const name = this.expect("IDENTIFIER").value;
        this.expect("COLON");

        const venues: VenueRef[] = [];

        // Single venue: swap: @uniswap_v3
        if (this.check("VENUE_REF")) {
          const venueToken = this.advance();
          venues.push({ kind: "venue_ref", name: venueToken.value });
        }
        // Array of venues: lending: [@aave_v3, @morpho]
        else if (this.check("LBRACKET")) {
          this.advance();
          while (!this.check("RBRACKET")) {
            if (this.check("VENUE_REF")) {
              const venueToken = this.advance();
              venues.push({ kind: "venue_ref", name: venueToken.value });
            }
            if (this.check("COMMA")) {
              this.advance();
            }
          }
          this.expect("RBRACKET");
        }

        groups.push({ name, venues });
        this.expectNewline();
        this.skipNewlines();
      }
      if (this.check("DEDENT")) this.advance();
    }

    return { kind: "venues", groups };
  }

  /** Parse state section */
  private parseStateSection(): StateSection {
    this.expect("KEYWORD", "state");
    this.expect("COLON");
    this.expectNewline();

    const persistent: StateItem[] = [];
    const ephemeral: StateItem[] = [];

    if (this.check("INDENT")) {
      this.advance();
      while (!this.check("DEDENT") && !this.check("EOF")) {
        this.skipNewlines();
        if (this.check("DEDENT")) break;

        const scope = this.expect("KEYWORD").value;
        this.expect("COLON");
        this.expectNewline();

        const items = scope === "persistent" ? persistent : ephemeral;

        if (this.check("INDENT")) {
          this.advance();
          while (!this.check("DEDENT") && !this.check("EOF")) {
            this.skipNewlines();
            if (this.check("DEDENT")) break;

            const name = this.expect("IDENTIFIER").value;
            this.expect("COLON");
            const initialValue = this.parseExpression();
            items.push({ name, initialValue });
            this.expectNewline();
            this.skipNewlines();
          }
          if (this.check("DEDENT")) this.advance();
        }

        this.skipNewlines();
      }
      if (this.check("DEDENT")) this.advance();
    }

    return { kind: "state", persistent, ephemeral };
  }

  /** Parse skills section */
  private parseSkillsSection(): SkillsSection {
    this.expect("KEYWORD", "skills");
    this.expect("COLON");
    this.expectNewline();
    // Simplified - not commonly used in new syntax
    return { kind: "skills", items: [] };
  }

  /** Parse advisors section */
  private parseAdvisorsSection(): AdvisorsSection {
    this.expect("KEYWORD", "advisors");
    this.expect("COLON");
    this.expectNewline();
    // Simplified - advisors are typically inline in new syntax
    return { kind: "advisors", items: [] };
  }

  /** Parse guards section: guards:\n    id: expression */
  private parseGuardsSection(): GuardsSection {
    const startToken = this.current();
    this.expect("KEYWORD", "guards");
    this.expect("COLON");
    this.expectNewline();

    const items: GuardItem[] = [];

    if (this.check("INDENT")) {
      this.advance(); // consume INDENT

      while (!this.check("DEDENT") && !this.check("EOF")) {
        this.skipNewlines();
        if (this.check("DEDENT") || this.check("EOF")) break;

        // Each line: id: expression
        const id = this.current().value;
        if (this.check("IDENTIFIER") || this.check("KEYWORD")) {
          this.advance();
        } else {
          throw new ParseError(
            `Expected guard identifier but got ${this.current().type} '${this.current().value}'`,
            { location: this.current().location, source: this.source }
          );
        }
        this.expect("COLON");
        const check = this.parseExpression();
        this.expectNewline();

        items.push({
          id,
          check,
          severity: "halt", // default
        } as GuardItem);

        this.skipNewlines();
      }

      if (this.check("DEDENT")) this.advance();
    }

    const node: GuardsSection = { kind: "guards", items };
    node.span = this.makeSpan(startToken);
    return node;
  }

  // ===========================================================================
  // TRIGGER PARSING
  // ===========================================================================

  /** Parse trigger handler: on manual: ... */
  private parseTriggerHandler(): TriggerHandler {
    this.expect("KEYWORD", "on");

    const triggerType = this.parseTriggerType();
    this.expect("COLON");
    this.expectNewline();

    const body = this.parseStatementBlock();

    return {
      kind: "trigger_handler",
      trigger: triggerType,
      body,
    };
  }

  /** Parse trigger type */
  private parseTriggerType(): TriggerType {
    const token = this.current();

    if (token.type === "KEYWORD" || token.type === "IDENTIFIER") {
      switch (token.value) {
        case "manual":
          this.advance();
          return { kind: "manual" };
        case "hourly":
          this.advance();
          return { kind: "hourly" };
        case "daily":
          this.advance();
          return { kind: "daily" };
      }
    }

    // Could be a cron expression or condition
    if (token.type === "STRING") {
      const cron = token.value;
      this.advance();
      return { kind: "schedule", cron };
    }

    throw new ParseError(`Expected trigger type but got ${token.type} '${token.value}'`, {
      location: token.location,
      source: this.source,
    });
  }

  // ===========================================================================
  // STATEMENT PARSING
  // ===========================================================================

  /** Parse an indented block of statements */
  private parseStatementBlock(): StatementNode[] {
    const statements: StatementNode[] = [];

    if (!this.check("INDENT")) {
      return statements;
    }
    this.advance(); // INDENT

    while (!this.check("DEDENT") && !this.check("EOF")) {
      this.skipNewlines();
      if (this.check("DEDENT") || this.check("EOF")) break;

      statements.push(this.parseStatement());
      this.skipNewlines();
    }

    if (this.check("DEDENT")) {
      this.advance();
    }

    return statements;
  }

  /** Parse a single statement */
  private parseStatement(): StatementNode {
    const token = this.current();

    // Keywords
    if (token.type === "KEYWORD") {
      switch (token.value) {
        case "if":
          return this.parseIfStatement();
        case "for":
          return this.parseForStatement();
        case "atomic":
          return this.parseAtomicStatement();
        case "emit":
          return this.parseEmitStatement();
        case "halt":
          return this.parseHaltStatement();
        case "wait":
          return this.parseWaitStatement();
        case "pass": {
          const startToken = this.current();
          this.advance();
          this.expectNewline();
          const node: PassNode = { kind: "pass" };
          node.span = this.makeSpan(startToken);
          return node;
        }
      }
    }

    // Assignment or expression statement
    // Check for: identifier = ...
    if (token.type === "IDENTIFIER") {
      // Look ahead for assignment
      if (this.peek().type === "ASSIGN") {
        return this.parseAssignment();
      }
    }

    // Expression statement (method call, etc.)
    const startToken = this.current();
    const expr = this.parseExpression();

    // If it's a method call, convert to statement
    if (expr.kind === "call") {
      const callExpr = expr as CallExprNode;
      if (callExpr.callee.kind === "property_access") {
        const prop = callExpr.callee as PropertyAccessNode;
        const node: MethodCallNode = {
          kind: "method_call",
          object: prop.object,
          method: prop.property,
          args: callExpr.args,
        };

        // Check for constraint clause: ... with key=value
        if (this.check("KEYWORD") && this.current().value === "with") {
          node.constraints = this.parseConstraintClause();
        }

        this.expectNewline();
        node.span = this.makeSpan(startToken);
        return node;
      }
    }

    this.expectNewline();

    // Treat as assignment with expression
    throw new ParseError("Unexpected expression statement", {
      location: token.location,
      source: this.source,
    });
  }

  /** Parse assignment: x = expr [with key=value, ...] */
  private parseAssignment(): AssignmentNode {
    const startToken = this.current();
    const target = this.expect("IDENTIFIER").value;
    this.expect("ASSIGN");
    const value = this.parseExpression();

    let constraints: ConstraintClause | undefined;
    if (this.check("KEYWORD") && this.current().value === "with") {
      constraints = this.parseConstraintClause();
    }

    this.expectNewline();
    const node: AssignmentNode = { kind: "assignment", target, value, constraints };
    node.span = this.makeSpan(startToken);
    return node;
  }

  /** Parse if statement */
  private parseIfStatement(): IfNode {
    const startToken = this.current();
    this.expect("KEYWORD", "if");

    // Check for advisory condition: if **prompt**:
    let condition: ExpressionNode;
    if (this.check("ADVISORY")) {
      const prompt = this.advance().value;
      condition = { kind: "advisory_expr", prompt } as AdvisoryExpr;
    } else {
      condition = this.parseExpression();
    }

    this.expect("COLON");
    this.expectNewline();

    const thenBody = this.parseStatementBlock();
    const elifs: Array<{ condition: ExpressionNode; body: StatementNode[] }> = [];
    let elseBody: StatementNode[] = [];

    // Check for elif
    while (this.check("KEYWORD", "elif")) {
      this.advance();
      const elifCondition = this.parseExpression();
      this.expect("COLON");
      this.expectNewline();
      const elifBody = this.parseStatementBlock();
      elifs.push({ condition: elifCondition, body: elifBody });
    }

    // Check for else
    if (this.check("KEYWORD", "else")) {
      this.advance();
      this.expect("COLON");
      this.expectNewline();
      elseBody = this.parseStatementBlock();
    }

    const node: IfNode = { kind: "if", condition, thenBody, elifs, elseBody };
    node.span = this.makeSpan(startToken);
    return node;
  }

  /** Parse for loop */
  private parseForStatement(): ForNode {
    const startToken = this.current();
    this.expect("KEYWORD", "for");
    const variable = this.expect("IDENTIFIER").value;
    this.expect("KEYWORD", "in");
    const iterable = this.parseExpression();
    this.expect("COLON");
    this.expectNewline();

    const body = this.parseStatementBlock();

    const node: ForNode = { kind: "for", variable, iterable, body };
    node.span = this.makeSpan(startToken);
    return node;
  }

  /** Parse atomic block: atomic: / atomic skip: / atomic halt: / atomic revert: */
  private parseAtomicStatement(): AtomicNode {
    const startToken = this.current();
    this.expect("KEYWORD", "atomic");

    let onFailure: AtomicNode["onFailure"];
    // Check for failure mode: atomic skip: / atomic halt: / atomic revert:
    // Note: "halt" is a keyword, "skip" and "revert" are identifiers
    const failureModes = ["skip", "halt", "revert"];
    if (
      (this.check("IDENTIFIER") || this.check("KEYWORD")) &&
      failureModes.includes(this.current().value)
    ) {
      onFailure = this.current().value as "skip" | "halt" | "revert";
      this.advance();
    }

    this.expect("COLON");
    this.expectNewline();

    const body = this.parseStatementBlock();

    const node: AtomicNode = { kind: "atomic", body, onFailure };
    node.span = this.makeSpan(startToken);
    return node;
  }

  /** Parse emit statement: emit event_name(key=value) */
  private parseEmitStatement(): EmitNode {
    const startToken = this.current();
    this.expect("KEYWORD", "emit");
    const event = this.expect("IDENTIFIER").value;

    const data: Array<{ key: string; value: ExpressionNode }> = [];

    if (this.check("LPAREN")) {
      this.advance();
      while (!this.check("RPAREN")) {
        const key = this.expect("IDENTIFIER").value;
        this.expect("ASSIGN");
        const value = this.parseExpression();
        data.push({ key, value });
        if (this.check("COMMA")) {
          this.advance();
        }
      }
      this.expect("RPAREN");
    }

    this.expectNewline();
    const node: EmitNode = { kind: "emit", event, data };
    node.span = this.makeSpan(startToken);
    return node;
  }

  /** Parse halt statement */
  private parseHaltStatement(): HaltNode {
    const startToken = this.current();
    this.expect("KEYWORD", "halt");
    let reason = "halted";
    if (this.check("STRING")) {
      reason = this.advance().value;
    }
    this.expectNewline();
    const node: HaltNode = { kind: "halt", reason };
    node.span = this.makeSpan(startToken);
    return node;
  }

  /** Parse wait statement */
  private parseWaitStatement(): WaitNode {
    const startToken = this.current();
    this.expect("KEYWORD", "wait");
    const durationToken = this.expect("NUMBER");
    const duration = Number.parseFloat(durationToken.value);
    this.expectNewline();
    const node: WaitNode = { kind: "wait", duration };
    node.span = this.makeSpan(startToken);
    return node;
  }

  /** Parse constraint clause: with key=value, key=value, ... */
  private parseConstraintClause(): ConstraintClause {
    const startToken = this.current();
    this.expect("KEYWORD", "with");

    const constraints: Array<{ key: string; value: ExpressionNode }> = [];

    do {
      const key = this.expect("IDENTIFIER").value;
      this.expect("ASSIGN");
      const value = this.parseExpression();
      constraints.push({ key, value });
    } while (
      this.check("COMMA") &&
      (() => {
        this.advance();
        return true;
      })()
    );

    const node: ConstraintClause = { kind: "constraint_clause", constraints };
    node.span = this.makeSpan(startToken);
    return node;
  }

  // ===========================================================================
  // EXPRESSION PARSING
  // ===========================================================================

  /** Parse an expression */
  parseExpression(): ExpressionNode {
    return this.parseTernary();
  }

  /** Parse ternary: cond ? then : else */
  private parseTernary(): ExpressionNode {
    const condition = this.parseOr();

    if (this.check("QUESTION")) {
      this.advance();
      const thenExpr = this.parseTernary();
      this.expect("COLON");
      const elseExpr = this.parseTernary();
      return {
        kind: "ternary",
        condition,
        thenExpr,
        elseExpr,
      };
    }

    return condition;
  }

  /** Parse or: a or b */
  private parseOr(): ExpressionNode {
    let left = this.parseAnd();

    while (this.check("KEYWORD", "or")) {
      this.advance();
      const right = this.parseAnd();
      left = { kind: "binary", op: "or", left, right } as BinaryExprNode;
    }

    return left;
  }

  /** Parse and: a and b */
  private parseAnd(): ExpressionNode {
    let left = this.parseEquality();

    while (this.check("KEYWORD", "and")) {
      this.advance();
      const right = this.parseEquality();
      left = { kind: "binary", op: "and", left, right } as BinaryExprNode;
    }

    return left;
  }

  /** Parse equality: == != */
  private parseEquality(): ExpressionNode {
    let left = this.parseComparison();

    while (
      this.check("OPERATOR") &&
      (this.current().value === "==" || this.current().value === "!=")
    ) {
      const op = this.advance().value as BinaryOperator;
      const right = this.parseComparison();
      left = { kind: "binary", op, left, right } as BinaryExprNode;
    }

    return left;
  }

  /** Parse comparison: < > <= >= */
  private parseComparison(): ExpressionNode {
    let left = this.parseAdditive();

    while (this.check("OPERATOR") && ["<", ">", "<=", ">="].includes(this.current().value)) {
      const op = this.advance().value as BinaryOperator;
      const right = this.parseAdditive();
      left = { kind: "binary", op, left, right } as BinaryExprNode;
    }

    return left;
  }

  /** Parse additive: + - */
  private parseAdditive(): ExpressionNode {
    let left = this.parseMultiplicative();

    while (
      this.check("OPERATOR") &&
      (this.current().value === "+" || this.current().value === "-")
    ) {
      const op = this.advance().value as BinaryOperator;
      const right = this.parseMultiplicative();
      left = { kind: "binary", op, left, right } as BinaryExprNode;
    }

    return left;
  }

  /** Parse multiplicative: * / % */
  private parseMultiplicative(): ExpressionNode {
    let left = this.parseUnary();

    while (this.check("OPERATOR") && ["*", "/", "%"].includes(this.current().value)) {
      const op = this.advance().value as BinaryOperator;
      const right = this.parseUnary();
      left = { kind: "binary", op, left, right } as BinaryExprNode;
    }

    return left;
  }

  /** Parse unary: not - */
  private parseUnary(): ExpressionNode {
    if (this.check("KEYWORD", "not")) {
      this.advance();
      const arg = this.parseUnary();
      return { kind: "unary", op: "not", arg } as UnaryExprNode;
    }

    if (this.check("OPERATOR", "-")) {
      this.advance();
      const arg = this.parseUnary();
      return { kind: "unary", op: "-", arg } as UnaryExprNode;
    }

    return this.parsePostfix();
  }

  /** Parse postfix: . [] () */
  private parsePostfix(): ExpressionNode {
    let expr = this.parsePrimary();

    while (true) {
      if (this.check("DOT")) {
        this.advance();
        const property = this.expect("IDENTIFIER").value;
        expr = { kind: "property_access", object: expr, property } as PropertyAccessNode;
      } else if (this.check("LBRACKET")) {
        this.advance();
        const index = this.parseExpression();
        this.expect("RBRACKET");
        expr = { kind: "array_access", array: expr, index } as ArrayAccessNode;
      } else if (this.check("LPAREN")) {
        this.advance();
        const args: ExpressionNode[] = [];
        const kwargs: Array<{ key: string; value: ExpressionNode }> = [];

        while (!this.check("RPAREN")) {
          // Check for kwarg: key=value
          if (this.check("IDENTIFIER") && this.peek().type === "ASSIGN") {
            const key = this.advance().value;
            this.expect("ASSIGN");
            const value = this.parseExpression();
            kwargs.push({ key, value });
          } else {
            args.push(this.parseExpression());
          }
          if (this.check("COMMA")) {
            this.advance();
          }
        }
        this.expect("RPAREN");
        expr = {
          kind: "call",
          callee: expr,
          args,
          kwargs: kwargs.length > 0 ? kwargs : undefined,
        } as CallExprNode;
      } else {
        break;
      }
    }

    return expr;
  }

  /** Parse primary expression */
  private parsePrimary(): ExpressionNode {
    const token = this.current();

    // Number
    if (token.type === "NUMBER") {
      this.advance();
      const value = token.value.includes(".")
        ? Number.parseFloat(token.value)
        : Number.parseInt(token.value, 10);
      return { kind: "literal", value, literalType: "number" } as LiteralNode;
    }

    // String
    if (token.type === "STRING") {
      this.advance();
      return { kind: "literal", value: token.value, literalType: "string" } as LiteralNode;
    }

    // Boolean
    if (token.type === "BOOLEAN") {
      this.advance();
      return {
        kind: "literal",
        value: token.value === "true",
        literalType: "boolean",
      } as LiteralNode;
    }

    // Address
    if (token.type === "ADDRESS") {
      this.advance();
      return { kind: "literal", value: token.value, literalType: "address" } as LiteralNode;
    }

    // Percentage
    if (token.type === "PERCENTAGE") {
      this.advance();
      return { kind: "percentage", value: Number.parseFloat(token.value) } as PercentageExpr;
    }

    // Venue reference: @name
    if (token.type === "VENUE_REF") {
      this.advance();
      return { kind: "venue_ref_expr", name: token.value } as VenueRefExpr;
    }

    // Advisory: **text**
    if (token.type === "ADVISORY") {
      this.advance();
      return { kind: "advisory_expr", prompt: token.value } as AdvisoryExpr;
    }

    // Array literal: [a, b, c]
    if (token.type === "LBRACKET") {
      this.advance();
      const elements: ExpressionNode[] = [];
      while (!this.check("RBRACKET")) {
        elements.push(this.parseExpression());
        if (this.check("COMMA")) {
          this.advance();
        }
      }
      this.expect("RBRACKET");
      return { kind: "array_literal", elements } as ArrayLiteralNode;
    }

    // Object literal: {key: value}
    if (token.type === "LBRACE") {
      this.advance();
      const entries: Array<{ key: string; value: ExpressionNode }> = [];
      while (!this.check("RBRACE")) {
        const key = this.expect("IDENTIFIER").value;
        this.expect("COLON");
        const value = this.parseExpression();
        entries.push({ key, value });
        if (this.check("COMMA")) {
          this.advance();
        }
      }
      this.expect("RBRACE");
      return { kind: "object_literal", entries } as ObjectLiteralNode;
    }

    // Parenthesized expression
    if (token.type === "LPAREN") {
      this.advance();
      const expr = this.parseExpression();
      this.expect("RPAREN");
      return expr;
    }

    // Identifier or keyword used as identifier in expression context
    // Many keywords can be used as identifiers when they appear in expressions
    const keywordsAsIdentifiers = new Set([
      "max",
      "assets",
      "params",
      "limits",
      "state",
      "venues",
      "lending",
      "swap",
      "persistent",
      "ephemeral",
      "version",
      "description",
      "skills",
      "advisors",
      "guards",
    ]);
    if (
      token.type === "IDENTIFIER" ||
      (token.type === "KEYWORD" && keywordsAsIdentifiers.has(token.value))
    ) {
      this.advance();
      return { kind: "identifier", name: token.value } as IdentifierNode;
    }

    throw new ParseError(`Unexpected token in expression: ${token.type} '${token.value}'`, {
      location: token.location,
      source: this.source,
    });
  }
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Parse Grimoire source code into AST
 */
export function parse(source: string): SpellAST {
  const tokens = tokenize(source);
  const parser = new Parser(tokens, source);
  return parser.parseSpellFile();
}
