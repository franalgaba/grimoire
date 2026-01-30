import { describe, expect, test } from "bun:test";
import type { CircuitBreaker } from "../types/policy.js";
import { CircuitBreakerManager } from "./circuit-breaker.js";

function makeBreaker(overrides: Partial<CircuitBreaker> & { id: string }): CircuitBreaker {
  return {
    trigger: { type: "revert_rate", maxPercent: 0.5, window: 60 },
    action: "pause",
    cooldown: 30,
    ...overrides,
  };
}

describe("CircuitBreakerManager", () => {
  describe("initialization", () => {
    test("all breakers start in CLOSED state", () => {
      const mgr = new CircuitBreakerManager([makeBreaker({ id: "b1" }), makeBreaker({ id: "b2" })]);

      const states = mgr.getStates();
      expect(states).toEqual([
        { id: "b1", state: "closed" },
        { id: "b2", state: "closed" },
      ]);
    });

    test("check allows actions when all breakers are closed", () => {
      const mgr = new CircuitBreakerManager([makeBreaker({ id: "b1" })]);
      const result = mgr.check();
      expect(result.allowed).toBe(true);
      expect(result.blockedBy).toHaveLength(0);
    });
  });

  describe("revert_rate trigger", () => {
    test("fires when revert rate exceeds threshold within window", () => {
      const now = 1000;
      const mgr = new CircuitBreakerManager(
        [
          makeBreaker({
            id: "revert-breaker",
            trigger: { type: "revert_rate", maxPercent: 0.5, window: 60 },
          }),
        ],
        () => now
      );

      // 2 successes + 2 reverts = 50% revert rate, but threshold is >0.5 (strict)
      mgr.recordSuccess();
      mgr.recordSuccess();
      mgr.recordEvent({ timestamp: now, type: "revert" }); // 1/3 = 33%
      const result = mgr.recordEvent({ timestamp: now, type: "revert" }); // 2/4 = 50%, not > 0.5

      // 50% == 50%, not exceeded yet
      expect(result).toBeNull();
      expect(mgr.getStates()[0]?.state).toBe("closed");

      // One more revert: 3/5 = 60% > 50%
      const result2 = mgr.recordEvent({ timestamp: now, type: "revert" });
      expect(result2).not.toBeNull();
      expect(result2?.breakerId).toBe("revert-breaker");
      expect(mgr.getStates()[0]?.state).toBe("open");
    });

    test("does not fire when rate is below threshold", () => {
      const now = 1000;
      const mgr = new CircuitBreakerManager(
        [
          makeBreaker({
            id: "revert-breaker",
            trigger: { type: "revert_rate", maxPercent: 0.5, window: 60 },
          }),
        ],
        () => now
      );

      // 1 revert out of 3 actions (33% < 50%)
      mgr.recordSuccess(); // action 1 - success
      mgr.recordSuccess(); // action 2 - success
      const result = mgr.recordEvent({ timestamp: now, type: "revert" }); // action 3 - revert

      expect(result).toBeNull();

      const states = mgr.getStates();
      expect(states[0]?.state).toBe("closed");
    });
  });

  describe("cumulative_slippage trigger", () => {
    test("fires when total slippage exceeds maxBps", () => {
      const now = 1000;
      const mgr = new CircuitBreakerManager(
        [
          makeBreaker({
            id: "slip-breaker",
            trigger: { type: "cumulative_slippage", maxBps: 100, window: 60 },
          }),
        ],
        () => now
      );

      mgr.recordEvent({ timestamp: now, type: "slippage", value: 50 });
      mgr.recordEvent({ timestamp: now, type: "slippage", value: 30 });
      const result = mgr.recordEvent({ timestamp: now, type: "slippage", value: 30 });

      // 50 + 30 + 30 = 110 > 100
      expect(result).not.toBeNull();
      expect(result?.breakerId).toBe("slip-breaker");
    });

    test("does not fire when below threshold", () => {
      const now = 1000;
      const mgr = new CircuitBreakerManager(
        [
          makeBreaker({
            id: "slip-breaker",
            trigger: { type: "cumulative_slippage", maxBps: 100, window: 60 },
          }),
        ],
        () => now
      );

      mgr.recordEvent({ timestamp: now, type: "slippage", value: 30 });
      const result = mgr.recordEvent({ timestamp: now, type: "slippage", value: 30 });

      // 60 < 100
      expect(result).toBeNull();
    });
  });

  describe("gas_spike trigger", () => {
    test("fires when gas spike exceeds multiple of average", () => {
      const now = 1000;
      const mgr = new CircuitBreakerManager(
        [
          makeBreaker({
            id: "gas-breaker",
            trigger: { type: "gas_spike", maxMultiple: 2 },
          }),
        ],
        () => now
      );

      // Build average: 100, 100, 100
      mgr.recordEvent({ timestamp: now, type: "gas", value: 100 });
      mgr.recordEvent({ timestamp: now, type: "gas", value: 100 });
      mgr.recordEvent({ timestamp: now, type: "gas", value: 100 });

      // Spike to 300 (3x average of 100 > 2x multiple)
      const result = mgr.recordEvent({ timestamp: now, type: "gas", value: 300 });

      expect(result).not.toBeNull();
      expect(result?.breakerId).toBe("gas-breaker");
    });

    test("does not fire with insufficient gas events", () => {
      const now = 1000;
      const mgr = new CircuitBreakerManager(
        [
          makeBreaker({
            id: "gas-breaker",
            trigger: { type: "gas_spike", maxMultiple: 2 },
          }),
        ],
        () => now
      );

      // Only 1 event - need at least 2 to compute average
      const result = mgr.recordEvent({ timestamp: now, type: "gas", value: 300 });
      expect(result).toBeNull();
    });
  });

  describe("state transitions", () => {
    test("CLOSED -> OPEN when trigger fires", () => {
      const now = 1000;
      const mgr = new CircuitBreakerManager(
        [
          makeBreaker({
            id: "b1",
            trigger: { type: "revert_rate", maxPercent: 0.3, window: 60 },
          }),
        ],
        () => now
      );

      // 2 reverts out of 2 = 100% > 30%
      mgr.recordEvent({ timestamp: now, type: "revert" });
      mgr.recordEvent({ timestamp: now, type: "revert" });

      expect(mgr.getStates()[0]?.state).toBe("open");
    });

    test("OPEN -> HALF_OPEN after cooldown", () => {
      let now = 1000;
      const mgr = new CircuitBreakerManager(
        [
          makeBreaker({
            id: "b1",
            trigger: { type: "revert_rate", maxPercent: 0.3, window: 60 },
            cooldown: 10, // 10 seconds
          }),
        ],
        () => now
      );

      // Trigger the breaker
      mgr.recordEvent({ timestamp: now, type: "revert" });
      mgr.recordEvent({ timestamp: now, type: "revert" });
      expect(mgr.getStates()[0]?.state).toBe("open");

      // Not enough time elapsed
      now = 1000 + 5000; // 5 seconds
      mgr.check();
      expect(mgr.getStates()[0]?.state).toBe("open");

      // Enough time elapsed
      now = 1000 + 10_000; // 10 seconds
      mgr.check();
      expect(mgr.getStates()[0]?.state).toBe("half_open");
    });

    test("HALF_OPEN -> CLOSED on success", () => {
      let now = 1000;
      const mgr = new CircuitBreakerManager(
        [
          makeBreaker({
            id: "b1",
            trigger: { type: "revert_rate", maxPercent: 0.3, window: 60 },
            cooldown: 10,
          }),
        ],
        () => now
      );

      // Trigger
      mgr.recordEvent({ timestamp: now, type: "revert" });
      mgr.recordEvent({ timestamp: now, type: "revert" });

      // Advance past cooldown
      now = 1000 + 10_000;
      mgr.check();
      expect(mgr.getStates()[0]?.state).toBe("half_open");

      // Success resets to closed
      mgr.recordSuccess();
      expect(mgr.getStates()[0]?.state).toBe("closed");
    });

    test("HALF_OPEN -> OPEN on failure", () => {
      let now = 1000;
      const mgr = new CircuitBreakerManager(
        [
          makeBreaker({
            id: "b1",
            trigger: { type: "revert_rate", maxPercent: 0.3, window: 60 },
            cooldown: 10,
          }),
        ],
        () => now
      );

      // Trigger
      mgr.recordEvent({ timestamp: now, type: "revert" });
      mgr.recordEvent({ timestamp: now, type: "revert" });

      // Advance past cooldown
      now = 1000 + 10_000;
      mgr.check();
      expect(mgr.getStates()[0]?.state).toBe("half_open");

      // Another failure re-opens
      const result = mgr.recordEvent({ timestamp: now, type: "revert" });
      expect(mgr.getStates()[0]?.state).toBe("open");
      expect(result).not.toBeNull();
      expect(result?.breakerId).toBe("b1");
    });
  });

  describe("window pruning", () => {
    test("events outside window are pruned during evaluation", () => {
      const now = 100_000;
      const mgr = new CircuitBreakerManager(
        [
          makeBreaker({
            id: "b1",
            trigger: { type: "cumulative_slippage", maxBps: 100, window: 60 },
          }),
        ],
        () => now
      );

      // Old events (outside window)
      mgr.recordEvent({ timestamp: 1000, type: "slippage", value: 80 });
      mgr.recordEvent({ timestamp: 2000, type: "slippage", value: 80 });

      // Recent event (inside window)
      const result = mgr.recordEvent({ timestamp: now, type: "slippage", value: 30 });

      // Old events pruned: only 30 < 100
      expect(result).toBeNull();
    });
  });

  describe("check behavior", () => {
    test("returns blocked when breaker is OPEN", () => {
      const now = 1000;
      const mgr = new CircuitBreakerManager(
        [
          makeBreaker({
            id: "b1",
            trigger: { type: "revert_rate", maxPercent: 0.3, window: 60 },
            action: "pause",
          }),
        ],
        () => now
      );

      // Trigger
      mgr.recordEvent({ timestamp: now, type: "revert" });
      mgr.recordEvent({ timestamp: now, type: "revert" });

      const result = mgr.check();
      expect(result.allowed).toBe(false);
      expect(result.blockedBy).toHaveLength(1);
      expect(result.blockedBy[0]?.id).toBe("b1");
      expect(result.blockedBy[0]?.action).toBe("pause");
    });

    test("returns allowed when breaker transitions to HALF_OPEN", () => {
      let now = 1000;
      const mgr = new CircuitBreakerManager(
        [
          makeBreaker({
            id: "b1",
            trigger: { type: "revert_rate", maxPercent: 0.3, window: 60 },
            cooldown: 5,
          }),
        ],
        () => now
      );

      // Trigger
      mgr.recordEvent({ timestamp: now, type: "revert" });
      mgr.recordEvent({ timestamp: now, type: "revert" });

      // Advance past cooldown
      now = 1000 + 5000;
      const result = mgr.check();
      expect(result.allowed).toBe(true);
      expect(mgr.getStates()[0]?.state).toBe("half_open");
    });
  });

  describe("multiple breakers", () => {
    test("breakers operate independently", () => {
      const now = 1000;
      const mgr = new CircuitBreakerManager(
        [
          makeBreaker({
            id: "revert-breaker",
            trigger: { type: "revert_rate", maxPercent: 0.3, window: 60 },
          }),
          makeBreaker({
            id: "slip-breaker",
            trigger: { type: "cumulative_slippage", maxBps: 200, window: 60 },
          }),
        ],
        () => now
      );

      // Trigger only the revert breaker
      mgr.recordEvent({ timestamp: now, type: "revert" });
      mgr.recordEvent({ timestamp: now, type: "revert" });

      const states = mgr.getStates();
      expect(states[0]?.state).toBe("open"); // revert breaker opened
      expect(states[1]?.state).toBe("closed"); // slippage breaker still closed
    });

    test("check reports all blocked breakers", () => {
      const now = 1000;
      const mgr = new CircuitBreakerManager(
        [
          makeBreaker({
            id: "b1",
            trigger: { type: "revert_rate", maxPercent: 0.3, window: 60 },
            action: "pause",
          }),
          makeBreaker({
            id: "b2",
            trigger: { type: "cumulative_slippage", maxBps: 10, window: 60 },
            action: "unwind",
          }),
        ],
        () => now
      );

      // Trigger both: reverts trigger b1, slippage triggers b2
      mgr.recordEvent({ timestamp: now, type: "revert" });
      mgr.recordEvent({ timestamp: now, type: "slippage", value: 20 });

      const result = mgr.check();
      expect(result.allowed).toBe(false);
      expect(result.blockedBy).toHaveLength(2);
    });
  });

  describe("stubbed triggers", () => {
    test("oracle_deviation returns false (not implemented)", () => {
      const mgr = new CircuitBreakerManager([
        makeBreaker({
          id: "oracle",
          trigger: { type: "oracle_deviation", maxBps: 100, window: 60 },
        }),
      ]);

      mgr.recordEvent({ timestamp: Date.now(), type: "revert" });
      expect(mgr.getStates()[0]?.state).toBe("closed");
    });

    test("nav_drawdown returns false (not implemented)", () => {
      const mgr = new CircuitBreakerManager([
        makeBreaker({
          id: "nav",
          trigger: { type: "nav_drawdown", maxBps: 500, window: 3600 },
        }),
      ]);

      mgr.recordEvent({ timestamp: Date.now(), type: "revert" });
      expect(mgr.getStates()[0]?.state).toBe("closed");
    });
  });
});
