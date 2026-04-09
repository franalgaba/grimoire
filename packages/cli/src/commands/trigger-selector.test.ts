import { describe, expect, test } from "bun:test";
import { resolveSelectedTrigger } from "./trigger-selector.js";

describe("resolveSelectedTrigger", () => {
  test("parses a valid trigger index", () => {
    expect(resolveSelectedTrigger({ triggerIndex: "12" })).toEqual({ index: 12 });
    expect(resolveSelectedTrigger({ triggerIndex: "0" })).toEqual({ index: 0 });
  });

  test("rejects malformed trigger index values", () => {
    for (const value of ["1foo", "1e2", "01", "-1", "1.5", ""]) {
      expect(() => resolveSelectedTrigger({ triggerIndex: value })).toThrow(
        `Invalid --trigger-index value "${value}"`
      );
    }
  });

  test("rejects multiple selector fields", () => {
    expect(() => resolveSelectedTrigger({ triggerId: "trg_123", trigger: "manual" })).toThrow(
      "Specify only one of --trigger-id, --trigger-index, or --trigger"
    );
  });
});
