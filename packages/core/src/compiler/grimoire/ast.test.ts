/**
 * AST helper function tests
 */

import { describe, expect, test } from "bun:test";
import {
  type AdvisoryExpr,
  type IdentifierNode,
  type LiteralNode,
  type PercentageExpr,
  type VenueRefExpr,
  isAdvisoryExpr,
  isPercentage,
  isVenueRef,
} from "./ast.js";

describe("AST Helpers", () => {
  describe("isAdvisoryExpr", () => {
    test("returns true for advisory expression", () => {
      const expr: AdvisoryExpr = {
        kind: "advisory_expr",
        prompt: "is this safe",
      };
      expect(isAdvisoryExpr(expr)).toBe(true);
    });

    test("returns false for non-advisory expression", () => {
      const expr: LiteralNode = {
        kind: "literal",
        value: 42,
        literalType: "number",
      };
      expect(isAdvisoryExpr(expr)).toBe(false);
    });

    test("returns false for identifier", () => {
      const expr: IdentifierNode = {
        kind: "identifier",
        name: "test",
      };
      expect(isAdvisoryExpr(expr)).toBe(false);
    });
  });

  describe("isVenueRef", () => {
    test("returns true for venue reference", () => {
      const expr: VenueRefExpr = {
        kind: "venue_ref_expr",
        name: "aave_v3",
      };
      expect(isVenueRef(expr)).toBe(true);
    });

    test("returns false for non-venue expression", () => {
      const expr: LiteralNode = {
        kind: "literal",
        value: "aave_v3",
        literalType: "string",
      };
      expect(isVenueRef(expr)).toBe(false);
    });
  });

  describe("isPercentage", () => {
    test("returns true for percentage expression", () => {
      const expr: PercentageExpr = {
        kind: "percentage",
        value: 0.5,
      };
      expect(isPercentage(expr)).toBe(true);
    });

    test("returns false for literal number", () => {
      const expr: LiteralNode = {
        kind: "literal",
        value: 0.5,
        literalType: "number",
      };
      expect(isPercentage(expr)).toBe(false);
    });
  });
});
