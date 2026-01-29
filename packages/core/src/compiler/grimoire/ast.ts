/**
 * AST node types for the Grimoire syntax
 */

import type { SourceSpan } from "./errors.js";

// =============================================================================
// BASE TYPES
// =============================================================================

/** Base AST node with location info */
export interface ASTNode {
  span?: SourceSpan;
}

// =============================================================================
// TOP-LEVEL SPELL AST
// =============================================================================

/** Complete spell AST */
export interface SpellAST extends ASTNode {
  kind: "spell";
  name: string;
  sections: SectionNode[];
  triggers: TriggerHandler[];
}

// =============================================================================
// SECTIONS (Top-level declarations)
// =============================================================================

/** Section node types */
export type SectionNode =
  | VersionSection
  | DescriptionSection
  | AssetsSection
  | ParamsSection
  | LimitsSection
  | VenuesSection
  | StateSection
  | SkillsSection
  | AdvisorsSection
  | GuardsSection;

/** Version declaration */
export interface VersionSection extends ASTNode {
  kind: "version";
  value: string;
}

/** Description section */
export interface DescriptionSection extends ASTNode {
  kind: "description";
  value: string;
}

/** Assets section: assets: [USDC, USDT, DAI] or assets: { ... } */
export interface AssetsSection extends ASTNode {
  kind: "assets";
  items: AssetItem[];
}

export interface AssetItem extends ASTNode {
  symbol: string;
  chain?: number;
  address?: string;
  decimals?: number;
}

/** Params section */
export interface ParamsSection extends ASTNode {
  kind: "params";
  items: ParamItem[];
}

export interface ParamItem extends ASTNode {
  name: string;
  value: ExpressionNode;
  type?: "number" | "bool" | "address" | "asset" | "string";
  min?: number;
  max?: number;
}

/** Limits section */
export interface LimitsSection extends ASTNode {
  kind: "limits";
  items: LimitItem[];
}

export interface LimitItem extends ASTNode {
  name: string;
  value: ExpressionNode;
}

/** Venues section */
export interface VenuesSection extends ASTNode {
  kind: "venues";
  groups: VenueGroup[];
}

export interface VenueGroup extends ASTNode {
  name: string;
  venues: VenueRef[];
}

/** Venue reference: @aave_v3 */
export interface VenueRef extends ASTNode {
  kind: "venue_ref";
  name: string;
  chain?: number;
  address?: string;
}

/** State section */
export interface StateSection extends ASTNode {
  kind: "state";
  persistent: StateItem[];
  ephemeral: StateItem[];
}

export interface StateItem extends ASTNode {
  name: string;
  initialValue: ExpressionNode;
}

/** Skills section */
export interface SkillsSection extends ASTNode {
  kind: "skills";
  items: SkillItem[];
}

export interface SkillItem extends ASTNode {
  name: string;
  type: "swap" | "yield" | "lending" | "staking" | "bridge";
  adapters: string[];
  maxSlippage?: number;
}

/** Advisors section */
export interface AdvisorsSection extends ASTNode {
  kind: "advisors";
  items: AdvisorItem[];
}

export interface AdvisorItem extends ASTNode {
  name: string;
  model: "haiku" | "sonnet" | "opus";
  systemPrompt?: string;
  maxPerRun?: number;
  maxPerHour?: number;
}

/** Guards section */
export interface GuardsSection extends ASTNode {
  kind: "guards";
  items: GuardItem[];
}

export interface GuardItem extends ASTNode {
  id: string;
  check: ExpressionNode | AdvisoryExpr;
  severity: "warn" | "revert" | "halt" | "pause";
  message?: string;
  fallback?: boolean;
}

// =============================================================================
// TRIGGER HANDLERS
// =============================================================================

/** Trigger types */
export type TriggerType =
  | { kind: "manual" }
  | { kind: "schedule"; cron: string }
  | { kind: "hourly" }
  | { kind: "daily" }
  | { kind: "condition"; expression: ExpressionNode; pollInterval?: number };

/** Trigger handler: on manual: / on hourly: etc */
export interface TriggerHandler extends ASTNode {
  kind: "trigger_handler";
  trigger: TriggerType;
  body: StatementNode[];
}

// =============================================================================
// STATEMENTS
// =============================================================================

/** Statement node types */
export type StatementNode =
  | AssignmentNode
  | IfNode
  | ForNode
  | AtomicNode
  | MethodCallNode
  | EmitNode
  | HaltNode
  | WaitNode
  | AdvisoryNode
  | PassNode;

/** Assignment: x = expr */
export interface AssignmentNode extends ASTNode {
  kind: "assignment";
  target: string;
  value: ExpressionNode;
}

/** If statement: if cond: ... elif cond: ... else: ... */
export interface IfNode extends ASTNode {
  kind: "if";
  condition: ExpressionNode;
  thenBody: StatementNode[];
  elifs: Array<{ condition: ExpressionNode; body: StatementNode[] }>;
  elseBody: StatementNode[];
}

/** For loop: for x in items: ... */
export interface ForNode extends ASTNode {
  kind: "for";
  variable: string;
  iterable: ExpressionNode;
  body: StatementNode[];
  maxIterations?: number;
}

/** Atomic block: atomic: ... (transaction grouping) */
export interface AtomicNode extends ASTNode {
  kind: "atomic";
  body: StatementNode[];
  onFailure?: "revert" | "skip" | "halt";
}

/** Method call: venue.deposit(asset, amount) */
export interface MethodCallNode extends ASTNode {
  kind: "method_call";
  object: ExpressionNode;
  method: string;
  args: ExpressionNode[];
  outputBinding?: string;
}

/** Emit statement: emit event_name(key=value, ...) */
export interface EmitNode extends ASTNode {
  kind: "emit";
  event: string;
  data: Array<{ key: string; value: ExpressionNode }>;
}

/** Halt statement: halt "reason" */
export interface HaltNode extends ASTNode {
  kind: "halt";
  reason: string;
}

/** Wait statement: wait 10s / wait 1h */
export interface WaitNode extends ASTNode {
  kind: "wait";
  duration: number; // in seconds
}

/** Advisory statement: if **prompt**: ... */
export interface AdvisoryNode extends ASTNode {
  kind: "advisory";
  advisor?: string;
  prompt: string;
  thenBody: StatementNode[];
  elseBody: StatementNode[];
  timeout?: number;
  fallback?: boolean;
}

/** Pass statement (no-op) */
export interface PassNode extends ASTNode {
  kind: "pass";
}

// =============================================================================
// EXPRESSIONS
// =============================================================================

/** Expression node types */
export type ExpressionNode =
  | LiteralNode
  | IdentifierNode
  | VenueRefExpr
  | AdvisoryExpr
  | PercentageExpr
  | BinaryExprNode
  | UnaryExprNode
  | TernaryExprNode
  | CallExprNode
  | PropertyAccessNode
  | ArrayAccessNode
  | ArrayLiteralNode
  | ObjectLiteralNode;

/** Literal value */
export interface LiteralNode extends ASTNode {
  kind: "literal";
  value: string | number | boolean;
  literalType: "string" | "number" | "boolean" | "address";
}

/** Identifier reference */
export interface IdentifierNode extends ASTNode {
  kind: "identifier";
  name: string;
}

/** Venue reference expression: @aave_v3 */
export interface VenueRefExpr extends ASTNode {
  kind: "venue_ref_expr";
  name: string;
}

/** Advisory expression: **prompt text** */
export interface AdvisoryExpr extends ASTNode {
  kind: "advisory_expr";
  prompt: string;
  advisor?: string;
}

/** Percentage literal: 50% */
export interface PercentageExpr extends ASTNode {
  kind: "percentage";
  value: number; // 0.5 for 50%
}

/** Binary operation */
export interface BinaryExprNode extends ASTNode {
  kind: "binary";
  op: BinaryOperator;
  left: ExpressionNode;
  right: ExpressionNode;
}

export type BinaryOperator =
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "=="
  | "!="
  | "<"
  | ">"
  | "<="
  | ">="
  | "and"
  | "or";

/** Unary operation */
export interface UnaryExprNode extends ASTNode {
  kind: "unary";
  op: UnaryOperator;
  arg: ExpressionNode;
}

export type UnaryOperator = "not" | "-";

/** Ternary expression */
export interface TernaryExprNode extends ASTNode {
  kind: "ternary";
  condition: ExpressionNode;
  thenExpr: ExpressionNode;
  elseExpr: ExpressionNode;
}

/** Function/method call */
export interface CallExprNode extends ASTNode {
  kind: "call";
  callee: ExpressionNode;
  args: ExpressionNode[];
  kwargs?: Array<{ key: string; value: ExpressionNode }>;
}

/** Property access: obj.prop */
export interface PropertyAccessNode extends ASTNode {
  kind: "property_access";
  object: ExpressionNode;
  property: string;
}

/** Array access: arr[index] */
export interface ArrayAccessNode extends ASTNode {
  kind: "array_access";
  array: ExpressionNode;
  index: ExpressionNode;
}

/** Array literal: [a, b, c] */
export interface ArrayLiteralNode extends ASTNode {
  kind: "array_literal";
  elements: ExpressionNode[];
}

/** Object literal: {key: value, ...} */
export interface ObjectLiteralNode extends ASTNode {
  kind: "object_literal";
  entries: Array<{ key: string; value: ExpressionNode }>;
}

// =============================================================================
// HELPERS
// =============================================================================

/** Check if expression is advisory */
export function isAdvisoryExpr(node: ExpressionNode): node is AdvisoryExpr {
  return node.kind === "advisory_expr";
}

/** Check if expression is venue ref */
export function isVenueRef(node: ExpressionNode): node is VenueRefExpr {
  return node.kind === "venue_ref_expr";
}

/** Check if expression is percentage */
export function isPercentage(node: ExpressionNode): node is PercentageExpr {
  return node.kind === "percentage";
}
