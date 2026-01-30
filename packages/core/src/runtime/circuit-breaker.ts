/**
 * Circuit Breaker Runtime
 *
 * Implements the CLOSED -> OPEN -> HALF_OPEN state machine for runtime
 * risk controls. Tracks events within time windows and triggers breakers
 * when thresholds are exceeded.
 */

import type { CircuitBreaker, CircuitBreakerTrigger } from "../types/policy.js";

export type BreakerState = "closed" | "open" | "half_open";

export interface TimestampedEvent {
  timestamp: number;
  type: "revert" | "slippage" | "gas";
  value?: number;
}

export interface BreakerRecord {
  id: string;
  state: BreakerState;
  definition: CircuitBreaker;
  openedAt?: number;
  events: TimestampedEvent[];
  /** Total action count within the window (for revert_rate) */
  actionCount: number;
}

export interface CircuitBreakerCheckResult {
  allowed: boolean;
  blockedBy: Array<{ id: string; action: CircuitBreaker["action"] }>;
}

export interface CircuitBreakerTriggerResult {
  breakerId: string;
  trigger: CircuitBreakerTrigger;
  action: CircuitBreaker["action"];
}

export class CircuitBreakerManager {
  private breakers: Map<string, BreakerRecord>;
  private now: () => number;

  constructor(definitions: CircuitBreaker[], nowFn?: () => number) {
    this.now = nowFn ?? (() => Date.now());
    this.breakers = new Map();
    for (const def of definitions) {
      this.breakers.set(def.id, {
        id: def.id,
        state: "closed",
        definition: def,
        events: [],
        actionCount: 0,
      });
    }
  }

  /** Check if any breaker is OPEN - call before executing an action */
  check(): CircuitBreakerCheckResult {
    const blockedBy: Array<{ id: string; action: CircuitBreaker["action"] }> = [];

    for (const record of this.breakers.values()) {
      // Transition OPEN -> HALF_OPEN if cooldown elapsed
      if (record.state === "open" && record.openedAt !== undefined) {
        const cooldown = record.definition.cooldown ?? 0;
        if (cooldown > 0 && this.now() - record.openedAt >= cooldown * 1000) {
          record.state = "half_open";
        }
      }

      if (record.state === "open") {
        blockedBy.push({ id: record.id, action: record.definition.action });
      }
    }

    return {
      allowed: blockedBy.length === 0,
      blockedBy,
    };
  }

  /** Record a successful action (for rate tracking) */
  recordSuccess(): void {
    for (const record of this.breakers.values()) {
      record.actionCount++;

      // HALF_OPEN -> CLOSED on success
      if (record.state === "half_open") {
        record.state = "closed";
        record.openedAt = undefined;
        record.events = [];
        record.actionCount = 0;
      }
    }
  }

  /** Record an event (action failure, slippage, gas spike) */
  recordEvent(event: TimestampedEvent): CircuitBreakerTriggerResult | null {
    let triggered: CircuitBreakerTriggerResult | null = null;

    for (const record of this.breakers.values()) {
      record.events.push(event);
      record.actionCount++;

      // HALF_OPEN -> OPEN on failure
      if (record.state === "half_open") {
        record.state = "open";
        record.openedAt = this.now();
        triggered = {
          breakerId: record.id,
          trigger: record.definition.trigger,
          action: record.definition.action,
        };
        continue;
      }

      // Only evaluate triggers when CLOSED
      if (record.state !== "closed") continue;

      this.pruneEvents(record);

      if (this.evaluateTrigger(record)) {
        record.state = "open";
        record.openedAt = this.now();
        triggered = {
          breakerId: record.id,
          trigger: record.definition.trigger,
          action: record.definition.action,
        };
      }
    }

    return triggered;
  }

  /** Get current state of all breakers */
  getStates(): Array<{ id: string; state: BreakerState }> {
    const states: Array<{ id: string; state: BreakerState }> = [];
    for (const record of this.breakers.values()) {
      states.push({ id: record.id, state: record.state });
    }
    return states;
  }

  /** Prune events outside the time window */
  private pruneEvents(record: BreakerRecord): void {
    const trigger = record.definition.trigger;
    if (!("window" in trigger)) return;

    const windowMs = trigger.window * 1000;
    const cutoff = this.now() - windowMs;
    record.events = record.events.filter((e) => e.timestamp >= cutoff);
  }

  /** Evaluate whether a trigger condition has been met */
  private evaluateTrigger(record: BreakerRecord): boolean {
    const trigger = record.definition.trigger;

    switch (trigger.type) {
      case "revert_rate":
        return this.evaluateRevertRate(record, trigger);

      case "cumulative_slippage":
        return this.evaluateCumulativeSlippage(record, trigger);

      case "gas_spike":
        return this.evaluateGasSpike(record, trigger);

      case "oracle_deviation":
      case "nav_drawdown":
        // TODO: These require external price feeds
        return false;
    }
  }

  private evaluateRevertRate(
    record: BreakerRecord,
    trigger: Extract<CircuitBreakerTrigger, { type: "revert_rate" }>
  ): boolean {
    const windowMs = trigger.window * 1000;
    const cutoff = this.now() - windowMs;
    const recentReverts = record.events.filter(
      (e) => e.type === "revert" && e.timestamp >= cutoff
    ).length;

    // Need at least 1 action to compute a rate
    if (record.actionCount === 0) return false;

    const rate = recentReverts / record.actionCount;
    return rate > trigger.maxPercent;
  }

  private evaluateCumulativeSlippage(
    record: BreakerRecord,
    trigger: Extract<CircuitBreakerTrigger, { type: "cumulative_slippage" }>
  ): boolean {
    const windowMs = trigger.window * 1000;
    const cutoff = this.now() - windowMs;
    const totalSlippage = record.events
      .filter((e) => e.type === "slippage" && e.timestamp >= cutoff)
      .reduce((sum, e) => sum + (e.value ?? 0), 0);

    return totalSlippage > trigger.maxBps;
  }

  private evaluateGasSpike(
    record: BreakerRecord,
    trigger: Extract<CircuitBreakerTrigger, { type: "gas_spike" }>
  ): boolean {
    const gasEvents = record.events.filter((e) => e.type === "gas");
    if (gasEvents.length < 2) return false;

    const latest = gasEvents[gasEvents.length - 1];
    if (!latest) return false;
    const previous = gasEvents.slice(0, -1);
    const avg = previous.reduce((sum, e) => sum + (e.value ?? 0), 0) / previous.length;

    if (avg === 0) return false;
    return (latest.value ?? 0) / avg > trigger.maxMultiple;
  }
}
