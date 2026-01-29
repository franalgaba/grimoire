/**
 * Expression helpers tests
 */

import { describe, expect, test } from "bun:test";
import { binary, binding, call, literal, param } from "./expressions.js";

describe("Expression helpers", () => {
  test("creates literals with inferred types", () => {
    expect(literal(1).type).toBe("int");
    expect(literal(1.5).type).toBe("float");
    expect(literal(true).type).toBe("bool");
    expect(literal("hello").type).toBe("string");
    expect(literal("0xabc").type).toBe("address");
  });

  test("creates param and binding expressions", () => {
    expect(param("x")).toEqual({ kind: "param", name: "x" });
    expect(binding("y")).toEqual({ kind: "binding", name: "y" });
  });

  test("creates binary and call expressions", () => {
    const expr = binary("+", literal(1), literal(2));
    expect(expr.kind).toBe("binary");

    const fn = call("max", literal(1), literal(2));
    expect(fn.kind).toBe("call");
  });
});
