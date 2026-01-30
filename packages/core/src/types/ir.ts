/**
 * Intermediate Representation (IR) for compiled spells
 */

import type { Expression } from "./expressions.js";
import type {
  Address,
  AssetDef,
  ParamDef,
  StateField,
  Timestamp,
  Trigger,
  VenueAlias,
} from "./primitives.js";
import type { Step } from "./steps.js";

/** Advisor definition */
export interface AdvisorDef {
  name: string;
  model: "haiku" | "sonnet" | "opus";
  scope: "read-only"; // Always read-only, enforced
  systemPrompt?: string;
  rateLimit?: {
    maxCallsPerRun: number;
    maxCallsPerHour: number;
  };
}

/** Skill (capability module) definition */
export interface SkillDef {
  name: string;
  type: "swap" | "yield" | "lending" | "staking" | "bridge";
  adapters: string[]; // Venue aliases
  defaultConstraints?: {
    maxSlippage?: number;
  };
}

/** Guard (invariant) definition */
export interface Guard {
  id: string;
  check: Expression;
  severity: "warn" | "revert" | "halt";
  message: string;
}

/** Advisory guard (AI-evaluated) */
export interface AdvisoryGuard {
  id: string;
  advisor: string;
  check: string; // Natural language condition
  severity: "warn" | "pause"; // Cannot halt on AI judgment
  fallback: boolean; // Safe default
}

/** Combined guard type */
export type GuardDef = Guard | AdvisoryGuard;

/** State schema */
export interface StateSchema {
  persistent: Record<string, StateField>;
  ephemeral: Record<string, StateField>;
}

/**
 * The complete Spell IR structure
 */
export interface SpellIR {
  // ==========================================================================
  // METADATA
  // ==========================================================================

  /** Unique identifier */
  id: string;

  /** Semantic version */
  version: string;

  /** Metadata */
  meta: {
    name: string;
    description?: string;
    author?: Address;
    created: Timestamp;
    hash: string; // Content-addressable hash
  };

  // ==========================================================================
  // CONFIGURATION
  // ==========================================================================

  /** Venue alias definitions */
  aliases: VenueAlias[];

  /** Asset definitions */
  assets: AssetDef[];

  /** Capability modules */
  skills: SkillDef[];

  /** AI advisors */
  advisors: AdvisorDef[];

  /** Parameters */
  params: ParamDef[];

  /** State schema */
  state: StateSchema;

  // ==========================================================================
  // EXECUTION
  // ==========================================================================

  /** Execution graph (steps) */
  steps: Step[];

  /** Invariants (guards) */
  guards: GuardDef[];

  /** Triggers */
  triggers: Trigger[];

  /** Source map: step ID -> source location in the .spell file */
  sourceMap?: Record<string, { line: number; column: number }>;
}

/**
 * Raw spell source (parsed YAML, pre-IR)
 */
export interface SpellSource {
  spell: string;
  version: string;
  description?: string;

  venues?: Record<
    string,
    {
      chain: number;
      address: string;
      label?: string;
    }
  >;

  params?: Record<
    string,
    | unknown // Simple form: just default value
    | {
        // Extended form
        type?: "number" | "bool" | "address" | "asset" | "string";
        default?: unknown;
        min?: number;
        max?: number;
      }
  >;

  assets?: Record<
    string,
    {
      chain: number;
      address: string;
      decimals?: number;
    }
  >;

  state?: {
    persistent?: Record<string, unknown>;
    ephemeral?: Record<string, unknown>;
  };

  skills?: Record<
    string,
    {
      type: string;
      adapters: string[];
      default_constraints?: {
        max_slippage?: number;
      };
    }
  >;

  advisors?: Record<
    string,
    {
      model: string;
      scope?: string;
      system_prompt?: string;
      rate_limit?: {
        max_per_run?: number;
        max_per_hour?: number;
      };
    }
  >;

  trigger?:
    | { manual: true }
    | { schedule: string }
    | { condition: string; poll_interval: number }
    | { any: Array<Record<string, unknown>> };

  steps?: Array<Record<string, unknown>>;

  guards?: Array<{
    id: string;
    check?: string;
    advisory?: string;
    severity: string;
    message?: string;
    fallback?: boolean;
  }>;
}

/**
 * Compilation result
 */
export interface CompilationResult {
  success: boolean;
  ir?: SpellIR;
  errors: CompilationError[];
  warnings: CompilationWarning[];
}

export interface CompilationError {
  code: string;
  message: string;
  line?: number;
  column?: number;
}

export interface CompilationWarning {
  code: string;
  message: string;
  line?: number;
  column?: number;
}
