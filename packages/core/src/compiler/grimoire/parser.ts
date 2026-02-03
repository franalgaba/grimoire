/**
 * Recursive descent parser for Grimoire syntax
 */

import type {
  AdviseNode,
  AdvisorItem,
  AdvisorsSection,
  AdvisoryExpr,
  AdvisoryOutputSchemaNode,
  ArrayAccessNode,
  ArrayLiteralNode,
  AssetItem,
  AssetsSection,
  AssignmentNode,
  AtomicNode,
  BinaryExprNode,
  BinaryOperator,
  BlockDef,
  CallExprNode,
  CatchNode,
  ConstraintClause,
  DescriptionSection,
  DoNode,
  EmitNode,
  ExpressionNode,
  ForNode,
  GuardItem,
  GuardsSection,
  HaltNode,
  IdentifierNode,
  IfNode,
  ImportNode,
  LimitItem,
  LimitsSection,
  LiteralNode,
  MethodCallNode,
  ObjectLiteralNode,
  ParallelBranchNode,
  ParallelJoinNode,
  ParallelNode,
  ParamItem,
  ParamsSection,
  PassNode,
  PercentageExpr,
  PipelineNode,
  PipelineStageNode,
  PropertyAccessNode,
  RepeatNode,
  RetrySpec,
  SectionNode,
  SkillItem,
  SkillsSection,
  SpellAST,
  StateItem,
  StateSection,
  StatementNode,
  TriggerHandler,
  TriggerType,
  TryNode,
  UnaryExprNode,
  UnitLiteralNode,
  UntilNode,
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
    const imports: ImportNode[] = [];
    const blocks: BlockDef[] = [];

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

      // Check for import or block or trigger
      if (this.check("KEYWORD", "import")) {
        imports.push(this.parseImport());
      } else if (this.check("KEYWORD", "block")) {
        blocks.push(this.parseBlock());
      } else if (this.check("KEYWORD", "on")) {
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
      imports,
      blocks,
    };
  }

  // ===========================================================================
  // SECTION PARSING
  // ===========================================================================

  /** Parse import declaration: import "path" */
  private parseImport(): ImportNode {
    const startToken = this.current();
    this.expect("KEYWORD", "import");
    const pathToken = this.expect("STRING");
    let alias: string | undefined;
    if (
      this.check("KEYWORD", "as") ||
      (this.check("IDENTIFIER") && this.current().value === "as")
    ) {
      this.advance();
      if (this.check("IDENTIFIER") || this.check("KEYWORD")) {
        alias = this.advance().value;
      } else {
        throw new ParseError("Expected alias name after 'as'", {
          location: this.current().location,
          source: this.source,
        });
      }
    }
    this.expectNewline();
    const node: ImportNode = { kind: "import", path: pathToken.value, alias };
    node.span = this.makeSpan(startToken);
    return node;
  }

  /** Parse block definition: block name(arg, ...): */
  private parseBlock(): BlockDef {
    const startToken = this.current();
    this.expect("KEYWORD", "block");
    const name = this.expect("IDENTIFIER").value;
    const params: string[] = [];

    if (this.check("LPAREN")) {
      this.advance();
      while (!this.check("RPAREN")) {
        const param = this.expect("IDENTIFIER").value;
        params.push(param);
        if (this.check("COMMA")) {
          this.advance();
        }
      }
      this.expect("RPAREN");
    }

    this.expect("COLON");
    this.expectNewline();
    const body = this.parseStatementBlock();

    const node: BlockDef = { kind: "block", name, params, body };
    node.span = this.makeSpan(startToken);
    return node;
  }

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

  /** Parse list of strings/identifiers (e.g., [a, "b"]) */
  private parseStringList(): string[] {
    const items: string[] = [];
    if (this.check("LBRACKET")) {
      this.advance();
      while (!this.check("RBRACKET")) {
        if (this.check("STRING")) {
          items.push(this.advance().value);
        } else if (this.check("IDENTIFIER") || this.check("KEYWORD")) {
          items.push(this.advance().value);
        } else if (this.check("VENUE_REF")) {
          items.push(this.advance().value);
        } else {
          throw new ParseError("Expected list item", {
            location: this.current().location,
            source: this.source,
          });
        }
        if (this.check("COMMA")) this.advance();
      }
      this.expect("RBRACKET");
      return items;
    }

    // Single item
    if (this.check("STRING")) {
      items.push(this.advance().value);
      return items;
    }
    if (this.check("IDENTIFIER") || this.check("KEYWORD")) {
      items.push(this.advance().value);
      return items;
    }
    if (this.check("VENUE_REF")) {
      items.push(this.advance().value);
      return items;
    }

    throw new ParseError("Expected list", {
      location: this.current().location,
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
      // Block form
      this.expectNewline();
      if (this.check("INDENT")) {
        this.advance();
        while (!this.check("DEDENT") && !this.check("EOF")) {
          this.skipNewlines();
          if (this.check("DEDENT") || this.check("EOF")) break;

          const symbol = this.expect("IDENTIFIER").value;
          const asset: AssetItem = { symbol };
          this.expect("COLON");

          if (this.check("NEWLINE")) {
            this.expectNewline();
            if (!this.check("INDENT")) {
              throw new ParseError("Expected indented asset block", {
                location: this.current().location,
                source: this.source,
              });
            }
            this.advance();
            while (!this.check("DEDENT") && !this.check("EOF")) {
              this.skipNewlines();
              if (this.check("DEDENT") || this.check("EOF")) break;

              const key = this.expect("IDENTIFIER").value;
              this.expect("COLON");
              if (key === "chain") {
                const val = this.expect("NUMBER").value;
                asset.chain = Number.parseInt(val, 10);
                this.expectNewline();
              } else if (key === "address") {
                if (this.check("ADDRESS")) {
                  asset.address = this.advance().value;
                } else if (this.check("STRING")) {
                  asset.address = this.advance().value;
                } else {
                  throw new ParseError("Expected address value", {
                    location: this.current().location,
                    source: this.source,
                  });
                }
                this.expectNewline();
              } else if (key === "decimals") {
                const val = this.expect("NUMBER").value;
                asset.decimals = Number.parseInt(val, 10);
                this.expectNewline();
              } else {
                this.parseExpression();
                this.expectNewline();
              }
            }
            if (this.check("DEDENT")) this.advance();
          } else {
            // Inline asset defaults: assets: SYMBOL: <ignored>
            this.parseExpression();
            this.expectNewline();
          }

          items.push(asset);
        }
        if (this.check("DEDENT")) this.advance();
      }
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
        const item: ParamItem = { name };

        // Block form: param:
        if (this.check("NEWLINE")) {
          this.expectNewline();
          if (!this.check("INDENT")) {
            throw new ParseError("Expected indented param block", {
              location: this.current().location,
              source: this.source,
            });
          }
          this.advance();

          while (!this.check("DEDENT") && !this.check("EOF")) {
            this.skipNewlines();
            if (this.check("DEDENT") || this.check("EOF")) break;

            const keyToken = this.current();
            if (!(this.check("IDENTIFIER") || this.check("KEYWORD"))) {
              throw new ParseError(
                `Expected param field but got ${this.current().type} '${this.current().value}'`,
                { location: this.current().location, source: this.source }
              );
            }
            const key = keyToken.value;
            this.advance();
            this.expect("COLON");

            if (key === "type") {
              if (this.check("STRING")) {
                item.type = this.advance().value as ParamItem["type"];
              } else if (this.check("IDENTIFIER") || this.check("KEYWORD")) {
                item.type = this.advance().value as ParamItem["type"];
              } else {
                throw new ParseError("Expected param type value", {
                  location: keyToken.location,
                  source: this.source,
                });
              }
              this.expectNewline();
            } else if (key === "asset") {
              if (this.check("STRING")) {
                item.asset = this.advance().value;
              } else if (this.check("IDENTIFIER") || this.check("KEYWORD")) {
                item.asset = this.advance().value;
              } else {
                throw new ParseError("Expected asset identifier", {
                  location: keyToken.location,
                  source: this.source,
                });
              }
              this.expectNewline();
            } else if (key === "default") {
              item.value = this.parseExpression();
              this.expectNewline();
            } else if (key === "min") {
              const val = this.expect("NUMBER").value;
              item.min = Number.parseFloat(val);
              this.expectNewline();
            } else if (key === "max") {
              const val = this.expect("NUMBER").value;
              item.max = Number.parseFloat(val);
              this.expectNewline();
            } else {
              // Unknown field - parse and ignore
              this.parseExpression();
              this.expectNewline();
            }
          }

          if (this.check("DEDENT")) this.advance();
        } else {
          // Inline form: name: value
          item.value = this.parseExpression();
          this.expectNewline();
        }

        items.push(item);
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
    const startToken = this.current();
    this.expect("KEYWORD", "skills");
    this.expect("COLON");
    this.expectNewline();

    const items: SkillItem[] = [];

    if (this.check("INDENT")) {
      this.advance();
      while (!this.check("DEDENT") && !this.check("EOF")) {
        this.skipNewlines();
        if (this.check("DEDENT") || this.check("EOF")) break;

        const name = this.expect("IDENTIFIER").value;
        this.expect("COLON");
        this.expectNewline();

        let type: SkillItem["type"] | undefined;
        const adapters: string[] = [];
        let defaultMaxSlippage: ExpressionNode | undefined;

        if (this.check("INDENT")) {
          this.advance();
          while (!this.check("DEDENT") && !this.check("EOF")) {
            this.skipNewlines();
            if (this.check("DEDENT") || this.check("EOF")) break;

            const keyToken = this.current();
            if (!(this.check("IDENTIFIER") || this.check("KEYWORD"))) {
              throw new ParseError(
                `Expected skill field but got ${this.current().type} '${this.current().value}'`,
                { location: this.current().location, source: this.source }
              );
            }
            const key = keyToken.value;
            this.advance();
            this.expect("COLON");

            if (key === "type") {
              // Accept identifier or string
              if (this.check("IDENTIFIER") || this.check("KEYWORD")) {
                type = this.advance().value as SkillItem["type"];
              } else if (this.check("STRING")) {
                type = this.advance().value as SkillItem["type"];
              } else {
                throw new ParseError("Expected skill type value", {
                  location: this.current().location,
                  source: this.source,
                });
              }
              this.expectNewline();
            } else if (key === "adapters") {
              if (this.check("LBRACKET")) {
                this.advance();
                while (!this.check("RBRACKET")) {
                  if (this.check("VENUE_REF")) {
                    adapters.push(this.advance().value);
                  } else if (this.check("IDENTIFIER") || this.check("KEYWORD")) {
                    adapters.push(this.advance().value);
                  } else if (this.check("STRING")) {
                    adapters.push(this.advance().value);
                  } else {
                    throw new ParseError("Expected adapter name", {
                      location: this.current().location,
                      source: this.source,
                    });
                  }
                  if (this.check("COMMA")) this.advance();
                }
                this.expect("RBRACKET");
              } else {
                // Single adapter
                if (this.check("VENUE_REF")) {
                  adapters.push(this.advance().value);
                } else if (this.check("IDENTIFIER") || this.check("KEYWORD")) {
                  adapters.push(this.advance().value);
                } else if (this.check("STRING")) {
                  adapters.push(this.advance().value);
                } else {
                  throw new ParseError("Expected adapter name", {
                    location: this.current().location,
                    source: this.source,
                  });
                }
              }
              this.expectNewline();
            } else if (key === "default_constraints") {
              this.expectNewline();
              if (this.check("INDENT")) {
                this.advance();
                while (!this.check("DEDENT") && !this.check("EOF")) {
                  this.skipNewlines();
                  if (this.check("DEDENT") || this.check("EOF")) break;
                  const dcKey = this.expect("IDENTIFIER").value;
                  this.expect("COLON");
                  const value = this.parseExpression();
                  if (dcKey === "max_slippage") {
                    defaultMaxSlippage = value;
                  }
                  this.expectNewline();
                }
                if (this.check("DEDENT")) this.advance();
              }
            } else {
              // Unknown field, parse and ignore
              this.parseExpression();
              this.expectNewline();
            }
          }
          if (this.check("DEDENT")) this.advance();
        }

        if (!type) {
          throw new ParseError(`Skill '${name}' missing type`, {
            location: this.current().location,
            source: this.source,
          });
        }

        items.push({
          name,
          type,
          adapters,
          defaultConstraints: defaultMaxSlippage ? { maxSlippage: defaultMaxSlippage } : undefined,
        } as SkillItem);

        this.skipNewlines();
      }
      if (this.check("DEDENT")) this.advance();
    }

    const node: SkillsSection = { kind: "skills", items };
    node.span = this.makeSpan(startToken);
    return node;
  }

  /** Parse advisors section */
  private parseAdvisorsSection(): AdvisorsSection {
    const startToken = this.current();
    this.expect("KEYWORD", "advisors");
    this.expect("COLON");
    this.expectNewline();

    const items: AdvisorsSection["items"] = [];

    if (this.check("INDENT")) {
      this.advance();
      while (!this.check("DEDENT") && !this.check("EOF")) {
        this.skipNewlines();
        if (this.check("DEDENT") || this.check("EOF")) break;

        const name = this.expect("IDENTIFIER").value;
        this.expect("COLON");
        this.expectNewline();

        const advisor: AdvisorItem = {
          name,
          model: "sonnet",
        } as AdvisorItem;

        if (this.check("INDENT")) {
          this.advance();
          while (!this.check("DEDENT") && !this.check("EOF")) {
            this.skipNewlines();
            if (this.check("DEDENT") || this.check("EOF")) break;

            const keyToken = this.current();
            if (!(this.check("IDENTIFIER") || this.check("KEYWORD"))) {
              throw new ParseError(
                `Expected advisor field but got ${this.current().type} '${this.current().value}'`,
                { location: this.current().location, source: this.source }
              );
            }
            const key = keyToken.value;
            this.advance();
            this.expect("COLON");

            if (key === "model") {
              if (this.check("STRING")) {
                advisor.model = this.advance().value as AdvisorItem["model"];
              } else if (this.check("IDENTIFIER") || this.check("KEYWORD")) {
                advisor.model = this.advance().value as AdvisorItem["model"];
              } else {
                throw new ParseError("Expected model value", {
                  location: this.current().location,
                  source: this.source,
                });
              }
              this.expectNewline();
            } else if (key === "system" || key === "system_prompt") {
              const value = this.expect("STRING").value;
              advisor.systemPrompt = value;
              this.expectNewline();
            } else if (key === "skills") {
              advisor.skills = this.parseStringList();
              this.expectNewline();
            } else if (key === "allowed_tools") {
              advisor.allowedTools = this.parseStringList();
              this.expectNewline();
            } else if (key === "mcp") {
              advisor.mcp = this.parseStringList();
              this.expectNewline();
            } else if (key === "timeout") {
              const value = this.expect("NUMBER").value;
              advisor.timeout = Number.parseFloat(value);
              this.expectNewline();
            } else if (key === "fallback") {
              if (this.check("BOOLEAN")) {
                advisor.fallback = this.advance().value === "true";
              } else {
                throw new ParseError("Expected boolean fallback", {
                  location: this.current().location,
                  source: this.source,
                });
              }
              this.expectNewline();
            } else if (key === "rate_limit") {
              this.expectNewline();
              if (this.check("INDENT")) {
                this.advance();
                while (!this.check("DEDENT") && !this.check("EOF")) {
                  this.skipNewlines();
                  if (this.check("DEDENT") || this.check("EOF")) break;
                  const rlKey = this.expect("IDENTIFIER").value;
                  this.expect("COLON");
                  const value = this.expect("NUMBER").value;
                  if (rlKey === "max_per_run") {
                    advisor.maxPerRun = Number.parseFloat(value);
                  } else if (rlKey === "max_per_hour") {
                    advisor.maxPerHour = Number.parseFloat(value);
                  }
                  this.expectNewline();
                }
                if (this.check("DEDENT")) this.advance();
              }
            } else {
              // Unknown field - parse and ignore
              this.parseExpression();
              this.expectNewline();
            }
          }
          if (this.check("DEDENT")) this.advance();
        }

        items.push(advisor);
        this.skipNewlines();
      }
      if (this.check("DEDENT")) this.advance();
    }

    const node: AdvisorsSection = { kind: "advisors", items };
    node.span = this.makeSpan(startToken);
    return node;
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

        let severity: GuardItem["severity"] = "halt";
        let message: string | undefined;
        let fallback: boolean | undefined;

        if (this.check("KEYWORD", "with")) {
          const meta = this.parseConstraintClause();
          for (const { key, value } of meta.constraints) {
            if (key === "severity" && value.kind === "literal") {
              severity = String((value as LiteralNode).value) as GuardItem["severity"];
            } else if (key === "message" && value.kind === "literal") {
              message = String((value as LiteralNode).value);
            } else if (key === "fallback" && value.kind === "literal") {
              fallback = Boolean((value as LiteralNode).value);
            }
          }
        }

        this.expectNewline();

        items.push({
          id,
          check,
          severity,
          message,
          fallback,
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
        case "condition": {
          this.advance();
          const expression = this.parseExpression();
          let pollInterval: number | undefined;
          if (
            this.check("KEYWORD", "every") ||
            (this.check("IDENTIFIER") && this.current().value === "every")
          ) {
            this.advance();
            const durationToken = this.expect("NUMBER");
            pollInterval = Number.parseFloat(durationToken.value);
          }
          return { kind: "condition", expression, pollInterval };
        }
        case "event": {
          this.advance();
          let eventName = "";
          if (this.check("STRING")) {
            eventName = this.advance().value;
          } else if (this.check("IDENTIFIER") || this.check("KEYWORD")) {
            eventName = this.advance().value;
          } else {
            throw new ParseError("Expected event name", {
              location: this.current().location,
              source: this.source,
            });
          }
          let filter: ExpressionNode | undefined;
          if (
            this.check("KEYWORD", "where") ||
            (this.check("IDENTIFIER") && this.current().value === "where")
          ) {
            this.advance();
            filter = this.parseExpression();
          }
          return { kind: "event", event: eventName, filter };
        }
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
        case "repeat":
          return this.parseRepeatStatement();
        case "loop":
          return this.parseUntilStatement();
        case "try":
          return this.parseTryStatement();
        case "parallel":
          return this.parseParallelStatement();
        case "do":
          return this.parseDoStatement();
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

    // Pipeline expression statement
    if (this.check("OPERATOR") && this.current().value === "|") {
      const node = this.parsePipeline(expr, undefined, startToken);
      return node;
    }

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

        // Check for using clause: ... using skill
        if (this.check("KEYWORD") && this.current().value === "using") {
          node.skill = this.parseUsingClause();
        }

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
  private parseAssignment(): StatementNode {
    const startToken = this.current();
    const target = this.expect("IDENTIFIER").value;
    this.expect("ASSIGN");
    // Special case: advise statement
    if (this.check("KEYWORD", "advise")) {
      const node = this.parseAdviseStatement(target, startToken);
      return node;
    }

    const value = this.parseExpression();

    // Pipeline assignment
    if (this.check("OPERATOR") && this.current().value === "|") {
      const node = this.parsePipeline(value, target, startToken);
      return node;
    }

    let skill: string | undefined;
    if (this.check("KEYWORD") && this.current().value === "using") {
      skill = this.parseUsingClause();
    }

    let constraints: ConstraintClause | undefined;
    if (this.check("KEYWORD") && this.current().value === "with") {
      constraints = this.parseConstraintClause();
    }

    this.expectNewline();
    const node: AssignmentNode = { kind: "assignment", target, value, constraints, skill };
    node.span = this.makeSpan(startToken);
    return node;
  }

  /** Parse advise statement (assignment form) */
  private parseAdviseStatement(target: string, startToken: Token): AdviseNode {
    this.expect("KEYWORD", "advise");
    const advisor = this.expect("IDENTIFIER").value;
    this.expect("COLON");
    const prompt = this.expect("STRING").value;
    this.expectNewline();

    let outputSchema: AdvisoryOutputSchemaNode | undefined;
    let timeout: number | undefined;
    let fallback: ExpressionNode | undefined;

    if (this.check("INDENT")) {
      this.advance();
      while (!this.check("DEDENT") && !this.check("EOF")) {
        this.skipNewlines();
        if (this.check("DEDENT") || this.check("EOF")) break;

        const keyToken = this.current();
        if (!(this.check("IDENTIFIER") || this.check("KEYWORD"))) {
          throw new ParseError(
            `Expected advise field but got ${this.current().type} '${this.current().value}'`,
            { location: this.current().location, source: this.source }
          );
        }
        const key = keyToken.value;
        this.advance();
        this.expect("COLON");

        if (key === "output") {
          outputSchema = this.parseOutputSchemaBlock(keyToken);
        } else if (key === "timeout") {
          const value = this.expect("NUMBER").value;
          timeout = Number.parseFloat(value);
          this.expectNewline();
        } else if (key === "fallback") {
          fallback = this.parseExpression();
          this.expectNewline();
        } else {
          this.parseExpression();
          this.expectNewline();
        }
      }
      if (this.check("DEDENT")) this.advance();
    }

    if (!outputSchema || timeout === undefined || fallback === undefined) {
      throw new ParseError("Advise statement requires output, timeout, and fallback", {
        location: startToken.location,
        source: this.source,
      });
    }

    const node: AdviseNode = {
      kind: "advise",
      target,
      advisor,
      prompt,
      outputSchema,
      timeout,
      fallback,
    };
    node.span = this.makeSpan(startToken);
    return node;
  }

  private parseOutputSchemaBlock(keyToken: Token): AdvisoryOutputSchemaNode {
    if (!this.check("NEWLINE")) {
      // Allow inline type: output: boolean
      const inlineType = this.parseSchemaType();
      this.expectNewline();
      return { kind: "advisory_output_schema", type: inlineType };
    }

    this.expectNewline();
    if (!this.check("INDENT")) {
      throw new ParseError("Expected indented output block", {
        location: keyToken.location,
        source: this.source,
      });
    }
    this.advance();
    return this.parseSchemaObject(keyToken);
  }

  private parseSchemaAfterColon(keyToken: Token): AdvisoryOutputSchemaNode {
    if (this.check("NEWLINE")) {
      this.expectNewline();
      if (!this.check("INDENT")) {
        throw new ParseError("Expected indented schema block", {
          location: keyToken.location,
          source: this.source,
        });
      }
      this.advance();
      return this.parseSchemaObject(keyToken);
    }

    const inlineType = this.parseSchemaType();
    this.expectNewline();
    return { kind: "advisory_output_schema", type: inlineType };
  }

  private parseSchemaObject(keyToken: Token): AdvisoryOutputSchemaNode {
    let outType: AdvisoryOutputSchemaNode["type"] | undefined;
    let values: string[] | undefined;
    let min: number | undefined;
    let max: number | undefined;
    let minLength: number | undefined;
    let maxLength: number | undefined;
    let pattern: string | undefined;
    let fields: Record<string, AdvisoryOutputSchemaNode> | undefined;
    let items: AdvisoryOutputSchemaNode | undefined;

    while (!this.check("DEDENT") && !this.check("EOF")) {
      this.skipNewlines();
      if (this.check("DEDENT") || this.check("EOF")) break;
      if (!(this.check("IDENTIFIER") || this.check("KEYWORD"))) {
        throw new ParseError(
          `Expected output schema field but got ${this.current().type} '${this.current().value}'`,
          { location: this.current().location, source: this.source }
        );
      }
      const outKey = this.current().value;
      this.advance();
      this.expect("COLON");
      if (outKey === "type") {
        outType = this.parseSchemaType();
        this.expectNewline();
      } else if (outKey === "values") {
        values = this.parseStringList();
        this.expectNewline();
      } else if (outKey === "min") {
        const val = this.expect("NUMBER").value;
        min = Number.parseFloat(val);
        this.expectNewline();
      } else if (outKey === "max") {
        const val = this.expect("NUMBER").value;
        max = Number.parseFloat(val);
        this.expectNewline();
      } else if (outKey === "min_length") {
        const val = this.expect("NUMBER").value;
        minLength = Number.parseFloat(val);
        this.expectNewline();
      } else if (outKey === "max_length") {
        const val = this.expect("NUMBER").value;
        maxLength = Number.parseFloat(val);
        this.expectNewline();
      } else if (outKey === "pattern") {
        pattern = this.expect("STRING").value;
        this.expectNewline();
      } else if (outKey === "fields") {
        fields = this.parseSchemaFields(keyToken);
      } else if (outKey === "items") {
        items = this.parseSchemaAfterColon(keyToken);
      } else {
        this.parseExpression();
        this.expectNewline();
      }
    }

    if (this.check("DEDENT")) this.advance();

    if (!outType) {
      throw new ParseError("Advisory output type is required", {
        location: keyToken.location,
        source: this.source,
      });
    }

    return {
      kind: "advisory_output_schema",
      type: outType,
      values,
      min,
      max,
      minLength,
      maxLength,
      pattern,
      fields,
      items,
    };
  }

  private parseSchemaFields(keyToken: Token): Record<string, AdvisoryOutputSchemaNode> {
    this.expectNewline();
    if (!this.check("INDENT")) {
      throw new ParseError("Expected indented fields block", {
        location: keyToken.location,
        source: this.source,
      });
    }
    this.advance();

    const fields: Record<string, AdvisoryOutputSchemaNode> = {};
    while (!this.check("DEDENT") && !this.check("EOF")) {
      this.skipNewlines();
      if (this.check("DEDENT") || this.check("EOF")) break;
      const fieldName = this.expect("IDENTIFIER").value;
      this.expect("COLON");
      fields[fieldName] = this.parseSchemaAfterColon(keyToken);
    }

    if (this.check("DEDENT")) this.advance();
    return fields;
  }

  private parseSchemaType(): AdvisoryOutputSchemaNode["type"] {
    if (this.check("STRING")) {
      return this.advance().value as AdvisoryOutputSchemaNode["type"];
    }
    if (this.check("IDENTIFIER") || this.check("KEYWORD")) {
      return this.advance().value as AdvisoryOutputSchemaNode["type"];
    }
    throw new ParseError("Expected output schema type", {
      location: this.current().location,
      source: this.source,
    });
  }

  /** Parse using clause: using skill_name */
  private parseUsingClause(): string {
    this.expect("KEYWORD", "using");
    if (this.check("IDENTIFIER") || this.check("KEYWORD")) {
      return this.advance().value;
    }
    if (this.check("STRING")) {
      return this.advance().value;
    }
    throw new ParseError("Expected skill name after 'using'", {
      location: this.current().location,
      source: this.source,
    });
  }

  /** Parse repeat statement */
  private parseRepeatStatement(): RepeatNode {
    const startToken = this.current();
    this.expect("KEYWORD", "repeat");
    const countToken = this.expect("NUMBER");
    const count: ExpressionNode = {
      kind: "literal",
      value: countToken.value.includes(".")
        ? Number.parseFloat(countToken.value)
        : Number.parseInt(countToken.value, 10),
      literalType: "number",
    } as LiteralNode;
    this.expect("COLON");
    this.expectNewline();
    const body = this.parseStatementBlock();
    const node: RepeatNode = { kind: "repeat", count, body };
    node.span = this.makeSpan(startToken);
    return node;
  }

  /** Parse loop-until statement */
  private parseUntilStatement(): UntilNode {
    const startToken = this.current();
    this.expect("KEYWORD", "loop");
    this.expect("KEYWORD", "until");
    const condition = this.parseExpression();

    let maxIterations: number | undefined;
    if (this.check("KEYWORD", "max")) {
      this.advance();
      const maxToken = this.expect("NUMBER");
      maxIterations = Number.parseFloat(maxToken.value);
    }

    this.expect("COLON");
    this.expectNewline();
    const body = this.parseStatementBlock();
    const node: UntilNode = { kind: "until", condition, maxIterations, body };
    node.span = this.makeSpan(startToken);
    return node;
  }

  /** Parse try/catch/finally */
  private parseTryStatement(): TryNode {
    const startToken = this.current();
    this.expect("KEYWORD", "try");
    this.expect("COLON");
    this.expectNewline();
    const tryBody = this.parseStatementBlock();

    const catches: CatchNode[] = [];
    while (this.check("KEYWORD", "catch")) {
      catches.push(this.parseCatchBlock());
    }

    let finallyBody: StatementNode[] | undefined;
    if (this.check("KEYWORD", "finally")) {
      this.advance();
      this.expect("COLON");
      this.expectNewline();
      finallyBody = this.parseStatementBlock();
    }

    const node: TryNode = { kind: "try", tryBody, catches, finallyBody };
    node.span = this.makeSpan(startToken);
    return node;
  }

  /** Parse catch block */
  private parseCatchBlock(): CatchNode {
    const startToken = this.current();
    this.expect("KEYWORD", "catch");

    let error = "*";
    if (this.check("OPERATOR") && this.current().value === "*") {
      this.advance();
    } else if (this.check("IDENTIFIER") || this.check("KEYWORD")) {
      error = this.advance().value;
    }

    this.expect("COLON");
    this.expectNewline();

    const body: StatementNode[] = [];
    let action: CatchNode["action"];
    let retry: RetrySpec | undefined;

    if (this.check("INDENT")) {
      this.advance();
      while (!this.check("DEDENT") && !this.check("EOF")) {
        this.skipNewlines();
        if (this.check("DEDENT") || this.check("EOF")) break;

        if (
          (this.check("IDENTIFIER") || this.check("KEYWORD")) &&
          this.current().value === "action"
        ) {
          this.advance();
          this.expect("COLON");
          if (this.check("IDENTIFIER") || this.check("KEYWORD")) {
            action = this.advance().value as CatchNode["action"];
          } else if (this.check("STRING")) {
            action = this.advance().value as CatchNode["action"];
          }
          this.expectNewline();
          continue;
        }

        if (
          (this.check("IDENTIFIER") || this.check("KEYWORD")) &&
          this.current().value === "retry"
        ) {
          this.advance();
          this.expect("COLON");
          this.expectNewline();
          retry = this.parseRetrySpec();
          continue;
        }

        body.push(this.parseStatement());
        this.skipNewlines();
      }
      if (this.check("DEDENT")) this.advance();
    }

    const node: CatchNode = { kind: "catch", error, action, retry, body };
    node.span = this.makeSpan(startToken);
    return node;
  }

  /** Parse retry spec block */
  private parseRetrySpec(): RetrySpec {
    const startToken = this.current();
    let maxAttempts = 3;
    let backoff: RetrySpec["backoff"] = "none";
    let backoffBase: number | undefined;
    let maxBackoff: number | undefined;

    if (this.check("INDENT")) {
      this.advance();
      while (!this.check("DEDENT") && !this.check("EOF")) {
        this.skipNewlines();
        if (this.check("DEDENT") || this.check("EOF")) break;
        const key = this.expect("IDENTIFIER").value;
        this.expect("COLON");
        if (key === "max_attempts") {
          maxAttempts = Number.parseFloat(this.expect("NUMBER").value);
        } else if (key === "backoff") {
          if (this.check("IDENTIFIER") || this.check("KEYWORD")) {
            backoff = this.advance().value as RetrySpec["backoff"];
          } else if (this.check("STRING")) {
            backoff = this.advance().value as RetrySpec["backoff"];
          }
        } else if (key === "backoff_base") {
          backoffBase = Number.parseFloat(this.expect("NUMBER").value);
        } else if (key === "max_backoff") {
          maxBackoff = Number.parseFloat(this.expect("NUMBER").value);
        } else {
          this.parseExpression();
        }
        this.expectNewline();
      }
      if (this.check("DEDENT")) this.advance();
    }

    const node: RetrySpec = {
      kind: "retry",
      maxAttempts,
      backoff,
      backoffBase,
      maxBackoff,
    };
    node.span = this.makeSpan(startToken);
    return node;
  }

  /** Parse parallel statement */
  private parseParallelStatement(): ParallelNode {
    const startToken = this.current();
    this.expect("KEYWORD", "parallel");

    let join: ParallelJoinNode | undefined;
    let onFail: ParallelNode["onFail"] | undefined;

    // Optional header config before colon: join=..., on_fail=...
    while (!this.check("COLON") && !this.check("NEWLINE") && !this.check("EOF")) {
      if (!(this.check("IDENTIFIER") || this.check("KEYWORD"))) break;
      const key = this.advance().value;
      if (!this.check("ASSIGN")) break;
      this.advance();

      if (key === "join") {
        let joinType = "all";
        if (this.check("IDENTIFIER") || this.check("KEYWORD")) {
          joinType = this.advance().value;
        } else if (this.check("STRING")) {
          joinType = this.advance().value;
        }
        join = {
          kind: "parallel_join",
          type: joinType as ParallelJoinNode["type"],
        };
      } else if (key === "on_fail") {
        if (this.check("IDENTIFIER") || this.check("KEYWORD")) {
          onFail = this.advance().value as ParallelNode["onFail"];
        } else if (this.check("STRING")) {
          onFail = this.advance().value as ParallelNode["onFail"];
        }
      } else if (key === "metric") {
        if (!join) {
          join = { kind: "parallel_join", type: "best" };
        }
        join.metric = this.parseExpression();
      } else if (key === "order") {
        if (!join) {
          join = { kind: "parallel_join", type: "best" };
        }
        if (this.check("IDENTIFIER") || this.check("KEYWORD")) {
          join.order = this.advance().value as ParallelJoinNode["order"];
        }
      } else if (key === "count") {
        if (!join) {
          join = { kind: "parallel_join", type: "any" };
        }
        if (this.check("NUMBER")) {
          join.count = Number.parseFloat(this.advance().value);
        }
      } else {
        // Unknown header option, skip value
        this.parseExpression();
      }
    }

    this.expect("COLON");
    this.expectNewline();

    const branches: ParallelBranchNode[] = [];
    if (this.check("INDENT")) {
      this.advance();
      while (!this.check("DEDENT") && !this.check("EOF")) {
        this.skipNewlines();
        if (this.check("DEDENT") || this.check("EOF")) break;

        const name = this.expect("IDENTIFIER").value;
        this.expect("COLON");
        this.expectNewline();
        const body = this.parseStatementBlock();
        branches.push({ kind: "parallel_branch", name, body });
        this.skipNewlines();
      }
      if (this.check("DEDENT")) this.advance();
    }

    const node: ParallelNode = { kind: "parallel", join, onFail, branches };
    node.span = this.makeSpan(startToken);
    return node;
  }

  /** Parse pipeline after source expression */
  private parsePipeline(
    source: ExpressionNode,
    outputBinding: string | undefined,
    startToken: Token
  ): PipelineNode {
    const stages: PipelineStageNode[] = [];

    while (this.check("OPERATOR") && this.current().value === "|") {
      this.advance(); // consume |

      const opToken = this.expect("IDENTIFIER");
      const op = opToken.value as PipelineStageNode["op"];

      let initial: ExpressionNode | undefined;
      let count: number | undefined;
      let order: "asc" | "desc" | undefined;
      let by: ExpressionNode | undefined;

      // Optional args
      if (op === "reduce" && this.check("LPAREN")) {
        this.advance();
        initial = this.parseExpression();
        this.expect("RPAREN");
      } else if ((op === "take" || op === "skip") && this.check("NUMBER")) {
        count = Number.parseFloat(this.advance().value);
      } else if (op === "sort") {
        if (this.check("IDENTIFIER") && this.current().value === "by") {
          this.advance();
          by = this.parseExpression();
        }
        if (this.check("IDENTIFIER") && this.current().value === "order") {
          this.advance();
          if (this.check("IDENTIFIER") || this.check("KEYWORD")) {
            order = this.advance().value as "asc" | "desc";
          }
        }
      }

      this.expect("COLON");
      this.expectNewline();
      const body = this.parseStatementBlock();
      if (
        body.length === 0 &&
        (op === "map" || op === "filter" || op === "reduce" || op === "pmap")
      ) {
        throw new ParseError(`Pipeline stage '${op}' requires a body`, {
          location: opToken.location,
          source: this.source,
        });
      }

      const stageStep = (body[0] ?? ({ kind: "pass" } as PassNode)) as StatementNode;

      stages.push({
        kind: "pipeline_stage",
        op,
        step: stageStep,
        initial,
        count,
        order,
        by,
      });
    }

    const node: PipelineNode = { kind: "pipeline", source, stages, outputBinding };
    node.span = this.makeSpan(startToken);
    return node;
  }

  /** Parse do statement (block invocation) */
  private parseDoStatement(): DoNode {
    const startToken = this.current();
    this.expect("KEYWORD", "do");
    const nameParts: string[] = [];
    nameParts.push(this.expect("IDENTIFIER").value);
    while (this.check("DOT")) {
      this.advance();
      nameParts.push(this.expect("IDENTIFIER").value);
    }
    const name = nameParts.join(".");
    const args: ExpressionNode[] = [];

    if (this.check("LPAREN")) {
      this.advance();
      while (!this.check("RPAREN")) {
        args.push(this.parseExpression());
        if (this.check("COMMA")) this.advance();
      }
      this.expect("RPAREN");
    }

    this.expectNewline();
    const node: DoNode = { kind: "do", name, args };
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
      let advisor: string | undefined;
      if (this.check("KEYWORD", "via")) {
        this.advance();
        if (this.check("IDENTIFIER") || this.check("KEYWORD")) {
          advisor = this.advance().value;
        }
      }
      condition = { kind: "advisory_expr", prompt, advisor } as AdvisoryExpr;
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
        let key: string;
        if (this.check("IDENTIFIER") || this.check("KEYWORD")) {
          key = this.advance().value;
        } else {
          throw new ParseError(
            `Expected identifier in emit but got ${this.current().type} '${this.current().value}'`,
            { location: this.current().location, source: this.source }
          );
        }
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
      if (this.check("IDENTIFIER")) {
        const unit = this.advance().value;
        return { kind: "unit_literal", value, unit } as UnitLiteralNode;
      }
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
      let advisor: string | undefined;
      if (this.check("KEYWORD", "via")) {
        this.advance();
        if (this.check("IDENTIFIER") || this.check("KEYWORD")) {
          advisor = this.advance().value;
        }
      }
      return { kind: "advisory_expr", prompt: token.value, advisor } as AdvisoryExpr;
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
      "block",
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
