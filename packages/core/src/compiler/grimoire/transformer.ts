import { readFileSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import type { SpellSource } from "../../types/ir.js";
import type {
  AdviseNode,
  AdvisorsSection,
  AdvisoryNode,
  AdvisoryOutputSchemaNode,
  ArrayAccessNode,
  ArrayLiteralNode,
  AssignmentNode,
  AtomicNode,
  BinaryExprNode,
  BlockDef,
  CallExprNode,
  DoNode,
  EmitNode,
  ExpressionNode,
  ForNode,
  GuardsSection,
  HaltNode,
  IdentifierNode,
  IfNode,
  ImportNode,
  LiteralNode,
  MethodCallNode,
  ObjectLiteralNode,
  ParallelNode,
  PercentageExpr,
  PipelineNode,
  PropertyAccessNode,
  RepeatNode,
  SectionNode,
  SkillsSection,
  SpellAST,
  StatementNode,
  TriggerType,
  TryNode,
  UnaryExprNode,
  UnitLiteralNode,
  UntilNode,
  VenueRefExpr,
  WaitNode,
} from "./ast.js";
import { TransformError } from "./errors.js";
import { parse } from "./parser.js";

const INLINE_ADVISORY_UNSUPPORTED_MESSAGE =
  "Inline advisory expressions (**...**) are no longer supported. Use explicit advise bindings.";

// =============================================================================
// TRANSFORMER CLASS
// =============================================================================

export class Transformer {
  private stepCounter = 0;
  private blockMap = new Map<string, BlockDef>();
  private assetDecimals = new Map<string, number | undefined>();
  private venueLabelMap = new Map<string, Set<string>>();
  private importStack: string[] = [];

  /** Transform AST to SpellSource */
  transform(ast: SpellAST, options?: { filePath?: string }): SpellSource {
    const source: SpellSource = {
      spell: ast.name,
      version: "1.0.0", // Default
    };

    // Pre-scan assets for unit conversion
    for (const section of ast.sections) {
      if (section.kind !== "assets") continue;
      for (const item of section.items) {
        this.assetDecimals.set(item.symbol, item.decimals);
      }
    }

    // Pre-scan venues to resolve skill adapters that reference venue labels
    for (const section of ast.sections) {
      if (section.kind !== "venues") continue;
      for (const group of section.groups) {
        const set = this.venueLabelMap.get(group.name) ?? new Set<string>();
        for (const venue of group.venues) {
          set.add(venue.name);
        }
        this.venueLabelMap.set(group.name, set);
      }
    }

    // Resolve imports before local blocks
    if (options?.filePath && ast.imports?.length) {
      this.loadImports(ast.imports, dirname(options.filePath));
    }

    // Register blocks for do-invocations
    for (const block of ast.blocks ?? []) {
      if (this.blockMap.has(block.name)) {
        throw new Error(`Duplicate block name '${block.name}'`);
      }
      this.blockMap.set(block.name, block);
    }

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

  private loadImports(imports: ImportNode[], baseDir: string, prefix = ""): void {
    for (const imp of imports) {
      const importPath = resolve(baseDir, imp.path);
      if (this.importStack.includes(importPath)) {
        const cycle = [...this.importStack, importPath].join(" -> ");
        throw new Error(`Import cycle detected: ${cycle}`);
      }

      const source = readFileSync(importPath, "utf8");
      const ast = parse(source);
      const alias =
        imp.alias && imp.alias.length > 0 ? imp.alias : basename(importPath, extname(importPath));
      const namespace = prefix ? `${prefix}.${alias}` : alias;

      this.importStack.push(importPath);

      // Register imported blocks with namespace
      for (const block of ast.blocks ?? []) {
        const name = namespace ? `${namespace}.${block.name}` : block.name;
        if (this.blockMap.has(name)) {
          throw new Error(`Duplicate block name '${name}' from import '${imp.path}'`);
        }
        this.blockMap.set(name, { ...block, name });
      }

      if (ast.imports?.length) {
        this.loadImports(ast.imports, dirname(importPath), namespace);
      }

      this.importStack.pop();
    }
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
        source.params = source.params ?? {};
        for (const item of section.items) {
          if (item.type || item.min !== undefined || item.max !== undefined || item.asset) {
            source.params[item.name] = {
              type: item.type,
              asset: item.asset,
              default: item.value !== undefined ? this.exprToValue(item.value) : undefined,
              min: item.min,
              max: item.max,
            };
          } else if (item.value !== undefined) {
            source.params[item.name] = this.exprToValue(item.value);
          } else {
            source.params[item.name] = undefined;
          }
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

      case "skills": {
        const skillsSection = section as SkillsSection;
        source.skills = source.skills ?? {};
        for (const item of skillsSection.items) {
          const resolvedAdapters: string[] = [];
          for (const adapter of item.adapters) {
            const byLabel = this.venueLabelMap.get(adapter);
            if (byLabel && byLabel.size > 0) {
              for (const alias of byLabel) resolvedAdapters.push(alias);
              continue;
            }
            resolvedAdapters.push(adapter);
          }
          source.skills[item.name] = {
            type: item.type,
            adapters: Array.from(new Set(resolvedAdapters)),
            default_constraints: item.defaultConstraints?.maxSlippage
              ? { max_slippage: this.exprToValue(item.defaultConstraints.maxSlippage) as number }
              : undefined,
          };
        }
        break;
      }

      case "advisors": {
        const advisorsSection = section as AdvisorsSection;
        source.advisors = source.advisors ?? {};
        for (const item of advisorsSection.items) {
          source.advisors[item.name] = {
            model: item.model,
            system_prompt: item.systemPrompt,
            skills: item.skills,
            allowed_tools: item.allowedTools,
            mcp: item.mcp,
            timeout: item.timeout,
            fallback: item.fallback,
            rate_limit:
              item.maxPerRun || item.maxPerHour
                ? { max_per_run: item.maxPerRun, max_per_hour: item.maxPerHour }
                : undefined,
          };
        }
        break;
      }

      case "guards": {
        const guardsSection = section as GuardsSection;
        source.guards = guardsSection.items.map((item) => {
          if (item.check.kind === "advisory_expr") {
            throw new Error(INLINE_ADVISORY_UNSUPPORTED_MESSAGE);
          }
          return {
            id: item.id,
            check: this.exprToString(item.check),
            severity: item.severity ?? "halt",
            message: item.message,
          };
        });
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
      case "event":
        return {
          event: trigger.event,
          filter: trigger.filter ? this.exprToString(trigger.filter) : undefined,
        };
    }
  }

  /** Transform statements to step array */
  private transformStatements(statements: StatementNode[]): Array<Record<string, unknown>> {
    const steps: Array<Record<string, unknown>> = [];

    for (const stmt of statements) {
      const stmtSteps = this.transformStatement(stmt);
      // Attach source location from AST span to the first step produced by this statement
      if (stmt.span && stmtSteps.length > 0) {
        const firstStep = stmtSteps[0];
        if (firstStep) {
          firstStep._sourceLocation = {
            line: stmt.span.start.line,
            column: stmt.span.start.column,
          };
        }
      }
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

      case "repeat":
        return this.transformRepeat(stmt as RepeatNode);

      case "until":
        return this.transformUntil(stmt as UntilNode);

      case "try":
        return this.transformTry(stmt as TryNode);

      case "parallel":
        return this.transformParallel(stmt as ParallelNode);

      case "pipeline":
        return this.transformPipeline(stmt as PipelineNode);

      case "advise":
        return this.transformAdvise(stmt as AdviseNode);

      case "do":
        return this.transformDo(stmt as DoNode);

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

  /** Transform assignment to compute step, or action step if RHS is a venue method call */
  private transformAssignment(stmt: AssignmentNode): Array<Record<string, unknown>> {
    // Check if RHS is a method call (venue action with output binding)
    if (stmt.value.kind === "call") {
      const callExpr = stmt.value as CallExprNode;
      if (callExpr.callee.kind === "property_access") {
        const prop = callExpr.callee as PropertyAccessNode;
        const methodCall: MethodCallNode = {
          kind: "method_call",
          object: prop.object,
          method: prop.property,
          args: callExpr.args,
          outputBinding: stmt.target,
          skill: stmt.skill,
        };
        if (stmt.constraints) {
          methodCall.constraints = stmt.constraints;
        }
        return this.transformMethodCall(methodCall);
      }
    }

    // Default: compute step
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

    // Inline advisory expressions are intentionally unsupported.
    if (stmt.condition.kind === "advisory_expr") {
      throw new Error(INLINE_ADVISORY_UNSUPPORTED_MESSAGE);
    }

    // Regular conditional
    const thenSteps = this.transformStatements(stmt.thenBody);

    if (stmt.elifs && stmt.elifs.length > 0) {
      // Build elif chain as nested conditionals (from last to first)
      let elseChainSteps = this.transformStatements(stmt.elseBody);
      let elseChainIds = elseChainSteps.map((s) => s.id as string);

      for (let i = stmt.elifs.length - 1; i >= 0; i--) {
        const elif = stmt.elifs[i];
        if (!elif) continue;
        const elifId = this.nextStepId("cond");
        const elifThenSteps = this.transformStatements(elif.body);

        const elifCond: Record<string, unknown> = {
          id: elifId,
          if: this.exprToString(elif.condition),
          then: elifThenSteps.map((s) => s.id as string),
          else: elseChainIds,
        };

        elseChainSteps = [elifCond, ...elifThenSteps, ...elseChainSteps];
        elseChainIds = [elifId];
      }

      steps.push({
        id,
        if: this.exprToString(stmt.condition),
        then: thenSteps.map((s) => s.id as string),
        else: elseChainIds,
      });

      steps.push(...thenSteps, ...elseChainSteps);
    } else {
      // Simple if/else (no elif)
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

  /** Transform repeat loop to loop step */
  private transformRepeat(stmt: RepeatNode): Array<Record<string, unknown>> {
    const id = this.nextStepId("loop");
    const bodySteps = this.transformStatements(stmt.body);
    const countValue = this.exprToValue(stmt.count);
    const count =
      typeof countValue === "number" ? countValue : Number.parseFloat(String(countValue));

    return [
      {
        id,
        repeat: count,
        steps: bodySteps.map((s) => s.id as string),
        max: count,
      },
      ...bodySteps,
    ];
  }

  /** Transform until loop to loop step */
  private transformUntil(stmt: UntilNode): Array<Record<string, unknown>> {
    const id = this.nextStepId("loop");
    const bodySteps = this.transformStatements(stmt.body);

    return [
      {
        id,
        loop: {
          until: this.exprToString(stmt.condition),
          max: stmt.maxIterations ?? 100,
        },
        steps: bodySteps.map((s) => s.id as string),
        max: stmt.maxIterations ?? 100,
      },
      ...bodySteps,
    ];
  }

  /** Transform try/catch/finally to try step */
  private transformTry(stmt: TryNode): Array<Record<string, unknown>> {
    const id = this.nextStepId("try");
    const trySteps = this.transformStatements(stmt.tryBody);

    const catchBlocks: Array<Record<string, unknown>> = [];
    const catchSteps: Array<Record<string, unknown>> = [];

    for (const c of stmt.catches) {
      const steps = this.transformStatements(c.body);
      catchSteps.push(...steps);
      const block: Record<string, unknown> = {
        error: c.error,
        steps: steps.map((s) => s.id as string),
      };
      if (c.action) block.action = c.action;
      if (c.retry) {
        block.retry = {
          maxAttempts: c.retry.maxAttempts,
          backoff: c.retry.backoff,
          backoffBase: c.retry.backoffBase,
          maxBackoff: c.retry.maxBackoff,
        };
      }
      catchBlocks.push(block);
    }

    const finallySteps = stmt.finallyBody ? this.transformStatements(stmt.finallyBody) : [];

    return [
      {
        id,
        try: trySteps.map((s) => s.id as string),
        catch: catchBlocks,
        finally: finallySteps.map((s) => s.id as string),
      },
      ...trySteps,
      ...catchSteps,
      ...finallySteps,
    ];
  }

  /** Transform parallel block */
  private transformParallel(stmt: ParallelNode): Array<Record<string, unknown>> {
    const id = this.nextStepId("parallel");
    const branches: Array<{ name: string; steps: string[] }> = [];
    const branchSteps: Array<Record<string, unknown>> = [];

    for (const branch of stmt.branches) {
      const steps = this.transformStatements(branch.body);
      branchSteps.push(...steps);
      branches.push({ name: branch.name, steps: steps.map((s) => s.id as string) });
    }

    const join: Record<string, unknown> | undefined = stmt.join
      ? {
          type: stmt.join.type,
          metric: stmt.join.metric ? this.exprToString(stmt.join.metric) : undefined,
          order: stmt.join.order,
          count: stmt.join.count,
        }
      : undefined;

    return [
      {
        id,
        parallel: {
          branches,
          join,
          on_fail: stmt.onFail ?? "abort",
        },
      },
      ...branchSteps,
    ];
  }

  /** Transform pipeline statement */
  private transformPipeline(stmt: PipelineNode): Array<Record<string, unknown>> {
    const id = this.nextStepId("pipeline");
    const stages: Array<Record<string, unknown>> = [];
    const stageSteps: Array<Record<string, unknown>> = [];
    let parallel = false;

    for (const stage of stmt.stages) {
      let op = stage.op === "pmap" ? "map" : stage.op;
      if (op === "where") op = "filter";
      if (stage.op === "pmap") parallel = true;

      // Stages without step bodies
      if (op === "take" || op === "skip" || op === "sort") {
        const entry: Record<string, unknown> = { op };
        if (stage.count !== undefined) entry.count = stage.count;
        if (stage.order) entry.order = stage.order;
        if (stage.by) entry.by = this.exprToString(stage.by);
        stages.push(entry);
        continue;
      }

      const steps = this.transformStatement(stage.step);
      if (steps.length === 0) continue;
      stageSteps.push(...steps);
      const stepId = steps[0]?.id as string;

      const entry: Record<string, unknown> = { op, step: stepId };
      if (stage.initial) {
        entry.initial = this.exprToString(stage.initial);
      }
      stages.push(entry);
    }

    return [
      {
        id,
        pipeline: {
          source: this.exprToString(stmt.source),
          stages,
          parallel,
        },
        output: stmt.outputBinding,
      },
      ...stageSteps,
    ];
  }

  /** Transform advise statement */
  private transformAdvise(stmt: AdviseNode): Array<Record<string, unknown>> {
    const id = this.nextStepId("advisory");
    return [
      {
        id,
        advisory: {
          prompt: stmt.prompt,
          advisor: stmt.advisor,
          context: stmt.context
            ? Object.fromEntries(
                Object.entries(stmt.context).map(([key, value]) => [key, this.exprToString(value)])
              )
            : undefined,
          within: stmt.within,
          output: stmt.target,
          on_violation: stmt.onViolationExplicit ? (stmt.onViolation ?? "reject") : undefined,
          on_violation_explicit: stmt.onViolationExplicit ?? false,
          clamp_constraints: stmt.clampConstraints,
          timeout: stmt.timeout,
          fallback: this.exprToFallback(stmt.fallback),
          output_schema: this.serializeOutputSchema(stmt.outputSchema),
        },
      },
    ];
  }

  private exprToFallback(expr: ExpressionNode): unknown {
    switch (expr.kind) {
      case "literal":
      case "array_literal":
      case "object_literal":
      case "percentage":
      case "unit_literal":
        return { __literal: this.exprToValue(expr) };
      default:
        return { __expr: this.exprToString(expr) };
    }
  }

  /** Transform block invocation */
  private transformDo(stmt: DoNode): Array<Record<string, unknown>> {
    const block = this.blockMap.get(stmt.name);
    if (!block) {
      throw new TransformError(`Unknown block '${stmt.name}' in do invocation`, {
        location: stmt.span?.start,
        span: stmt.span,
      });
    }
    if (block.params.length !== stmt.args.length) {
      throw new TransformError(
        `Block '${stmt.name}' expects ${block.params.length} args, got ${stmt.args.length}`,
        {
          location: stmt.span?.start,
          span: stmt.span,
        }
      );
    }

    const assignments: AssignmentNode[] = block.params.map((param, i) => ({
      kind: "assignment",
      target: param,
      value: stmt.args[i] as ExpressionNode,
    }));

    return this.transformStatements([...assignments, ...block.body]);
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
    let customOp: string | undefined;

    // Map common method names to action types
    const methodMap: Record<string, string> = {
      lend: "lend",
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
      add_liquidity: "add_liquidity",
      add_liquidity_dual: "add_liquidity_dual",
      remove_liquidity: "remove_liquidity",
      remove_liquidity_dual: "remove_liquidity_dual",
      mint_py: "mint_py",
      redeem_py: "redeem_py",
      mint_sy: "mint_sy",
      redeem_sy: "redeem_sy",
      transfer_liquidity: "transfer_liquidity",
      roll_over_pt: "roll_over_pt",
      rollover_pt: "roll_over_pt",
      exit_market: "exit_market",
      convert_lp_to_pt: "convert_lp_to_pt",
      pendle_swap: "pendle_swap",
      get_supply_rates: "query", // Query operations
      get_rates: "query",
    };

    const mappedActionType = methodMap[method];
    if (mappedActionType) {
      actionType = mappedActionType;
    } else {
      actionType = "custom";
      customOp = stmt.method;
    }

    // Build action object
    const action: Record<string, unknown> = { type: actionType };
    if (actionType === "custom" && customOp) {
      action.op = customOp;
    }

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
    const pendleSingleInputActions = new Set([
      "add_liquidity",
      "remove_liquidity",
      "mint_py",
      "redeem_py",
      "mint_sy",
      "redeem_sy",
      "roll_over_pt",
      "convert_lp_to_pt",
    ]);
    const pendleMultiInputActions = new Set([
      "add_liquidity_dual",
      "remove_liquidity_dual",
      "transfer_liquidity",
      "exit_market",
      "pendle_swap",
    ]);

    if (
      actionType === "lend" ||
      actionType === "withdraw" ||
      actionType === "repay" ||
      actionType === "stake" ||
      actionType === "unstake"
    ) {
      const assetArg = stmt.args[0];
      const amountArg = stmt.args[1];
      if (assetArg) {
        action.asset = this.exprToString(assetArg);
      }
      if (amountArg) {
        action.amount = this.exprToString(amountArg);
      }
    } else if (actionType === "borrow") {
      const assetArg = stmt.args[0];
      const amountArg = stmt.args[1];
      const collateralArg = stmt.args[2];
      if (assetArg) {
        action.asset = this.exprToString(assetArg);
      }
      if (amountArg) {
        action.amount = this.exprToString(amountArg);
      }
      if (collateralArg) {
        action.collateral = this.exprToString(collateralArg);
      }
    } else if (actionType === "claim") {
      const assetArg = stmt.args[0];
      if (assetArg) {
        action.asset = this.exprToString(assetArg);
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
    } else if (actionType === "transfer") {
      const assetArg = stmt.args[0];
      const amountArg = stmt.args[1];
      const toArg = stmt.args[2];
      if (assetArg) {
        action.asset = this.exprToString(assetArg);
      }
      if (amountArg) {
        action.amount = this.exprToString(amountArg);
      }
      if (toArg) {
        action.to = this.exprToString(toArg);
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
    } else if (pendleSingleInputActions.has(actionType)) {
      const assetArg = stmt.args[0];
      const amountArg = stmt.args[1];
      const outputArg = stmt.args[2];
      const keepYtArg = stmt.args[3];

      if (assetArg) {
        action.asset = this.exprToString(assetArg);
      }
      if (amountArg) {
        action.amount = this.exprToString(amountArg);
      }
      if (outputArg) {
        if (outputArg.kind === "array_literal") {
          action.outputs = this.exprToValue(outputArg);
        } else {
          action.asset_out = this.exprToString(outputArg);
        }
      }

      if (actionType === "add_liquidity") {
        if (keepYtArg && keepYtArg.kind !== "object_literal") {
          action.keep_yt = this.exprToValue(keepYtArg);
        }
        const optionsArg =
          keepYtArg?.kind === "object_literal" ? keepYtArg : (stmt.args[4] ?? undefined);
        this.applyPendleActionOptions(action, optionsArg);
      } else {
        this.applyPendleActionOptions(action, stmt.args[3]);
      }
    } else if (pendleMultiInputActions.has(actionType)) {
      const inputsArg = stmt.args[0];
      const outputsArg = stmt.args[1];
      const keepYtArg = stmt.args[2];

      if (inputsArg) {
        action.inputs = this.exprToValue(inputsArg);
      }
      if (outputsArg) {
        const outputValue = this.exprToValue(outputsArg);
        if (Array.isArray(outputValue)) {
          action.outputs = outputValue;
        } else {
          action.outputs = [this.exprToString(outputsArg)];
        }
      }

      if (actionType === "add_liquidity_dual" || actionType === "transfer_liquidity") {
        if (keepYtArg && keepYtArg.kind !== "object_literal") {
          action.keep_yt = this.exprToValue(keepYtArg);
        }
        const optionsArg =
          keepYtArg?.kind === "object_literal" ? keepYtArg : (stmt.args[3] ?? undefined);
        this.applyPendleActionOptions(action, optionsArg);
      } else {
        this.applyPendleActionOptions(action, stmt.args[2]);
      }
    } else if (actionType === "custom") {
      const args = this.buildCustomArgs(stmt);
      action.args = args;
    }

    const step: Record<string, unknown> = {
      id,
      action,
    };

    if (stmt.skill) {
      step.skill = stmt.skill;
    }

    if (stmt.outputBinding) {
      step.output = stmt.outputBinding;
    }

    if (stmt.constraints) {
      const constraints: Record<string, unknown> = {};
      for (const { key, value } of stmt.constraints.constraints) {
        const constraintKey =
          key === "slippage"
            ? "max_slippage"
            : key === "min_out"
              ? "min_output"
              : key === "max_in"
                ? "max_input"
                : key;
        constraints[constraintKey] = this.exprToValue(value);
      }
      step.constraints = constraints;
    }

    return [step];
  }

  private buildCustomArgs(stmt: MethodCallNode): Record<string, unknown> {
    if (stmt.method.toLowerCase() === "order") {
      return this.buildOrderCustomArgs(stmt);
    }
    if (stmt.method.toLowerCase() === "convert") {
      return this.buildConvertCustomArgs(stmt);
    }

    const args: Record<string, unknown> = {};
    stmt.args.forEach((arg, i) => {
      args[`arg${i}`] = this.exprToString(arg);
    });
    return args;
  }

  private buildOrderCustomArgs(stmt: MethodCallNode): Record<string, unknown> {
    const args: Record<string, unknown> = {};

    const coinArg = stmt.args[0];
    const priceArg = stmt.args[1];
    const sizeArg = stmt.args[2];
    const sideArg = stmt.args[3];
    const reduceOnlyArg = stmt.args[4];
    const orderTypeArg = stmt.args[5];

    if (coinArg) args.coin = this.exprToValue(coinArg);
    if (priceArg) args.price = this.exprToValue(priceArg);
    if (sizeArg) args.size = this.exprToValue(sizeArg);
    if (sideArg) args.side = this.exprToValue(sideArg);
    if (reduceOnlyArg) args.reduce_only = this.exprToValue(reduceOnlyArg);
    if (orderTypeArg) args.order_type = this.exprToValue(orderTypeArg);

    return args;
  }

  private buildConvertCustomArgs(stmt: MethodCallNode): Record<string, unknown> {
    const args: Record<string, unknown> = {};
    const tokensInArg = stmt.args[0];
    const amountsInArg = stmt.args[1];
    const tokensOutArg = stmt.args[2];
    const receiverArg = stmt.args[3];
    const enableAggregatorArg = stmt.args[4];
    const aggregatorsArg = stmt.args[5];
    const redeemRewardsArg = stmt.args[6];
    const needScaleArg = stmt.args[7];
    const additionalDataArg = stmt.args[8];
    const useLimitOrderArg = stmt.args[9];

    if (tokensInArg) args.tokens_in = this.exprToValue(tokensInArg);
    if (amountsInArg) args.amounts_in = this.exprToValue(amountsInArg);
    if (tokensOutArg) args.tokens_out = this.exprToValue(tokensOutArg);
    if (receiverArg) args.receiver = this.exprToValue(receiverArg);
    if (enableAggregatorArg) args.enable_aggregator = this.exprToValue(enableAggregatorArg);
    if (aggregatorsArg) args.aggregators = this.exprToValue(aggregatorsArg);
    if (redeemRewardsArg) args.redeem_rewards = this.exprToValue(redeemRewardsArg);
    if (needScaleArg) args.need_scale = this.exprToValue(needScaleArg);
    if (additionalDataArg) args.additional_data = this.exprToValue(additionalDataArg);
    if (useLimitOrderArg) args.use_limit_order = this.exprToValue(useLimitOrderArg);

    return args;
  }

  private applyPendleActionOptions(
    action: Record<string, unknown>,
    optionsArg: ExpressionNode | undefined
  ): void {
    if (!optionsArg || optionsArg.kind !== "object_literal") {
      return;
    }

    const options = this.exprToValue(optionsArg);
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      return;
    }

    const record = options as Record<string, unknown>;
    const enableAggregator = record.enable_aggregator ?? record.enableAggregator;
    const aggregators = record.aggregators;
    const needScale = record.need_scale ?? record.needScale;
    const redeemRewards = record.redeem_rewards ?? record.redeemRewards;
    const additionalData = record.additional_data ?? record.additionalData;
    const useLimitOrder = record.use_limit_order ?? record.useLimitOrder;

    if (enableAggregator !== undefined) action.enable_aggregator = enableAggregator;
    if (aggregators !== undefined) action.aggregators = aggregators;
    if (needScale !== undefined) action.need_scale = needScale;
    if (redeemRewards !== undefined) action.redeem_rewards = redeemRewards;
    if (additionalData !== undefined) action.additional_data = additionalData;
    if (useLimitOrder !== undefined) action.use_limit_order = useLimitOrder;
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
    void stmt;
    throw new Error(INLINE_ADVISORY_UNSUPPORTED_MESSAGE);
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
        throw new Error(INLINE_ADVISORY_UNSUPPORTED_MESSAGE);

      case "percentage":
        return String((expr as PercentageExpr).value);

      case "unit_literal": {
        const raw = this.unitLiteralToRaw(expr as UnitLiteralNode);
        return String(raw);
      }

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

      case "unit_literal":
        return this.unitLiteralToRaw(expr as UnitLiteralNode);

      case "array_literal":
        return (expr as ArrayLiteralNode).elements.map((e) => this.exprToValue(e));

      case "object_literal": {
        const obj: Record<string, unknown> = {};
        for (const entry of (expr as ObjectLiteralNode).entries) {
          obj[entry.key] = this.exprToValue(entry.value);
        }
        return obj;
      }

      case "unary": {
        const un = expr as UnaryExprNode;
        if (un.arg.kind === "literal") {
          const lit = un.arg as LiteralNode;
          if (un.op === "-" && typeof lit.value === "number") {
            return -lit.value;
          }
          if (un.op === "not") {
            return !lit.value;
          }
        }
        if (un.arg.kind === "unit_literal") {
          const raw = this.unitLiteralToRaw(un.arg as UnitLiteralNode);
          if (un.op === "-") {
            return -raw;
          }
        }
        return this.exprToString(expr);
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

  private unitLiteralToRaw(expr: UnitLiteralNode): number {
    const unit = expr.unit;
    if (unit === "bps" || unit === "bp") {
      return expr.value;
    }

    if (!this.assetDecimals.has(unit)) {
      throw new Error(`Unknown asset '${unit}' for unit literal`);
    }
    const decimals = this.assetDecimals.get(unit);
    if (decimals === undefined) {
      throw new Error(`Asset '${unit}' is missing decimals for unit literal conversion`);
    }
    const multiplier = 10 ** decimals;
    return Math.floor(expr.value * multiplier);
  }

  private serializeOutputSchema(schema: AdvisoryOutputSchemaNode): Record<string, unknown> {
    const fields =
      schema.fields &&
      Object.fromEntries(
        Object.entries(schema.fields).map(([key, value]) => [
          key,
          this.serializeOutputSchema(value),
        ])
      );
    return {
      type: schema.type,
      values: schema.values,
      min: schema.min,
      max: schema.max,
      min_length: schema.minLength,
      max_length: schema.maxLength,
      pattern: schema.pattern,
      fields,
      items: schema.items ? this.serializeOutputSchema(schema.items) : undefined,
    };
  }
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Transform Grimoire AST to SpellSource
 */
export function transform(ast: SpellAST, options?: { filePath?: string }): SpellSource {
  const transformer = new Transformer();
  return transformer.transform(ast, options);
}
