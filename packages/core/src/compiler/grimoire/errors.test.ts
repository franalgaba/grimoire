/**
 * Error types tests
 */

import { describe, expect, test } from "bun:test";
import {
  GrimoireError,
  IndentationError,
  ParseError,
  TokenizeError,
  TransformError,
  formatErrors,
  loc,
  span,
} from "./errors.js";

describe("Error Types", () => {
  describe("GrimoireError", () => {
    test("creates error with code and message", () => {
      const error = new GrimoireError("TEST_ERROR", "Test message");
      expect(error.code).toBe("TEST_ERROR");
      expect(error.message).toBe("Test message");
      expect(error.name).toBe("GrimoireError");
    });

    test("creates error with location", () => {
      const error = new GrimoireError("TEST_ERROR", "Test message", {
        location: { line: 5, column: 10, offset: 50 },
      });
      expect(error.location).toEqual({ line: 5, column: 10, offset: 50 });
    });

    test("creates error with span", () => {
      const start = { line: 1, column: 1, offset: 0 };
      const end = { line: 1, column: 10, offset: 9 };
      const error = new GrimoireError("TEST_ERROR", "Test message", {
        span: { start, end },
      });
      expect(error.span).toEqual({ start, end });
    });

    test("creates error with source", () => {
      const error = new GrimoireError("TEST_ERROR", "Test message", {
        source: "spell Test\n  version: 1.0",
      });
      expect(error.source).toBe("spell Test\n  version: 1.0");
    });

    test("format() returns formatted error without location", () => {
      const error = new GrimoireError("TEST_ERROR", "Test message");
      const formatted = error.format();
      expect(formatted).toContain("Error [TEST_ERROR]");
      expect(formatted).toContain("Test message");
    });

    test("format() returns formatted error with location", () => {
      const error = new GrimoireError("TEST_ERROR", "Test message", {
        location: { line: 2, column: 5, offset: 15 },
      });
      const formatted = error.format();
      expect(formatted).toContain("line 2, column 5");
    });

    test("format() includes source context", () => {
      const source = "spell Test\n  invalid syntax here";
      const error = new GrimoireError("TEST_ERROR", "Invalid syntax", {
        location: { line: 2, column: 3, offset: 13 },
        source,
      });
      const formatted = error.format();
      expect(formatted).toContain("invalid syntax here");
      expect(formatted).toContain("^");
    });

    test("format() handles out of bounds line", () => {
      const error = new GrimoireError("TEST_ERROR", "Test message", {
        location: { line: 100, column: 1, offset: 0 },
        source: "single line",
      });
      const formatted = error.format();
      expect(formatted).toContain("Error [TEST_ERROR]");
    });
  });

  describe("TokenizeError", () => {
    test("creates tokenize error", () => {
      const error = new TokenizeError("Unexpected character");
      expect(error.name).toBe("TokenizeError");
      expect(error.code).toBe("TOKENIZE_ERROR");
      expect(error.message).toBe("Unexpected character");
    });

    test("creates tokenize error with location", () => {
      const error = new TokenizeError("Unexpected '@'", {
        location: { line: 1, column: 5, offset: 4 },
      });
      expect(error.location).toEqual({ line: 1, column: 5, offset: 4 });
    });
  });

  describe("ParseError", () => {
    test("creates parse error", () => {
      const error = new ParseError("Expected identifier");
      expect(error.name).toBe("ParseError");
      expect(error.code).toBe("PARSE_ERROR");
    });

    test("creates parse error with span", () => {
      const error = new ParseError("Unexpected token", {
        span: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 5, offset: 4 },
        },
      });
      expect(error.span).toBeDefined();
    });
  });

  describe("IndentationError", () => {
    test("creates indentation error", () => {
      const error = new IndentationError("Mismatched indent");
      expect(error.name).toBe("IndentationError");
      expect(error.code).toBe("INDENTATION_ERROR");
    });
  });

  describe("TransformError", () => {
    test("creates transform error", () => {
      const error = new TransformError("Cannot transform node");
      expect(error.name).toBe("TransformError");
      expect(error.code).toBe("TRANSFORM_ERROR");
    });
  });

  describe("Helper functions", () => {
    test("loc() creates source location", () => {
      const location = loc(5, 10, 50);
      expect(location).toEqual({ line: 5, column: 10, offset: 50 });
    });

    test("span() creates source span", () => {
      const start = loc(1, 1, 0);
      const end = loc(1, 10, 9);
      const s = span(start, end);
      expect(s).toEqual({ start, end });
    });

    test("formatErrors() formats multiple errors", () => {
      const errors = [
        new GrimoireError("ERROR1", "First error"),
        new GrimoireError("ERROR2", "Second error"),
      ];
      const formatted = formatErrors(errors);
      expect(formatted).toContain("ERROR1");
      expect(formatted).toContain("ERROR2");
      expect(formatted).toContain("First error");
      expect(formatted).toContain("Second error");
    });

    test("formatErrors() handles empty array", () => {
      const formatted = formatErrors([]);
      expect(formatted).toBe("");
    });
  });
});
