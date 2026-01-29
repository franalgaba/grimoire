import type { SpellSource } from "../../types/ir.js";
import type {
  AdvisoryExpr,
  AdvisoryNode,
  ArrayAccessNode,
  ArrayLiteralNode,
  AssignmentNode,
  AtomicNode,
  BinaryExprNode,
  CallExprNode,
  EmitNode,
  ExpressionNode,
  ForNode,
  HaltNode,
  IdentifierNode,
  IfNode,
  LiteralNode,
  MethodCallNode,
  ObjectLiteralNode,
  PercentageExpr,
  PropertyAccessNode,
  SectionNode,
  SpellAST,
  StatementNode,
  TriggerType,
  UnaryExprNode,
  VenueRefExpr,
  WaitNode,
} from "./ast.js";

// =============================================================================
// TRANSFORMER CLASS
// =============================================================================

export class Transformer {
  private stepCounter = 0;

  /** Transform AST to SpellSource */
  transform(ast: SpellAST): SpellSource {
    const source: SpellSource = {
      spell: ast.name,
      version: "1.0.0", // Default
    };

    // Process sections
    for (const section of ast.sections) {
      this.transformSection(section, source);
    }

    // Process triggers and their handlers
    if (ast.triggers.length > 0) {
      const trigger = ast.triggers[0];
      if (trigger) {
        source.trigger = this.transformTriggerType(trigger.trigger);
        source.steps = this.transformStatements(trigger.body);
      }
    }

    // Multiple triggers → any trigger
    if (ast.triggers.length > 1) {
      const triggers = ast.triggers.map((t) => this.transformTriggerType(t.trigger));
      source.trigger = { any: triggers as unknown as Array<Record<string, unknown>> };

      // Merge all steps (simplified - in practice we'd need more complex handling)
      source.steps = ast.triggers.flatMap((t) => this.transformStatements(t.body));
    }

    return source;
  }

  /** Transform a section to SpellSource fields */
  private transformSection(section: SectionNode, source: SpellSource): void {
    switch (section.kind) {
      case "version":
        source.version = section.value;
        break;

      case "description":
        source.description = section.value;
        break;

      case "assets":
        source.assets = {};
        for (const item of section.items) {
          source.assets[item.symbol] = {
            chain: item.chain ?? 1, // Default to mainnet
            address: item.address ?? `0x${item.symbol.toLowerCase()}`, // Placeholder
            decimals: item.decimals,
          };
        }
        break;

      case "params":
        source.params = {};
        for (const item of section.items) {
          source.params[item.name] = this.exprToValue(item.value);
        }
        break;

      case "limits":
        // Store limits as params
        if (!source.params) source.params = {};
        for (const item of section.items) {
          source.params[`limit_${item.name}`] = this.exprToValue(item.value);
        }
        break;

      case "venues":
        source.venues = {};
        for (const group of section.groups) {
          for (const venue of group.venues) {
            source.venues[venue.name] = {
              chain: venue.chain ?? 1,
              address: venue.address ?? `0x${venue.name}`,
              label: group.name,
            };
          }
        }
        break;

      case "state": {
        const state: Required<NonNullable<SpellSource["state"]>> = {
          persistent: source.state?.persistent ?? {},
          ephemeral: source.state?.ephemeral ?? {},
        };
        source.state = state;
        for (const item of section.persistent) {
          state.persistent[item.name] = this.exprToValue(item.initialValue);
        }
        for (const item of section.ephemeral) {
          state.ephemeral[item.name] = this.exprToValue(item.initialValue);
        }
        break;
      }
    }
  }

  /** Transform trigger type */
  private transformTriggerType(trigger: TriggerType): NonNullable<SpellSource["trigger"]> {
    switch (trigger.kind) {
      case "manual":
        return { manual: true };
      case "hourly":
        return { schedule: "0 * * * *" };
      case "daily":
        return { schedule: "0 0 * * *" };
      case "schedule":
        return { schedule: trigger.cron };
      case "condition":
        return {
          condition: this.exprToString(trigger.expression),
          poll_interval: trigger.pollInterval ?? 60,
        };
    }
  }

  /** Transform statements to step array */
  private transformStatements(statements: StatementNode[]): Array<Record<string, unknown>> {
    const steps: Array<Record<string, unknown>> = [];

    for (const stmt of statements) {
      const stmtSteps = this.transformStatement(stmt);
      steps.push(...stmtSteps);
    }

    return steps;
  }

  /** Transform a single statement */
  private transformStatement(stmt: StatementNode): Array<Record<string, unknown>> {
    switch (stmt.kind) {
      case "assignment":
        return this.transformAssignment(stmt);

      case "if":
        return this.transformIf(stmt);

      case "for":
        return this.transformFor(stmt);

      case "atomic":
        return this.transformAtomic(stmt);

      case "method_call":
        return this.transformMethodCall(stmt);

      case "emit":
        return this.transformEmit(stmt);

      case "halt":
        return this.transformHalt(stmt);

      case "wait":
        return this.transformWait(stmt);

      case "advisory":
        return this.transformAdvisory(stmt);

      case "pass":
        return [];

      default:
        return [];
    }
  }

  /** Transform assignment to compute step */
  private transformAssignment(stmt: AssignmentNode): Array<Record<string, unknown>> {
    const id = this.nextStepId("compute");
    return [
      {
        id,
        compute: {
          [stmt.target]: this.exprToString(stmt.value),
        },
      },
    ];
  }

  /** Transform if statement to conditional step */
  private transformIf(stmt: IfNode): Array<Record<string, unknown>> {
    const steps: Array<Record<string, unknown>> = [];
    const id = this.nextStepId("cond");

    // Check for advisory condition
    if (stmt.condition.kind === "advisory_expr") {
      const advisory = stmt.condition as AdvisoryExpr;
      const thenSteps = this.transformStatements(stmt.thenBody);
      const elseSteps = this.transformStatements(stmt.elseBody);

      // Advisory steps need special handling
      steps.push({
        id,
        advisory: {
          prompt: advisory.prompt,
          advisor: advisory.advisor ?? "default",
          output: `${id}_result`,
        },
      });

      // Add conditional based on advisory result
      const condId = this.nextStepId("cond");
      steps.push({
        id: condId,
        if: `${id}_result == true`,
        then: thenSteps.map((s) => s.id as string),
        else: elseSteps.map((s) => s.id as string),
      });

      steps.push(...thenSteps, ...elseSteps);
    } else {
      // Regular conditional
      const thenSteps = this.transformStatements(stmt.thenBody);
      const elseSteps = this.transformStatements(stmt.elseBody);

      steps.push({
        id,
        if: this.exprToString(stmt.condition),
        then: thenSteps.map((s) => s.id as string),
        else: elseSteps.map((s) => s.id as string),
      });

      steps.push(...thenSteps, ...elseSteps);
    }

    return steps;
  }

  /** Transform for loop to loop step */
  private transformFor(stmt: ForNode): Array<Record<string, unknown>> {
    const id = this.nextStepId("loop");
    const bodySteps = this.transformStatements(stmt.body);

    return [
      {
        id,
        for: `${stmt.variable} in ${this.exprToString(stmt.iterable)}`,
        steps: bodySteps.map((s) => s.id as string),
        max: stmt.maxIterations ?? 100,
      },
      ...bodySteps,
    ];
  }

  /** Transform atomic block to try step */
  private transformAtomic(stmt: AtomicNode): Array<Record<string, unknown>> {
    const id = this.nextStepId("atomic");
    const bodySteps = this.transformStatements(stmt.body);

    return [
      {
        id,
        try: bodySteps.map((s) => s.id as string),
        catch: [{ error: "*", action: stmt.onFailure ?? "revert" }],
      },
      ...bodySteps,
    ];
  }

  /** Transform method call to action step */
  private transformMethodCall(stmt: MethodCallNode): Array<Record<string, unknown>> {
    const id = this.nextStepId("action");

    // Determine action type from method name
    const method = stmt.method.toLowerCase();
    let actionType = method;

    // Map common method names to action types
    const methodMap: Record<string, string> = {
      deposit: "lend",
      supply: "lend",
      borrow: "borrow",
      repay: "repay",
      withdraw: "withdraw",
      stake: "stake",
      unstake: "unstake",
      claim: "claim",
      swap: "swap",
      bridge: "bridge",
      transfer: "transfer",
      get_supply_rates: "query", // Query operations
      get_rates: "query",
    };

    actionType = methodMap[method] ?? method;

    // Build action object
    const action: Record<string, unknown> = {
      type: actionType,
    };

    // Extract venue from object
    if (stmt.object.kind === "identifier") {
      action.venue = (stmt.object as IdentifierNode).name;
    } else if (stmt.object.kind === "venue_ref_expr") {
      action.venue = (stmt.object as VenueRefExpr).name;
    } else if (stmt.object.kind === "property_access") {
      // e.g., venues.lending
      const prop = stmt.object as PropertyAccessNode;
      if (prop.object.kind === "identifier" && (prop.object as IdentifierNode).name === "venues") {
        action.venue = prop.property;
      }
    }

    // Map arguments based on action type
    if (actionType === "lend" || actionType === "withdraw") {
      const assetArg = stmt.args[0];
      const amountArg = stmt.args[1];
      if (assetArg) {
        action.asset = this.exprToString(assetArg);
      }
      if (amountArg) {
        action.amount = this.exprToString(amountArg);
      }
    } else if (actionType === "bridge") {
      const assetArg = stmt.args[0];
      const amountArg = stmt.args[1];
      const chainArg = stmt.args[2];
      if (assetArg) {
        action.asset = this.exprToString(assetArg);
      }
      if (amountArg) {
        action.amount = this.exprToString(amountArg);
      }
      if (chainArg) {
        action.to_chain = this.exprToString(chainArg);
      }
    } else if (actionType === "swap") {
      const assetInArg = stmt.args[0];
      const assetOutArg = stmt.args[1];
      const amountArg = stmt.args[2];
      if (assetInArg && assetOutArg) {
        action.asset_in = this.exprToString(assetInArg);
        action.asset_out = this.exprToString(assetOutArg);
      }
      if (amountArg) {
        action.amount = this.exprToString(amountArg);
      }
    } else if (actionType === "query") {
      // Query operations become compute steps
      return [
        {
          id,
          compute: {
            [`${id}_result`]: `${this.exprToString(stmt.object)}.${stmt.method}(${stmt.args.map((a) => this.exprToString(a)).join(", ")})`,
          },
        },
      ];
    } else {
      // Generic mapping
      stmt.args.forEach((arg, i) => {
        action[`arg${i}`] = this.exprToString(arg);
      });
    }

    const step: Record<string, unknown> = {
      id,
      action,
    };

    if (stmt.outputBinding) {
      step.output = stmt.outputBinding;
    }

    return [step];
  }

  /** Transform emit to emit step */
  private transformEmit(stmt: EmitNode): Array<Record<string, unknown>> {
    const id = this.nextStepId("emit");
    const data: Record<string, string> = {};

    for (const { key, value } of stmt.data) {
      data[key] = this.exprToString(value);
    }

    return [
      {
        id,
        emit: {
          event: stmt.event,
          data,
        },
      },
    ];
  }

  /** Transform halt to halt step */
  private transformHalt(stmt: HaltNode): Array<Record<string, unknown>> {
    const id = this.nextStepId("halt");
    return [{ id, halt: stmt.reason }];
  }

  /** Transform wait to wait step */
  private transformWait(stmt: WaitNode): Array<Record<string, unknown>> {
    const id = this.nextStepId("wait");
    return [{ id, wait: stmt.duration }];
  }

  /** Transform advisory */
  private transformAdvisory(stmt: AdvisoryNode): Array<Record<string, unknown>> {
    const id = this.nextStepId("advisory");
    const thenSteps = this.transformStatements(stmt.thenBody);
    const elseSteps = this.transformStatements(stmt.elseBody);

    return [
      {
        id,
        advisory: {
          prompt: stmt.prompt,
          advisor: stmt.advisor ?? "default",
          timeout: stmt.timeout ?? 30,
          fallback: stmt.fallback ?? true,
        },
      },
      ...thenSteps,
      ...elseSteps,
    ];
  }

  /** Convert expression to string representation */
  private exprToString(expr: ExpressionNode): string {
    switch (expr.kind) {
      case "literal": {
        const lit = expr as LiteralNode;
        if (lit.literalType === "string") {
          return `"${lit.value}"`;
        }
        return String(lit.value);
      }

      case "identifier":
        return (expr as IdentifierNode).name;

      case "venue_ref_expr":
        return `@${(expr as VenueRefExpr).name}`;

      case "advisory_expr":
        return `**${(expr as AdvisoryExpr).prompt}**`;

      case "percentage":
        return String((expr as PercentageExpr).value);

      case "binary": {
        const bin = expr as BinaryExprNode;
        const op = bin.op === "and" ? "AND" : bin.op === "or" ? "OR" : bin.op;
        return `(${this.exprToString(bin.left)} ${op} ${this.exprToString(bin.right)})`;
      }

      case "unary": {
        const un = expr as UnaryExprNode;
        const op = un.op === "not" ? "NOT " : un.op;
        return `${op}${this.exprToString(un.arg)}`;
      }

      case "call": {
        const call = expr as CallExprNode;
        const callee = this.exprToString(call.callee);
        const args = call.args.map((a) => this.exprToString(a)).join(", ");
        return `${callee}(${args})`;
      }

      case "property_access": {
        const prop = expr as PropertyAccessNode;
        return `${this.exprToString(prop.object)}.${prop.property}`;
      }

      case "array_access": {
        const arr = expr as ArrayAccessNode;
        return `${this.exprToString(arr.array)}[${this.exprToString(arr.index)}]`;
      }

      case "array_literal": {
        const arrLit = expr as ArrayLiteralNode;
        return `[${arrLit.elements.map((e) => this.exprToString(e)).join(", ")}]`;
      }

      case "object_literal": {
        const objLit = expr as ObjectLiteralNode;
        const entries = objLit.entries.map((e) => `${e.key}: ${this.exprToString(e.value)}`);
        return `{${entries.join(", ")}}`;
      }

      case "ternary": {
        const tern = expr as {
          kind: "ternary";
          condition: ExpressionNode;
          thenExpr: ExpressionNode;
          elseExpr: ExpressionNode;
        };
        return `(${this.exprToString(tern.condition)} ? ${this.exprToString(tern.thenExpr)} : ${this.exprToString(tern.elseExpr)})`;
      }

      default:
        return "";
    }
  }

  /** Convert expression to runtime value */
  private exprToValue(expr: ExpressionNode): unknown {
    switch (expr.kind) {
      case "literal":
        return (expr as LiteralNode).value;

      case "percentage":
        return (expr as PercentageExpr).value;

      case "array_literal":
        return (expr as ArrayLiteralNode).elements.map((e) => this.exprToValue(e));

      case "object_literal": {
        const obj: Record<string, unknown> = {};
        for (const entry of (expr as ObjectLiteralNode).entries) {
          obj[entry.key] = this.exprToValue(entry.value);
        }
        return obj;
      }

      default:
        // For expressions, return string representation
        return this.exprToString(expr);
    }
  }

  /** Generate next step ID */
  private nextStepId(prefix: string): string {
    return `${prefix}_${++this.stepCounter}`;
  }
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Transform Grimoire AST to SpellSource
 */
export function transform(ast: SpellAST): SpellSource {
  const transformer = new Transformer();
  return transformer.transform(ast);
}
