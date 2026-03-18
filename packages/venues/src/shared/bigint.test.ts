import { describe, expect, test } from "bun:test";
import { isLiteralAmount, toBigInt, toBigIntIfPossible } from "./bigint.js";

// =============================================================================
// isLiteralAmount
// =============================================================================

describe("isLiteralAmount", () => {
  test("returns true for literal amount object", () => {
    expect(isLiteralAmount({ kind: "literal", value: 42 })).toBe(true);
    expect(isLiteralAmount({ kind: "literal", value: "100" })).toBe(true);
    expect(isLiteralAmount({ kind: "literal", value: 100n })).toBe(true);
  });

  test("returns false for primitives", () => {
    expect(isLiteralAmount(42)).toBe(false);
    expect(isLiteralAmount("hello")).toBe(false);
    expect(isLiteralAmount(true)).toBe(false);
  });

  test("returns false for null/undefined", () => {
    expect(isLiteralAmount(null)).toBe(false);
    expect(isLiteralAmount(undefined)).toBe(false);
  });

  test("returns false for object with wrong kind", () => {
    expect(isLiteralAmount({ kind: "other", value: 42 })).toBe(false);
  });

  test("returns false for object missing kind", () => {
    expect(isLiteralAmount({ value: 42 })).toBe(false);
  });

  test("returns false for object missing value", () => {
    expect(isLiteralAmount({ kind: "literal" })).toBe(false);
  });
});

// =============================================================================
// toBigInt
// =============================================================================

describe("toBigInt", () => {
  test("passes through bigint", () => {
    expect(toBigInt(100n)).toBe(100n);
  });

  test("converts number (floors)", () => {
    expect(toBigInt(42)).toBe(42n);
    expect(toBigInt(3.9)).toBe(3n);
  });

  test("converts string", () => {
    expect(toBigInt("1000")).toBe(1000n);
  });

  test("converts literal object", () => {
    expect(toBigInt({ kind: "literal", value: 55 })).toBe(55n);
    expect(toBigInt({ kind: "literal", value: 55n })).toBe(55n);
  });

  test("throws on unsupported type with default message", () => {
    expect(() => toBigInt({})).toThrow("Unsupported amount type");
  });

  test("throws on unsupported type with custom label", () => {
    expect(() => toBigInt({}, "custom error")).toThrow("custom error");
  });
});

// =============================================================================
// toBigIntIfPossible
// =============================================================================

describe("toBigIntIfPossible", () => {
  test("passes through bigint", () => {
    expect(toBigIntIfPossible(100n)).toBe(100n);
  });

  test("converts number", () => {
    expect(toBigIntIfPossible(42)).toBe(42n);
  });

  test("converts string", () => {
    expect(toBigIntIfPossible("1000")).toBe(1000n);
  });

  test("converts literal object", () => {
    expect(toBigIntIfPossible({ kind: "literal", value: 55 })).toBe(55n);
  });

  test("returns undefined for NaN", () => {
    expect(toBigIntIfPossible(NaN)).toBeUndefined();
  });

  test("returns undefined for Infinity", () => {
    expect(toBigIntIfPossible(Infinity)).toBeUndefined();
  });

  test("returns undefined for empty string", () => {
    expect(toBigIntIfPossible("")).toBeUndefined();
  });

  test("returns undefined for non-numeric string", () => {
    expect(toBigIntIfPossible("abc")).toBeUndefined();
  });

  test("returns undefined for plain object", () => {
    expect(toBigIntIfPossible({})).toBeUndefined();
  });

  test("returns undefined for null", () => {
    expect(toBigIntIfPossible(null)).toBeUndefined();
  });
});
