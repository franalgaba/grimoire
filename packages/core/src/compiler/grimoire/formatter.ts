import type {
  AdvisorItem,
  AdvisorsSection,
  AdvisoryOutputSchemaNode,
  AssetItem,
  AssetsSection,
  AssignmentNode,
  AtomicNode,
  BlockDef,
  CatchNode,
  ConstraintClause,
  DoNode,
  EmitNode,
  ExpressionNode,
  ForNode,
  GuardItem,
  GuardsSection,
  HaltNode,
  IfNode,
  ImportNode,
  LimitItem,
  LimitsSection,
  MethodCallNode,
  ParallelNode,
  ParamItem,
  ParamsSection,
  PipelineNode,
  RepeatNode,
  SectionNode,
  SkillItem,
  SkillsSection,
  SpellAST,
  StateItem,
  StatementNode,
  StateSection,
  TriggerHandler,
  TriggerType,
  TryNode,
  UntilNode,
  VenueGroup,
  VenuesSection,
  VersionSection,
  WaitNode,
} from "./ast.js";
import { GrimoireError } from "./errors.js";
import { parse } from "./parser.js";

export interface GrimoireFormatError {
  code: string;
  message: string;
  line?: number;
  column?: number;
}

export interface GrimoireFormatResult {
  success: boolean;
  formatted?: string;
  error?: GrimoireFormatError;
}

export function formatGrimoire(source: string): GrimoireFormatResult {
  try {
    const ast = parse(source);
    return {
      success: true,
      formatted: new GrimoireFormatter().format(ast),
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const grimoireError = error instanceof GrimoireError ? error : undefined;
    return {
      success: false,
      error: {
        code: grimoireError?.code ?? "ERR_FORMAT_RUNTIME",
        message: err.message,
        line: grimoireError?.location?.line,
        column: grimoireError?.location?.column,
      },
    };
  }
}

const PRECEDENCE = {
  TERNARY: 1,
  UNARY: 8,
  POSTFIX: 9,
} as const;

const INDENT = "  ";

class GrimoireFormatter {
  private readonly lines: string[] = [];

  format(ast: SpellAST): string {
    this.line(0, `spell ${ast.name} {`);

    const topLevelWriters: Array<() => void> = [];
    if (ast.imports.length > 0) {
      topLevelWriters.push(() => {
        for (const item of ast.imports) {
          this.writeImport(item);
        }
      });
    }
    if (ast.sections.length > 0) {
      topLevelWriters.push(() => {
        for (const section of ast.sections) {
          this.writeSection(section);
        }
      });
    }
    if (ast.blocks.length > 0) {
      topLevelWriters.push(() => {
        for (const block of ast.blocks) {
          this.writeBlock(block);
        }
      });
    }
    if (ast.triggers.length > 0) {
      topLevelWriters.push(() => {
        for (const trigger of ast.triggers) {
          this.writeTrigger(trigger);
        }
      });
    }

    topLevelWriters.forEach((write, index) => {
      if (index > 0) {
        this.blankLine();
      }
      write();
    });

    this.line(0, "}");
    return `${this.lines.join("\n")}\n`;
  }

  private writeImport(node: ImportNode): void {
    const alias = node.alias ? ` as ${node.alias}` : "";
    this.line(1, `import ${this.quote(node.path)}${alias}`);
  }

  private writeSection(section: SectionNode): void {
    switch (section.kind) {
      case "version":
        this.writeVersionSection(section);
        return;
      case "description":
        this.line(1, `description: ${this.quote(section.value)}`);
        return;
      case "assets":
        this.writeAssetsSection(section);
        return;
      case "params":
        this.writeParamsSection(section);
        return;
      case "limits":
        this.writeLimitsSection(section);
        return;
      case "venues":
        this.writeVenuesSection(section);
        return;
      case "state":
        this.writeStateSection(section);
        return;
      case "skills":
        this.writeSkillsSection(section);
        return;
      case "advisors":
        this.writeAdvisorsSection(section);
        return;
      case "guards":
        this.writeGuardsSection(section);
        return;
      default:
        this.assertNever(section);
    }
  }

  private writeVersionSection(section: VersionSection): void {
    this.line(1, `version: ${this.quote(section.value)}`);
  }

  private writeAssetsSection(section: AssetsSection): void {
    if (section.items.length === 0) {
      this.line(1, "assets: []");
      return;
    }

    const simpleAssets = section.items.every(
      (item) =>
        item.chain === undefined && item.address === undefined && item.decimals === undefined
    );

    if (simpleAssets) {
      const symbols = section.items.map((item) => this.symbol(item.symbol)).join(", ");
      this.line(1, `assets: [${symbols}]`);
      return;
    }

    this.line(1, "assets: {");
    for (const item of section.items) {
      this.writeAssetItem(item, 2);
    }
    this.line(1, "}");
  }

  private writeAssetItem(item: AssetItem, indent: number): void {
    const hasDetail =
      item.chain !== undefined || item.address !== undefined || item.decimals !== undefined;
    if (!hasDetail) {
      this.line(indent, `${this.symbol(item.symbol)}: ${this.symbol(item.symbol)}`);
      return;
    }

    this.line(indent, `${this.symbol(item.symbol)}: {`);
    if (item.chain !== undefined) {
      this.line(indent + 1, `chain: ${item.chain}`);
    }
    if (item.address !== undefined) {
      this.line(indent + 1, `address: ${item.address}`);
    }
    if (item.decimals !== undefined) {
      this.line(indent + 1, `decimals: ${item.decimals}`);
    }
    this.line(indent, "}");
  }

  private writeParamsSection(section: ParamsSection): void {
    this.line(1, "params: {");
    for (const item of section.items) {
      this.writeParamItem(item, 2);
    }
    this.line(1, "}");
  }

  private writeParamItem(item: ParamItem, indent: number): void {
    const isSimple =
      item.type === undefined &&
      item.asset === undefined &&
      item.min === undefined &&
      item.max === undefined &&
      item.value !== undefined;

    if (isSimple) {
      const simpleValue = item.value;
      if (simpleValue !== undefined) {
        this.line(indent, `${item.name}: ${this.expr(simpleValue)}`);
      }
      return;
    }

    this.line(indent, `${item.name}: {`);
    if (item.type !== undefined) {
      this.line(indent + 1, `type: ${this.symbol(item.type)}`);
    }
    if (item.asset !== undefined) {
      this.line(indent + 1, `asset: ${this.symbol(item.asset)}`);
    }
    if (item.value !== undefined) {
      this.line(indent + 1, `default: ${this.expr(item.value)}`);
    }
    if (item.min !== undefined) {
      this.line(indent + 1, `min: ${item.min}`);
    }
    if (item.max !== undefined) {
      this.line(indent + 1, `max: ${item.max}`);
    }
    this.line(indent, "}");
  }

  private writeLimitsSection(section: LimitsSection): void {
    this.line(1, "limits: {");
    for (const item of section.items) {
      this.writeLimitItem(item, 2);
    }
    this.line(1, "}");
  }

  private writeLimitItem(item: LimitItem, indent: number): void {
    this.line(indent, `${item.name}: ${this.expr(item.value)}`);
  }

  private writeVenuesSection(section: VenuesSection): void {
    this.line(1, "venues: {");
    for (const group of section.groups) {
      this.writeVenueGroup(group, 2);
    }
    this.line(1, "}");
  }

  private writeVenueGroup(group: VenueGroup, indent: number): void {
    if (group.venues.length === 1) {
      const only = group.venues[0];
      if (only) {
        this.line(indent, `${group.name}: @${only.name}`);
        return;
      }
    }

    const refs = group.venues.map((venue) => `@${venue.name}`).join(", ");
    this.line(indent, `${group.name}: [${refs}]`);
  }

  private writeStateSection(section: StateSection): void {
    this.line(1, "state: {");
    if (section.persistent.length > 0) {
      this.writeStateScope("persistent", section.persistent, 2);
    }
    if (section.ephemeral.length > 0) {
      this.writeStateScope("ephemeral", section.ephemeral, 2);
    }
    this.line(1, "}");
  }

  private writeStateScope(name: string, items: StateItem[], indent: number): void {
    this.line(indent, `${name}: {`);
    for (const item of items) {
      this.line(indent + 1, `${item.name}: ${this.expr(item.initialValue)}`);
    }
    this.line(indent, "}");
  }

  private writeSkillsSection(section: SkillsSection): void {
    this.line(1, "skills: {");
    for (const item of section.items) {
      this.writeSkillItem(item, 2);
    }
    this.line(1, "}");
  }

  private writeSkillItem(item: SkillItem, indent: number): void {
    this.line(indent, `${item.name}: {`);
    this.line(indent + 1, `type: ${item.type}`);
    const adapters = item.adapters.map((adapter) => this.symbol(adapter)).join(", ");
    this.line(indent + 1, `adapters: [${adapters}]`);

    if (item.defaultConstraints?.maxSlippage !== undefined) {
      this.line(indent + 1, "default_constraints: {");
      this.line(indent + 2, `max_slippage: ${this.expr(item.defaultConstraints.maxSlippage)}`);
      this.line(indent + 1, "}");
    }

    this.line(indent, "}");
  }

  private writeAdvisorsSection(section: AdvisorsSection): void {
    this.line(1, "advisors: {");
    for (const item of section.items) {
      this.writeAdvisorItem(item, 2);
    }
    this.line(1, "}");
  }

  private writeAdvisorItem(item: AdvisorItem, indent: number): void {
    this.line(indent, `${item.name}: {`);
    this.line(indent + 1, `model: ${this.quote(item.model)}`);

    if (item.systemPrompt !== undefined) {
      this.line(indent + 1, `system_prompt: ${this.quote(item.systemPrompt)}`);
    }
    if (item.skills !== undefined) {
      this.line(indent + 1, `skills: ${this.stringList(item.skills)}`);
    }
    if (item.allowedTools !== undefined) {
      this.line(indent + 1, `allowed_tools: ${this.stringList(item.allowedTools)}`);
    }
    if (item.mcp !== undefined) {
      this.line(indent + 1, `mcp: ${this.stringList(item.mcp)}`);
    }
    if (item.timeout !== undefined) {
      this.line(indent + 1, `timeout: ${item.timeout}`);
    }
    if (item.fallback !== undefined) {
      this.line(indent + 1, `fallback: ${item.fallback ? "true" : "false"}`);
    }
    if (item.maxPerRun !== undefined || item.maxPerHour !== undefined) {
      this.line(indent + 1, "rate_limit: {");
      if (item.maxPerRun !== undefined) {
        this.line(indent + 2, `max_per_run: ${item.maxPerRun}`);
      }
      if (item.maxPerHour !== undefined) {
        this.line(indent + 2, `max_per_hour: ${item.maxPerHour}`);
      }
      this.line(indent + 1, "}");
    }

    this.line(indent, "}");
  }

  private writeGuardsSection(section: GuardsSection): void {
    this.line(1, "guards: {");
    for (const item of section.items) {
      this.writeGuardItem(item, 2);
    }
    this.line(1, "}");
  }

  private writeGuardItem(item: GuardItem, indent: number): void {
    const metadata: Array<{ key: string; value: ExpressionNode }> = [];
    if (item.severity !== "halt") {
      metadata.push({
        key: "severity",
        value: {
          kind: "literal",
          literalType: "string",
          value: item.severity,
        },
      });
    }
    if (item.message !== undefined) {
      metadata.push({
        key: "message",
        value: {
          kind: "literal",
          literalType: "string",
          value: item.message,
        },
      });
    }
    if (item.fallback !== undefined) {
      metadata.push({
        key: "fallback",
        value: {
          kind: "literal",
          literalType: "boolean",
          value: item.fallback,
        },
      });
    }

    const suffix =
      metadata.length > 0
        ? ` ${this.constraintClause({ kind: "constraint_clause", constraints: metadata })}`
        : "";
    this.line(indent, `${item.id}: ${this.expr(item.check)}${suffix}`);
  }

  private writeBlock(block: BlockDef): void {
    const params = block.params.length > 0 ? `(${block.params.join(", ")})` : "";
    this.line(1, `block ${block.name}${params} {`);
    this.writeStatementBlock(block.body, 2);
    this.line(1, "}");
  }

  private writeTrigger(trigger: TriggerHandler): void {
    this.line(1, `on ${this.triggerType(trigger.trigger)}: {`);
    this.writeStatementBlock(trigger.body, 2);
    this.line(1, "}");
  }

  private triggerType(trigger: TriggerType): string {
    switch (trigger.kind) {
      case "manual":
      case "hourly":
      case "daily":
        return trigger.kind;
      case "schedule":
        return this.quote(trigger.cron);
      case "condition": {
        const every = trigger.pollInterval !== undefined ? ` every ${trigger.pollInterval}` : "";
        return `condition ${this.expr(trigger.expression)}${every}`;
      }
      case "event": {
        const event = this.symbol(trigger.event);
        const filter = trigger.filter ? ` where ${this.expr(trigger.filter)}` : "";
        return `event ${event}${filter}`;
      }
      default:
        return this.assertNever(trigger);
    }
  }

  private writeStatementBlock(statements: StatementNode[], indent: number): void {
    for (const statement of statements) {
      this.writeStatement(statement, indent);
    }
  }

  private writeStatement(statement: StatementNode, indent: number): void {
    switch (statement.kind) {
      case "assignment":
        this.writeAssignment(statement, indent);
        return;
      case "advise":
        this.writeAdvise(statement, indent);
        return;
      case "if":
        this.writeIf(statement, indent);
        return;
      case "for":
        this.writeFor(statement, indent);
        return;
      case "repeat":
        this.writeRepeat(statement, indent);
        return;
      case "until":
        this.writeUntil(statement, indent);
        return;
      case "try":
        this.writeTry(statement, indent);
        return;
      case "parallel":
        this.writeParallel(statement, indent);
        return;
      case "pipeline":
        this.writePipeline(statement, indent);
        return;
      case "do":
        this.writeDo(statement, indent);
        return;
      case "atomic":
        this.writeAtomic(statement, indent);
        return;
      case "method_call":
        this.writeMethodCall(statement, indent);
        return;
      case "emit":
        this.writeEmit(statement, indent);
        return;
      case "halt":
        this.writeHalt(statement, indent);
        return;
      case "wait":
        this.writeWait(statement, indent);
        return;
      case "pass":
        this.line(indent, "pass");
        return;
      case "advisory":
        throw new Error("Inline advisory statements are no longer supported by the parser");
      default:
        this.assertNever(statement);
    }
  }

  private writeAssignment(statement: AssignmentNode, indent: number): void {
    let line = `${statement.target} = ${this.expr(statement.value)}`;
    if (statement.skill !== undefined) {
      line += ` using ${this.symbol(statement.skill)}`;
    }
    if (statement.constraints !== undefined) {
      line += ` ${this.constraintClause(statement.constraints)}`;
    }
    this.line(indent, line);
  }

  private writeAdvise(statement: StatementNode & { kind: "advise" }, indent: number): void {
    this.line(
      indent,
      `${statement.target} = advise ${statement.advisor}: ${this.quote(statement.prompt)} {`
    );

    if (statement.context !== undefined) {
      this.line(indent + 1, "context: {");
      for (const [key, value] of Object.entries(statement.context)) {
        this.line(indent + 2, `${key}: ${this.expr(value)}`);
      }
      this.line(indent + 1, "}");
    }
    if (statement.within !== undefined) {
      this.line(indent + 1, `within: ${this.symbol(statement.within)}`);
    }

    this.line(indent + 1, "output: {");
    this.writeOutputSchema(statement.outputSchema, indent + 2);
    this.line(indent + 1, "}");

    if (statement.onViolationExplicit || statement.onViolation !== "reject") {
      this.line(indent + 1, `on_violation: ${statement.onViolation ?? "reject"}`);
    }

    if (statement.clampConstraints !== undefined) {
      this.line(indent + 1, `clamp_constraints: ${this.stringList(statement.clampConstraints)}`);
    }

    this.line(indent + 1, `timeout: ${statement.timeout}`);
    this.line(indent + 1, `fallback: ${this.expr(statement.fallback)}`);
    this.line(indent, "}");
  }

  private writeOutputSchema(schema: AdvisoryOutputSchemaNode, indent: number): void {
    this.line(indent, `type: ${schema.type}`);
    if (schema.values !== undefined) {
      this.line(indent, `values: ${this.stringList(schema.values)}`);
    }
    if (schema.min !== undefined) {
      this.line(indent, `min: ${schema.min}`);
    }
    if (schema.max !== undefined) {
      this.line(indent, `max: ${schema.max}`);
    }
    if (schema.minLength !== undefined) {
      this.line(indent, `min_length: ${schema.minLength}`);
    }
    if (schema.maxLength !== undefined) {
      this.line(indent, `max_length: ${schema.maxLength}`);
    }
    if (schema.pattern !== undefined) {
      this.line(indent, `pattern: ${this.quote(schema.pattern)}`);
    }

    if (schema.fields !== undefined) {
      this.line(indent, "fields: {");
      for (const [key, value] of Object.entries(schema.fields)) {
        if (this.schemaCanInline(value)) {
          this.line(indent + 1, `${key}: ${value.type}`);
        } else {
          this.line(indent + 1, `${key}: {`);
          this.writeOutputSchema(value, indent + 2);
          this.line(indent + 1, "}");
        }
      }
      this.line(indent, "}");
    }

    if (schema.items !== undefined) {
      if (this.schemaCanInline(schema.items)) {
        this.line(indent, `items: ${schema.items.type}`);
      } else {
        this.line(indent, "items: {");
        this.writeOutputSchema(schema.items, indent + 1);
        this.line(indent, "}");
      }
    }
  }

  private schemaCanInline(schema: AdvisoryOutputSchemaNode): boolean {
    return (
      schema.values === undefined &&
      schema.min === undefined &&
      schema.max === undefined &&
      schema.minLength === undefined &&
      schema.maxLength === undefined &&
      schema.pattern === undefined &&
      schema.fields === undefined &&
      schema.items === undefined
    );
  }

  private writeIf(statement: IfNode, indent: number): void {
    this.line(indent, `if ${this.expr(statement.condition)} {`);
    this.writeStatementBlock(statement.thenBody, indent + 1);
    this.line(indent, "}");

    for (const branch of statement.elifs) {
      this.line(indent, `elif ${this.expr(branch.condition)} {`);
      this.writeStatementBlock(branch.body, indent + 1);
      this.line(indent, "}");
    }

    if (statement.elseBody.length > 0) {
      this.line(indent, "else {");
      this.writeStatementBlock(statement.elseBody, indent + 1);
      this.line(indent, "}");
    }
  }

  private writeFor(statement: ForNode, indent: number): void {
    const maxIterations =
      statement.maxIterations !== undefined ? ` max ${statement.maxIterations}` : "";
    this.line(
      indent,
      `for ${statement.variable} in ${this.expr(statement.iterable)}${maxIterations} {`
    );
    this.writeStatementBlock(statement.body, indent + 1);
    this.line(indent, "}");
  }

  private writeRepeat(statement: RepeatNode, indent: number): void {
    this.line(indent, `repeat ${this.expr(statement.count)} {`);
    this.writeStatementBlock(statement.body, indent + 1);
    this.line(indent, "}");
  }

  private writeUntil(statement: UntilNode, indent: number): void {
    const maxIterations =
      statement.maxIterations !== undefined ? ` max ${statement.maxIterations}` : "";
    this.line(indent, `loop until ${this.expr(statement.condition)}${maxIterations} {`);
    this.writeStatementBlock(statement.body, indent + 1);
    this.line(indent, "}");
  }

  private writeTry(statement: TryNode, indent: number): void {
    this.line(indent, "try {");
    this.writeStatementBlock(statement.tryBody, indent + 1);
    this.line(indent, "}");

    for (const catchNode of statement.catches) {
      this.writeCatch(catchNode, indent);
    }

    if (statement.finallyBody !== undefined) {
      this.line(indent, "finally {");
      this.writeStatementBlock(statement.finallyBody, indent + 1);
      this.line(indent, "}");
    }
  }

  private writeCatch(node: CatchNode, indent: number): void {
    this.line(indent, `catch ${node.error} {`);

    if (node.action !== undefined) {
      this.line(indent + 1, `action: ${node.action}`);
    }

    if (node.retry !== undefined) {
      this.line(indent + 1, "retry: {");
      this.line(indent + 2, `max_attempts: ${node.retry.maxAttempts}`);
      this.line(indent + 2, `backoff: ${node.retry.backoff}`);
      if (node.retry.backoffBase !== undefined) {
        this.line(indent + 2, `backoff_base: ${node.retry.backoffBase}`);
      }
      if (node.retry.maxBackoff !== undefined) {
        this.line(indent + 2, `max_backoff: ${node.retry.maxBackoff}`);
      }
      this.line(indent + 1, "}");
    }

    this.writeStatementBlock(node.body, indent + 1);
    this.line(indent, "}");
  }

  private writeParallel(statement: ParallelNode, indent: number): void {
    const headerParts: string[] = [];
    if (statement.join !== undefined) {
      headerParts.push(`join=${statement.join.type}`);
      if (statement.join.metric !== undefined) {
        headerParts.push(`metric=${this.expr(statement.join.metric)}`);
      }
      if (statement.join.order !== undefined) {
        headerParts.push(`order=${statement.join.order}`);
      }
      if (statement.join.count !== undefined) {
        headerParts.push(`count=${statement.join.count}`);
      }
    }
    if (statement.onFail !== undefined) {
      headerParts.push(`on_fail=${statement.onFail}`);
    }

    const headerSuffix = headerParts.length > 0 ? ` ${headerParts.join(" ")}` : "";
    this.line(indent, `parallel${headerSuffix} {`);
    for (const branch of statement.branches) {
      this.line(indent + 1, `${branch.name}: {`);
      this.writeStatementBlock(branch.body, indent + 2);
      this.line(indent + 1, "}");
    }
    this.line(indent, "}");
  }

  private writePipeline(statement: PipelineNode, indent: number): void {
    const prefix = `${statement.outputBinding ? `${statement.outputBinding} = ` : ""}${this.expr(statement.source)}`;

    if (statement.stages.length === 0) {
      this.line(indent, prefix);
      return;
    }

    const firstStage = statement.stages[0];
    if (!firstStage) {
      this.line(indent, prefix);
      return;
    }

    this.line(indent, `${prefix} | ${this.pipelineStageHeader(firstStage)}: {`);
    this.writeStatement(firstStage.step, indent + 1);

    for (let i = 0; i < statement.stages.length - 1; i++) {
      const next = statement.stages[i + 1];
      if (!next) continue;
      this.line(indent, `} | ${this.pipelineStageHeader(next)}: {`);
      this.writeStatement(next.step, indent + 1);
    }

    this.line(indent, "}");
  }

  private pipelineStageHeader(stage: PipelineNode["stages"][number]): string {
    if (stage.op === "reduce" && stage.initial !== undefined) {
      return `reduce(${this.expr(stage.initial)})`;
    }

    if ((stage.op === "take" || stage.op === "skip") && stage.count !== undefined) {
      return `${stage.op} ${stage.count}`;
    }

    if (stage.op === "sort") {
      const parts: string[] = ["sort"];
      if (stage.by !== undefined) {
        parts.push(`by ${this.expr(stage.by)}`);
      }
      if (stage.order !== undefined) {
        parts.push(`order ${stage.order}`);
      }
      return parts.join(" ");
    }

    return stage.op;
  }

  private writeDo(statement: DoNode, indent: number): void {
    const args =
      statement.args.length > 0
        ? `(${statement.args.map((arg) => this.expr(arg)).join(", ")})`
        : "";
    this.line(indent, `do ${statement.name}${args}`);
  }

  private writeAtomic(statement: AtomicNode, indent: number): void {
    const mode = statement.onFailure ? ` ${statement.onFailure}` : "";
    this.line(indent, `atomic${mode} {`);
    this.writeStatementBlock(statement.body, indent + 1);
    this.line(indent, "}");
  }

  private writeMethodCall(statement: MethodCallNode, indent: number): void {
    let line = `${this.expr(statement.object)}.${statement.method}(${statement.args
      .map((arg) => this.expr(arg))
      .join(", ")})`;

    if (statement.outputBinding !== undefined) {
      line = `${statement.outputBinding} = ${line}`;
    }
    if (statement.skill !== undefined) {
      line += ` using ${this.symbol(statement.skill)}`;
    }
    if (statement.constraints !== undefined) {
      line += ` ${this.constraintClause(statement.constraints)}`;
    }

    this.line(indent, line);
  }

  private writeEmit(statement: EmitNode, indent: number): void {
    if (statement.data.length === 0) {
      this.line(indent, `emit ${statement.event}`);
      return;
    }

    const payload = statement.data
      .map((entry) => `${entry.key}=${this.expr(entry.value)}`)
      .join(", ");
    this.line(indent, `emit ${statement.event}(${payload})`);
  }

  private writeHalt(statement: HaltNode, indent: number): void {
    this.line(indent, `halt ${this.quote(statement.reason)}`);
  }

  private writeWait(statement: WaitNode, indent: number): void {
    this.line(indent, `wait ${statement.duration}`);
  }

  private constraintClause(clause: ConstraintClause): string {
    if (clause.constraints.length === 1) {
      const single = clause.constraints[0];
      if (!single) {
        throw new Error("Constraint clause expected exactly one constraint");
      }
      return `with ${single.key}=${this.expr(single.value)}`;
    }

    const all = clause.constraints.map((item) => `${item.key}=${this.expr(item.value)}`).join(", ");
    return `with (${all})`;
  }

  private expr(node: ExpressionNode): string {
    return this.exprWithPrecedence(node, 0);
  }

  private exprWithPrecedence(node: ExpressionNode, parentPrecedence: number): string {
    switch (node.kind) {
      case "literal":
        return this.literal(node.value, node.literalType);
      case "unit_literal":
        return `${this.number(node.value)} ${node.unit}`;
      case "identifier":
        return node.name;
      case "venue_ref_expr":
        return `@${node.name}`;
      case "advisory_expr":
        return `**${node.prompt}**${node.advisor ? ` via ${node.advisor}` : ""}`;
      case "percentage":
        return `${this.number(node.value * 100)}%`;
      case "binary": {
        const precedence = this.binaryPrecedence(node.op);
        const left = this.exprWithPrecedence(node.left, precedence);
        const right = this.exprWithPrecedence(node.right, precedence + 1);
        return this.wrapIfNeeded(`${left} ${node.op} ${right}`, precedence, parentPrecedence);
      }
      case "unary": {
        const precedence = PRECEDENCE.UNARY;
        const arg = this.exprWithPrecedence(node.arg, precedence);
        const text = node.op === "not" ? `not ${arg}` : `-${arg}`;
        return this.wrapIfNeeded(text, precedence, parentPrecedence);
      }
      case "ternary": {
        const precedence = PRECEDENCE.TERNARY;
        const condition = this.exprWithPrecedence(node.condition, precedence);
        const thenExpr = this.exprWithPrecedence(node.thenExpr, precedence);
        const elseExpr = this.exprWithPrecedence(node.elseExpr, precedence);
        return this.wrapIfNeeded(
          `${condition} ? ${thenExpr} : ${elseExpr}`,
          precedence,
          parentPrecedence
        );
      }
      case "call": {
        const callee = this.exprWithPrecedence(node.callee, PRECEDENCE.POSTFIX);
        const args = node.args.map((arg) => this.expr(arg));
        const kwargs = node.kwargs?.map((arg) => `${arg.key}=${this.expr(arg.value)}`) ?? [];
        return `${callee}(${[...args, ...kwargs].join(", ")})`;
      }
      case "property_access": {
        const object = this.exprWithPrecedence(node.object, PRECEDENCE.POSTFIX);
        return `${object}.${node.property}`;
      }
      case "array_access": {
        const array = this.exprWithPrecedence(node.array, PRECEDENCE.POSTFIX);
        return `${array}[${this.expr(node.index)}]`;
      }
      case "array_literal":
        return `[${node.elements.map((element) => this.expr(element)).join(", ")}]`;
      case "object_literal": {
        if (node.entries.length === 0) {
          return "{}";
        }
        const entries = node.entries
          .map((entry) => `${entry.key}: ${this.expr(entry.value)}`)
          .join(", ");
        return `{ ${entries} }`;
      }
      default:
        return this.assertNever(node);
    }
  }

  private binaryPrecedence(op: string): number {
    switch (op) {
      case "or":
        return 2;
      case "and":
        return 3;
      case "==":
      case "!=":
        return 4;
      case "<":
      case ">":
      case "<=":
      case ">=":
        return 5;
      case "+":
      case "-":
        return 6;
      case "*":
      case "/":
      case "%":
        return 7;
      default:
        return 1;
    }
  }

  private wrapIfNeeded(text: string, precedence: number, parentPrecedence: number): string {
    if (precedence < parentPrecedence) {
      return `(${text})`;
    }
    return text;
  }

  private stringList(values: string[]): string {
    return `[${values.map((value) => this.symbol(value)).join(", ")}]`;
  }

  private symbol(value: string): string {
    return this.isSymbol(value) ? value : this.quote(value);
  }

  private literal(value: string | number | boolean, literalType: string): string {
    if (literalType === "string") {
      return this.quote(String(value));
    }
    if (literalType === "boolean") {
      return value ? "true" : "false";
    }
    if (literalType === "address") {
      return String(value);
    }
    return this.number(typeof value === "number" ? value : Number.parseFloat(String(value)));
  }

  private quote(value: string): string {
    return JSON.stringify(value);
  }

  private number(value: number): string {
    return String(value);
  }

  private line(indent: number, text: string): void {
    this.lines.push(`${INDENT.repeat(indent)}${text}`);
  }

  private blankLine(): void {
    if (this.lines[this.lines.length - 1] !== "") {
      this.lines.push("");
    }
  }

  private isSymbol(value: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
  }

  private assertNever(value: never): never {
    throw new Error(`Unhandled formatter node: ${JSON.stringify(value)}`);
  }
}
