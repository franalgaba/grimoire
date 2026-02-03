/**
 * Spell builder - fluent API for creating SpellIR objects
 */

import type { Address, Expression, SpellIR, SpellSource, Step, Trigger } from "../types/index.js";

/** Internal state entry (differs from StateField which is for the parsed format) */
interface StateEntry {
  type: string;
  value: unknown;
}

/** Builder for creating SpellIR objects */
export class SpellBuilder {
  private _id: string;
  private _version: string;
  private _meta: SpellIR["meta"] = {
    name: "",
    created: Date.now(),
    hash: "",
  };
  private _aliases: SpellIR["aliases"] = [];
  private _assets: SpellIR["assets"] = [];
  private _skills: SpellIR["skills"] = [];
  private _advisors: SpellIR["advisors"] = [];
  private _params: SpellIR["params"] = [];
  private _state: {
    persistent: Record<string, StateEntry>;
    ephemeral: Record<string, StateEntry>;
  } = {
    persistent: {},
    ephemeral: {},
  };
  private _steps: SpellIR["steps"] = [];
  private _guards: SpellIR["guards"] = [];
  private _triggers: SpellIR["triggers"] = [];

  constructor(name: string) {
    this._id = name
      .replace(/([a-z])([A-Z])/g, "$1-$2")
      .replace(/\s+/g, "-")
      .toLowerCase();
    this._meta.name = name;
    this._version = "1.0.0";
  }

  /** Set the spell version */
  version(version: string): SpellBuilder {
    this._version = version;
    return this;
  }

  /** Set the spell description */
  description(description: string): SpellBuilder {
    this._meta.description = description;
    return this;
  }

  /** Set the spell author */
  author(address: string): SpellBuilder {
    this._meta.author = address as Address;
    return this;
  }

  /** Add an asset definition */
  asset(
    symbol: string,
    config: {
      chain: number;
      address: string;
      decimals?: number;
    }
  ): SpellBuilder {
    this._assets.push({
      symbol,
      chain: config.chain,
      address: config.address as Address,
      decimals: config.decimals ?? 18,
    });
    return this;
  }

  /** Add multiple assets */
  assets(
    assets: Array<{
      symbol: string;
      chain: number;
      address: string;
      decimals?: number;
    }>
  ): SpellBuilder {
    for (const a of assets) {
      this._assets.push({
        symbol: a.symbol,
        chain: a.chain,
        address: a.address as Address,
        decimals: a.decimals ?? 18,
      });
    }
    return this;
  }

  /** Add a venue alias */
  alias(
    alias: string,
    config: {
      chain: number;
      address: string;
      label?: string;
    }
  ): SpellBuilder {
    this._aliases.push({
      alias,
      chain: config.chain,
      address: config.address as Address,
      label: config.label ?? alias,
    });
    return this;
  }

  /** Add multiple venue aliases */
  aliases(
    aliases: Array<{
      alias: string;
      chain: number;
      address: string;
      label?: string;
    }>
  ): SpellBuilder {
    for (const a of aliases) {
      this._aliases.push({
        alias: a.alias,
        chain: a.chain,
        address: a.address as Address,
        label: a.label ?? a.alias,
      });
    }
    return this;
  }

  /** Add a parameter */
  param(
    name: string,
    config: {
      type?: "number" | "bool" | "address" | "asset" | "string";
      default?: unknown;
      min?: number;
      max?: number;
    }
  ): SpellBuilder {
    this._params.push({
      name,
      type: config.type ?? "number",
      default: config.default ?? 0,
      min: config.min,
      max: config.max,
    });
    return this;
  }

  /** Add multiple parameters */
  params(
    params: Array<{
      name: string;
      type?: "number" | "bool" | "address" | "asset" | "string";
      default?: unknown;
      min?: number;
      max?: number;
    }>
  ): SpellBuilder {
    for (const p of params) {
      this._params.push({
        name: p.name,
        type: p.type ?? "number",
        default: p.default ?? 0,
        min: p.min,
        max: p.max,
      });
    }
    return this;
  }

  /** Add a persistent state field */
  persistentState(name: string, type: "number" | "string" | "boolean"): SpellBuilder {
    this._state.persistent[name] = {
      type,
      value: type === "number" ? 0 : type === "string" ? "" : false,
    };
    return this;
  }

  /** Add an ephemeral state field */
  ephemeralState(name: string, type: "number" | "string" | "boolean"): SpellBuilder {
    this._state.ephemeral[name] = {
      type,
      value: type === "number" ? 0 : type === "string" ? "" : false,
    };
    return this;
  }

  /** Add a skill */
  skill(
    name: string,
    config: {
      type: "swap" | "yield" | "lending" | "staking" | "bridge";
      adapters: string[];
      defaultConstraints?: {
        maxSlippage?: number;
      };
    }
  ): SpellBuilder {
    this._skills.push({
      name,
      type: config.type,
      adapters: config.adapters,
      defaultConstraints: config.defaultConstraints,
    });
    return this;
  }

  /** Add an advisor */
  advisor(
    name: string,
    config: {
      model: "haiku" | "sonnet" | "opus";
      scope?: "read-only";
      systemPrompt?: string;
      skills?: string[];
      allowedTools?: string[];
      defaultTimeout?: number;
      defaultFallback?: boolean;
      rateLimit?: {
        maxCallsPerRun: number;
        maxCallsPerHour: number;
      };
    }
  ): SpellBuilder {
    this._advisors.push({
      name,
      model: config.model,
      scope: config.scope ?? "read-only",
      systemPrompt: config.systemPrompt,
      skills: config.skills,
      allowedTools: config.allowedTools,
      defaultTimeout: config.defaultTimeout,
      defaultFallback: config.defaultFallback,
      rateLimit: config.rateLimit,
    });
    return this;
  }

  /** Add a guard */
  guard(config: {
    id: string;
    check: Expression;
    severity: "warn" | "revert" | "halt";
    message: string;
  }): SpellBuilder {
    this._guards.push({
      id: config.id,
      check: config.check,
      severity: config.severity,
      message: config.message,
    });
    return this;
  }

  /** Add an advisory guard */
  advisoryGuard(config: {
    id: string;
    advisor: string;
    check: string;
    severity: "warn" | "pause";
    fallback: boolean;
  }): SpellBuilder {
    this._guards.push({
      id: config.id,
      advisor: config.advisor,
      check: config.check,
      severity: config.severity,
      fallback: config.fallback,
    });
    return this;
  }

  /** Add a trigger */
  trigger(trigger: Trigger): SpellBuilder {
    this._triggers.push(trigger);
    return this;
  }

  /** Add a step */
  step(step: Step): SpellBuilder {
    this._steps.push(step);
    return this;
  }

  /** Add multiple steps */
  steps(steps: Step[]): SpellBuilder {
    this._steps.push(...steps);
    return this;
  }

  /** Build the SpellIR object */
  build(): SpellIR {
    return {
      id: this._id,
      version: this._version,
      meta: this._meta,
      aliases: this._aliases,
      assets: this._assets,
      skills: this._skills,
      advisors: this._advisors,
      params: this._params,
      state: this._state as unknown as SpellIR["state"],
      steps: this._steps,
      guards: this._guards,
      triggers: this._triggers,
    };
  }

  /** Build and return as SpellSource (for IR generator) */
  buildSource(): SpellSource {
    const skills: Record<
      string,
      {
        type: string;
        adapters: string[];
        default_constraints?: { max_slippage?: number };
      }
    > = {};
    for (const s of this._skills) {
      skills[s.name] = {
        type: s.type,
        adapters: s.adapters,
        default_constraints: s.defaultConstraints
          ? { max_slippage: s.defaultConstraints.maxSlippage }
          : undefined,
      };
    }

    const advisors: Record<
      string,
      {
        model: string;
        scope?: string;
        system_prompt?: string;
        skills?: string[];
        allowed_tools?: string[];
        timeout?: number;
        fallback?: boolean;
        rate_limit?: {
          max_per_run?: number;
          max_per_hour?: number;
        };
      }
    > = {};
    for (const a of this._advisors) {
      advisors[a.name] = {
        model: a.model,
        scope: a.scope,
        system_prompt: a.systemPrompt,
        skills: a.skills,
        allowed_tools: a.allowedTools,
        timeout: a.defaultTimeout,
        fallback: a.defaultFallback,
        rate_limit: a.rateLimit
          ? {
              max_per_run: a.rateLimit.maxCallsPerRun,
              max_per_hour: a.rateLimit.maxCallsPerHour,
            }
          : undefined,
      };
    }

    return {
      spell: this._id,
      version: this._version,
      description: this._meta.description,
      assets: this._assets.reduce(
        (acc, asset) => {
          acc[asset.symbol] = {
            chain: asset.chain,
            address: asset.address,
            decimals: asset.decimals,
          };
          return acc;
        },
        {} as Record<string, { chain: number; address: string; decimals?: number }>
      ),
      params: this._params.reduce(
        (acc, p) => {
          acc[p.name] = {
            type: p.type,
            default: p.default,
            min: p.min,
            max: p.max,
          };
          return acc;
        },
        {} as Record<
          string,
          {
            type?: string;
            default?: unknown;
            min?: number;
            max?: number;
          }
        >
      ),
      state: {
        persistent: this._state.persistent,
        ephemeral: this._state.ephemeral,
      },
      skills,
      advisors,
      trigger:
        this._triggers.length > 0
          ? (this._triggers[0] as unknown as SpellSource["trigger"])
          : undefined,
      steps: this._steps.map((step) => ({ ...step })) as unknown as SpellSource["steps"],
      guards: this._guards.map((g) => {
        if ("advisor" in g) {
          return {
            id: g.id,
            advisory: g.advisor,
            check: g.check,
            severity: g.severity,
            fallback: g.fallback,
          };
        }
        return {
          id: g.id,
          check: String(g.check),
          severity: g.severity,
          message: g.message,
        };
      }),
    };
  }
}

/**
 * Create a new spell builder
 */
export function spell(name: string): SpellBuilder {
  return new SpellBuilder(name);
}
