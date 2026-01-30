/**
 * Step builders - fluent API for creating execution steps
 */

import type {
  Action,
  ActionConstraints,
  ActionStep,
  AdvisoryStep,
  ComputeStep,
  ConditionalStep,
  EmitStep,
  ErrorType,
  Expression,
  HaltStep,
  LoopStep,
  ParallelStep,
  PipelineStep,
  Step,
  TryStep,
  WaitStep,
} from "../types/index.js";
import { literal } from "./expressions.js";

/** Base step builder */
export abstract class StepBuilder<T extends Step> {
  protected _id: string;
  protected _dependsOn: string[] = [];

  constructor(id: string) {
    this._id = id;
  }

  /** Set dependencies on other steps */
  dependsOn(...stepIds: string[]): this {
    this._dependsOn = stepIds;
    return this;
  }

  /** Build the step */
  abstract build(): T;
}

// =============================================================================
// COMPUTE STEP
// =============================================================================

export class ComputeBuilder extends StepBuilder<ComputeStep> {
  private _assignments: Array<{
    variable: string;
    expression: Expression;
  }> = [];

  /** Add an assignment */
  assign(variable: string, expression: Expression): this {
    this._assignments.push({ variable, expression });
    return this;
  }

  /** Build the compute step */
  build(): ComputeStep {
    return {
      kind: "compute",
      id: this._id,
      assignments: this._assignments,
      dependsOn: this._dependsOn,
    };
  }
}

/** Create a compute step builder */
export function compute(id: string): ComputeBuilder {
  return new ComputeBuilder(id);
}

// =============================================================================
// ACTION STEP
// =============================================================================

export class ActionBuilder extends StepBuilder<ActionStep> {
  private _skill?: string;
  private _action: Action;
  private _constraints: ActionConstraints = {};
  private _outputBinding?: string;

  constructor(act: Action) {
    super(`action-${act.type}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
    this._action = act;
  }

  /** Set the skill name */
  skill(name: string): this {
    this._skill = name;
    return this;
  }

  /** Set action constraints */
  constraints(constraints: ActionConstraints): this {
    this._constraints = constraints;
    return this;
  }

  /** Set output binding */
  outputBinding(name: string): this {
    this._outputBinding = name;
    return this;
  }

  /** Build the action step */
  build(): ActionStep {
    return {
      kind: "action",
      id: this._id,
      skill: this._skill,
      action: this._action,
      constraints: this._constraints,
      outputBinding: this._outputBinding,
      dependsOn: this._dependsOn,
      onFailure: "revert",
    };
  }
}

/** Create an action step builder */
export function action(act: Action): ActionBuilder {
  return new ActionBuilder(act);
}

// =============================================================================
// CONDITIONAL STEP
// =============================================================================

export class ConditionalBuilder extends StepBuilder<ConditionalStep> {
  private _condition: Expression;
  private _thenSteps: string[] = [];
  private _elseSteps: string[] = [];

  constructor(condition: Expression) {
    super(`conditional-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
    this._condition = condition;
  }

  /** Add a then step */
  then(stepId: string): this {
    this._thenSteps.push(stepId);
    return this;
  }

  /** Add an else step */
  else(stepId: string): this {
    this._elseSteps.push(stepId);
    return this;
  }

  /** Build the conditional step */
  build(): ConditionalStep {
    return {
      kind: "conditional",
      id: this._id,
      condition: this._condition,
      thenSteps: this._thenSteps,
      elseSteps: this._elseSteps,
      dependsOn: this._dependsOn,
    };
  }
}

/** Create a conditional step builder */
export function conditional(condition: Expression): ConditionalBuilder {
  return new ConditionalBuilder(condition);
}

// =============================================================================
// LOOP STEP
// =============================================================================

export class LoopBuilder extends StepBuilder<LoopStep> {
  private _loopType: LoopStep["loopType"];
  private _bodySteps: string[] = [];
  private _maxIterations: number;
  private _parallel?: boolean;
  private _outputBinding?: string;

  constructor(loopType: LoopStep["loopType"], maxIterations: number) {
    super(`loop-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
    this._loopType = loopType;
    this._maxIterations = maxIterations;
  }

  /** Add a body step */
  body(stepId: string): this {
    this._bodySteps.push(stepId);
    return this;
  }

  /** Set parallel execution */
  parallel(): this {
    this._parallel = true;
    return this;
  }

  /** Set output binding */
  outputBinding(name: string): this {
    this._outputBinding = name;
    return this;
  }

  /** Build the loop step */
  build(): LoopStep {
    return {
      kind: "loop",
      id: this._id,
      loopType: this._loopType,
      bodySteps: this._bodySteps,
      maxIterations: this._maxIterations,
      parallel: this._parallel,
      outputBinding: this._outputBinding,
      dependsOn: this._dependsOn,
    };
  }
}

/** Create a repeat loop builder */
export function repeat(count: number, maxIterations: number): LoopBuilder {
  return new LoopBuilder({ type: "repeat", count }, maxIterations);
}

/** Create a for loop builder */
export function forLoop(variable: string, source: Expression, maxIterations: number): LoopBuilder {
  return new LoopBuilder({ type: "for", variable, source }, maxIterations);
}

/** Create an until loop builder */
export function until(condition: Expression, maxIterations: number): LoopBuilder {
  return new LoopBuilder({ type: "until", condition }, maxIterations);
}

// =============================================================================
// PARALLEL STEP
// =============================================================================

export class ParallelBuilder extends StepBuilder<ParallelStep> {
  private _branches: Array<{ id: string; name: string; steps: string[] }> = [];
  private _join: ParallelStep["join"] = { type: "all" };
  private _onFail: ParallelStep["onFail"] = "abort";
  private _timeout?: number;
  private _outputBinding?: string;

  /** Add a branch */
  branch(name: string, steps: string[]): this {
    this._branches.push({
      id: `branch-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      name,
      steps,
    });
    return this;
  }

  /** Set join strategy */
  join(strategy: ParallelStep["join"]): this {
    this._join = strategy;
    return this;
  }

  /** Set on fail behavior */
  onFail(behavior: "abort" | "continue"): this {
    this._onFail = behavior;
    return this;
  }

  /** Set timeout */
  timeout(seconds: number): this {
    this._timeout = seconds;
    return this;
  }

  /** Set output binding */
  outputBinding(name: string): this {
    this._outputBinding = name;
    return this;
  }

  /** Build the parallel step */
  build(): ParallelStep {
    return {
      kind: "parallel",
      id: this._id,
      branches: this._branches,
      join: this._join,
      onFail: this._onFail,
      timeout: this._timeout,
      outputBinding: this._outputBinding,
      dependsOn: this._dependsOn,
    };
  }
}

/** Create a parallel step builder */
export function parallel(id: string): ParallelBuilder {
  return new ParallelBuilder(id);
}

// =============================================================================
// PIPELINE STEP
// =============================================================================

export class PipelineBuilder extends StepBuilder<PipelineStep> {
  private _source: Expression;
  private _stages: PipelineStep["stages"] = [];
  private _parallel?: boolean;
  private _parallelConfig?: PipelineStep["parallelConfig"];
  private _outputBinding?: string;

  constructor(source: Expression) {
    super(`pipeline-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
    this._source = source;
  }

  /** Add a where stage */
  where(predicate: Expression): this {
    this._stages.push({ op: "where", predicate });
    return this;
  }

  /** Add a map stage */
  map(stepId: string): this {
    this._stages.push({ op: "map", step: stepId });
    return this;
  }

  /** Add a filter stage */
  filter(stepId: string): this {
    this._stages.push({ op: "filter", step: stepId });
    return this;
  }

  /** Add a reduce stage */
  reduce(stepId: string, initial: Expression): this {
    this._stages.push({ op: "reduce", step: stepId, initial });
    return this;
  }

  /** Add a take stage */
  take(count: number): this {
    this._stages.push({ op: "take", count });
    return this;
  }

  /** Add a skip stage */
  skip(count: number): this {
    this._stages.push({ op: "skip", count });
    return this;
  }

  /** Add a sort stage */
  sort(by: Expression, order: "asc" | "desc"): this {
    this._stages.push({ op: "sort", by, order });
    return this;
  }

  /** Set parallel execution */
  parallel(maxConcurrency?: number, onFail: "abort" | "continue" = "abort"): this {
    this._parallel = true;
    this._parallelConfig = {
      maxConcurrency,
      onFail,
    };
    return this;
  }

  /** Set output binding */
  outputBinding(name: string): this {
    this._outputBinding = name;
    return this;
  }

  /** Build the pipeline step */
  build(): PipelineStep {
    return {
      kind: "pipeline",
      id: this._id,
      source: this._source,
      stages: this._stages,
      parallel: this._parallel,
      parallelConfig: this._parallelConfig,
      outputBinding: this._outputBinding,
      dependsOn: this._dependsOn,
    };
  }
}

/** Create a pipeline step builder */
export function pipeline(source: Expression): PipelineBuilder {
  return new PipelineBuilder(source);
}

// =============================================================================
// TRY STEP
// =============================================================================

export class TryBuilder extends StepBuilder<TryStep> {
  private _trySteps: string[] = [];
  private _catchBlocks: TryStep["catchBlocks"] = [];
  private _finallySteps?: string[];

  /** Add a try step */
  tryStep(stepId: string): this {
    this._trySteps.push(stepId);
    return this;
  }

  /** Add a catch block */
  catchBlock(config: {
    errorType: ErrorType | "*";
    steps?: string[];
    retry?: {
      maxAttempts: number;
      backoff: "none" | "linear" | "exponential";
      backoffBase?: number;
      maxBackoff?: number;
      modifyOnRetry?: {
        slippage?: { increase: number };
        venue?: string;
      };
    };
    action?: "skip" | "rollback" | "halt";
    alert?: {
      channels: string[];
      severity: "info" | "warn" | "critical";
    };
  }): this {
    this._catchBlocks.push({
      errorType: config.errorType,
      steps: config.steps,
      retry: config.retry,
      action: config.action,
      alert: config.alert,
    });
    return this;
  }

  /** Add a finally step */
  finallyStep(stepId: string): this {
    this._finallySteps = this._finallySteps ?? [];
    this._finallySteps.push(stepId);
    return this;
  }

  /** Build the try step */
  build(): TryStep {
    return {
      kind: "try",
      id: this._id,
      trySteps: this._trySteps,
      catchBlocks: this._catchBlocks,
      finallySteps: this._finallySteps,
      dependsOn: this._dependsOn,
    };
  }
}

/** Create a try block builder */
export function tryBlock(id: string): TryBuilder {
  return new TryBuilder(id);
}

// =============================================================================
// ADVISORY STEP
// =============================================================================

export class AdvisoryBuilder extends StepBuilder<AdvisoryStep> {
  private _advisor: string;
  private _prompt: string;
  private _context?: Record<string, Expression>;
  private _outputSchema: AdvisoryStep["outputSchema"];
  private _outputBinding: string;
  private _timeout: number;
  private _fallback: Expression;

  constructor(advisor: string, prompt: string, outputBinding: string) {
    super(`advisory-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
    this._advisor = advisor;
    this._prompt = prompt;
    this._outputBinding = outputBinding;
    this._outputSchema = {
      type: "boolean",
    };
    this._timeout = 30000;
    this._fallback = literal(false);
  }

  /** Set context variables */
  context(key: string, value: Expression): this {
    this._context = this._context ?? {};
    this._context[key] = value;
    return this;
  }

  /** Set output schema */
  outputSchema(schema: AdvisoryStep["outputSchema"]): this {
    this._outputSchema = schema;
    return this;
  }

  /** Set timeout */
  timeout(seconds: number): this {
    this._timeout = seconds;
    return this;
  }

  /** Set fallback value */
  fallback(value: Expression): this {
    this._fallback = value;
    return this;
  }

  /** Build the advisory step */
  build(): AdvisoryStep {
    return {
      kind: "advisory",
      id: this._id,
      advisor: this._advisor,
      prompt: this._prompt,
      context: this._context,
      outputSchema: this._outputSchema,
      outputBinding: this._outputBinding,
      timeout: this._timeout,
      fallback: this._fallback,
      dependsOn: this._dependsOn,
    };
  }
}

/** Create an advisory step builder */
export function advisory(advisor: string, prompt: string, outputBinding: string): AdvisoryBuilder {
  return new AdvisoryBuilder(advisor, prompt, outputBinding);
}

// =============================================================================
// WAIT STEP
// =============================================================================

export class WaitBuilder extends StepBuilder<WaitStep> {
  private _duration: number;

  constructor(duration: number) {
    super(`wait-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
    this._duration = duration;
  }

  /** Build the wait step */
  build(): WaitStep {
    return {
      kind: "wait",
      id: this._id,
      duration: this._duration,
      dependsOn: this._dependsOn,
    };
  }
}

/** Create a wait step builder */
export function wait(seconds: number): WaitBuilder {
  return new WaitBuilder(seconds);
}

// =============================================================================
// EMIT STEP
// =============================================================================

export class EmitBuilder extends StepBuilder<EmitStep> {
  private _event: string;
  private _data: Record<string, Expression> = {};

  constructor(event: string) {
    super(`emit-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
    this._event = event;
  }

  /** Add an event data field */
  data(key: string, value: Expression): this {
    this._data[key] = value;
    return this;
  }

  /** Build the emit step */
  build(): EmitStep {
    return {
      kind: "emit",
      id: this._id,
      event: this._event,
      data: this._data,
      dependsOn: this._dependsOn,
    };
  }
}

/** Create an emit step builder */
export function emit(event: string): EmitBuilder {
  return new EmitBuilder(event);
}

// =============================================================================
// HALT STEP
// =============================================================================

export class HaltBuilder extends StepBuilder<HaltStep> {
  private _reason: string;

  constructor(reason: string) {
    super(`halt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
    this._reason = reason;
  }

  /** Build the halt step */
  build(): HaltStep {
    return {
      kind: "halt",
      id: this._id,
      reason: this._reason,
      dependsOn: this._dependsOn,
    };
  }
}

/** Create a halt step builder */
export function halt(reason: string): HaltBuilder {
  return new HaltBuilder(reason);
}
