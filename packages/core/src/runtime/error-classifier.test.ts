/**
 * Error classifier tests
 */

import { describe, expect, test } from "bun:test";
import { classifyError, matchesCatchBlock } from "./error-classifier.js";

describe("classifyError", () => {
  test("classifies slippage errors", () => {
    expect(classifyError("Slippage exceeded maximum")).toBe("slippage_exceeded");
    expect(classifyError("slippage too high")).toBe("slippage_exceeded");
  });

  test("classifies insufficient liquidity errors", () => {
    expect(classifyError("Insufficient liquidity in pool")).toBe("insufficient_liquidity");
    expect(classifyError("insufficient pool liquidity")).toBe("insufficient_liquidity");
  });

  test("classifies insufficient balance errors", () => {
    expect(classifyError("Insufficient balance for transfer")).toBe("insufficient_balance");
    expect(classifyError("insufficient funds")).toBe("insufficient_balance");
  });

  test("classifies venue unavailable errors", () => {
    expect(classifyError("Venue unavailable")).toBe("venue_unavailable");
    expect(classifyError("venue is down")).toBe("venue_unavailable");
  });

  test("classifies deadline exceeded errors", () => {
    expect(classifyError("Transaction deadline exceeded")).toBe("deadline_exceeded");
    expect(classifyError("deadline passed")).toBe("deadline_exceeded");
  });

  test("classifies simulation failed errors", () => {
    expect(classifyError("Simulation failed for transaction")).toBe("simulation_failed");
  });

  test("classifies policy violation errors", () => {
    expect(classifyError("Policy violation: max allocation")).toBe("policy_violation");
  });

  test("classifies guard failed errors", () => {
    expect(classifyError("Guard failed: health factor check")).toBe("guard_failed");
  });

  test("classifies tx reverted errors", () => {
    expect(classifyError("Transaction reverted")).toBe("tx_reverted");
    expect(classifyError("EVM revert")).toBe("tx_reverted");
  });

  test("classifies gas exceeded errors", () => {
    expect(classifyError("Gas exceeded block limit")).toBe("gas_exceeded");
    expect(classifyError("out of gas")).toBe("gas_exceeded");
  });

  test("returns null for unknown errors", () => {
    expect(classifyError("Something went wrong")).toBeNull();
    expect(classifyError("random error")).toBeNull();
    expect(classifyError("")).toBeNull();
  });

  test("is case insensitive", () => {
    expect(classifyError("SLIPPAGE EXCEEDED")).toBe("slippage_exceeded");
    expect(classifyError("REVERT")).toBe("tx_reverted");
    expect(classifyError("Guard Failed")).toBe("guard_failed");
  });
});

describe("matchesCatchBlock", () => {
  test("wildcard matches any error type", () => {
    expect(matchesCatchBlock("slippage_exceeded", "*")).toBe(true);
    expect(matchesCatchBlock("tx_reverted", "*")).toBe(true);
    expect(matchesCatchBlock(null, "*")).toBe(true);
  });

  test("specific type only matches same type", () => {
    expect(matchesCatchBlock("slippage_exceeded", "slippage_exceeded")).toBe(true);
    expect(matchesCatchBlock("slippage_exceeded", "tx_reverted")).toBe(false);
  });

  test("null error type does not match specific type", () => {
    expect(matchesCatchBlock(null, "slippage_exceeded")).toBe(false);
  });
});
