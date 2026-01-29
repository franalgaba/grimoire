/**
 * Tokenizer tests
 */

import { describe, expect, test } from "bun:test";
import { tokenize } from "./tokenizer.js";

describe("Tokenizer", () => {
  describe("error handling", () => {
    test("throws on unterminated string", () => {
      expect(() => tokenize('"hello')).toThrow();
    });

    test("throws on unterminated advisory", () => {
      expect(() => tokenize("**hello")).toThrow();
    });

    test("throws on empty venue reference", () => {
      expect(() => tokenize("@")).toThrow();
    });

    test("throws on unexpected character", () => {
      expect(() => tokenize("$invalid")).toThrow();
    });
  });

  describe("string escapes", () => {
    test("handles escaped newline", () => {
      const tokens = tokenize('"hello\\nworld"');
      expect(tokens[0]?.value).toBe("hello\nworld");
    });

    test("handles escaped tab", () => {
      const tokens = tokenize('"hello\\tworld"');
      expect(tokens[0]?.value).toBe("hello\tworld");
    });

    test("handles escaped quote", () => {
      const tokens = tokenize('"say \\"hi\\""');
      expect(tokens[0]?.value).toBe('say "hi"');
    });

    test("handles escaped backslash", () => {
      const tokens = tokenize('"path\\\\file"');
      expect(tokens[0]?.value).toBe("path\\file");
    });
  });

  describe("edge cases", () => {
    test("handles empty input", () => {
      const tokens = tokenize("");
      expect(tokens.length).toBe(1);
      expect(tokens[0]?.type).toBe("EOF");
    });

    test("handles whitespace only", () => {
      const tokens = tokenize("   ");
      // May have DEDENT tokens depending on indentation tracking
      expect(tokens[tokens.length - 1]?.type).toBe("EOF");
    });

    test("handles comment only", () => {
      const tokens = tokenize("# just a comment");
      expect(tokens.length).toBe(1);
      expect(tokens[0]?.type).toBe("EOF");
    });

    test("handles tabs as indentation", () => {
      const tokens = tokenize("x\n\ty");
      expect(tokens.some((t) => t.type === "INDENT")).toBe(true);
    });

    test("handles mixed brackets for line continuation", () => {
      const source = `x = (
  1 +
  2
)`;
      const tokens = tokenize(source);
      // Should not have INDENT/DEDENT inside parens
      expect(tokens.filter((t) => t.type === "INDENT").length).toBe(0);
    });

    test("handles single quote strings", () => {
      const tokens = tokenize("'hello'");
      expect(tokens[0]?.type).toBe("STRING");
      expect(tokens[0]?.value).toBe("hello");
    });

    test("handles float starting with dot", () => {
      const tokens = tokenize(".5");
      expect(tokens[0]?.type).toBe("NUMBER");
      expect(tokens[0]?.value).toBe(".5");
    });
  });

  describe("basic tokens", () => {
    test("tokenizes spell declaration", () => {
      const tokens = tokenize("spell TestSpell");
      expect(tokens.map((t) => t.type)).toEqual(["KEYWORD", "IDENTIFIER", "EOF"]);
      expect(tokens[0]?.value).toBe("spell");
      expect(tokens[1]?.value).toBe("TestSpell");
    });

    test("tokenizes numbers", () => {
      const tokens = tokenize("42 3.14 100");
      expect(tokens.map((t) => [t.type, t.value])).toEqual([
        ["NUMBER", "42"],
        ["NUMBER", "3.14"],
        ["NUMBER", "100"],
        ["EOF", ""],
      ]);
    });

    test("tokenizes percentages", () => {
      const tokens = tokenize("50% 0.5% 100%");
      expect(tokens.map((t) => [t.type, t.value])).toEqual([
        ["PERCENTAGE", "0.5"],
        ["PERCENTAGE", "0.005"],
        ["PERCENTAGE", "1"],
        ["EOF", ""],
      ]);
    });

    test("tokenizes strings", () => {
      const tokens = tokenize("\"hello\" 'world'");
      expect(tokens.map((t) => [t.type, t.value])).toEqual([
        ["STRING", "hello"],
        ["STRING", "world"],
        ["EOF", ""],
      ]);
    });

    test("tokenizes addresses", () => {
      const tokens = tokenize("0xAbC123");
      expect(tokens[0]?.type).toBe("ADDRESS");
      expect(tokens[0]?.value).toBe("0xAbC123");
    });

    test("tokenizes booleans", () => {
      const tokens = tokenize("true false");
      expect(tokens.map((t) => [t.type, t.value])).toEqual([
        ["BOOLEAN", "true"],
        ["BOOLEAN", "false"],
        ["EOF", ""],
      ]);
    });

    test("tokenizes operators", () => {
      const tokens = tokenize("+ - * / % == != < > <= >=");
      const operators = tokens.filter((t) => t.type === "OPERATOR");
      expect(operators.map((t) => t.value)).toEqual([
        "+",
        "-",
        "*",
        "/",
        "%",
        "==",
        "!=",
        "<",
        ">",
        "<=",
        ">=",
      ]);
    });
  });

  describe("special tokens", () => {
    test("tokenizes venue references", () => {
      const tokens = tokenize("@aave_v3 @morpho");
      expect(tokens.map((t) => [t.type, t.value])).toEqual([
        ["VENUE_REF", "aave_v3"],
        ["VENUE_REF", "morpho"],
        ["EOF", ""],
      ]);
    });

    test("tokenizes advisory blocks", () => {
      const tokens = tokenize("**is this safe**");
      expect(tokens[0]?.type).toBe("ADVISORY");
      expect(tokens[0]?.value).toBe("is this safe");
    });

    test("tokenizes duration suffixes", () => {
      const tokens = tokenize("10s 5m 2h 1d");
      expect(tokens.map((t) => [t.type, t.value])).toEqual([
        ["NUMBER", "10"],
        ["NUMBER", "300"],
        ["NUMBER", "7200"],
        ["NUMBER", "86400"],
        ["EOF", ""],
      ]);
    });
  });

  describe("indentation", () => {
    test("emits INDENT on deeper indentation", () => {
      const tokens = tokenize("spell Test\n  body");
      const types = tokens.map((t) => t.type);
      expect(types).toContain("INDENT");
    });

    test("emits DEDENT on shallower indentation", () => {
      const tokens = tokenize("spell Test\n  body\nanother");
      const types = tokens.map((t) => t.type);
      expect(types).toContain("DEDENT");
    });

    test("handles multiple indent levels", () => {
      const source = `spell Test
  level1
    level2
  back`;
      const tokens = tokenize(source);
      const types = tokens.map((t) => t.type);
      expect(types.filter((t) => t === "INDENT").length).toBe(2);
      expect(types.filter((t) => t === "DEDENT").length).toBe(2);
    });

    test("ignores indentation inside brackets", () => {
      const source = `x = [
  1,
  2
]`;
      const tokens = tokenize(source);
      // Should not emit INDENT/DEDENT inside brackets
      const types = tokens.map((t) => t.type);
      expect(types).not.toContain("INDENT");
    });
  });

  describe("comments", () => {
    test("skips line comments", () => {
      const tokens = tokenize("x # this is a comment\ny");
      const identifiers = tokens.filter((t) => t.type === "IDENTIFIER");
      expect(identifiers.map((t) => t.value)).toEqual(["x", "y"]);
    });

    test("handles comment-only lines", () => {
      const tokens = tokenize("x\n# comment\ny");
      const identifiers = tokens.filter((t) => t.type === "IDENTIFIER");
      expect(identifiers.map((t) => t.value)).toEqual(["x", "y"]);
    });
  });

  describe("keywords", () => {
    test("recognizes all keywords", () => {
      const keywords = ["spell", "if", "for", "in", "atomic", "emit", "halt", "wait", "on"];
      for (const kw of keywords) {
        const tokens = tokenize(kw);
        expect(tokens[0]?.type).toBe("KEYWORD");
        expect(tokens[0]?.value).toBe(kw);
      }
    });
  });

  describe("complex expressions", () => {
    test("tokenizes method call chain", () => {
      const tokens = tokenize("venue.deposit(asset, amount)");
      expect(tokens.map((t) => t.type)).toEqual([
        "IDENTIFIER",
        "DOT",
        "IDENTIFIER",
        "LPAREN",
        "IDENTIFIER",
        "COMMA",
        "IDENTIFIER",
        "RPAREN",
        "EOF",
      ]);
    });

    test("tokenizes assignment with expression", () => {
      const tokens = tokenize("x = a + b * c");
      expect(tokens.map((t) => t.type)).toEqual([
        "IDENTIFIER",
        "ASSIGN",
        "IDENTIFIER",
        "OPERATOR",
        "IDENTIFIER",
        "OPERATOR",
        "IDENTIFIER",
        "EOF",
      ]);
    });
  });
});
