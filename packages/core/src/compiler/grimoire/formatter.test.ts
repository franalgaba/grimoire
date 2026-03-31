import { describe, expect, test } from "bun:test";
import { formatGrimoire } from "./formatter.js";
import { parse } from "./parser.js";

describe("formatGrimoire", () => {
  test("formats a spell and keeps output parseable", () => {
    const source = `spell Demo {
version: "1.0.0"
params: {
amount: 1000
}
venues: {
dex: @uniswap_v3
}
on manual: {
out = items | map: {
value = value + 1
} | filter: {
pass
}
}
}`;

    const result = formatGrimoire(source);
    expect(result.success).toBe(true);
    expect(result.formatted).toBeDefined();

    const formatted = result.formatted ?? "";
    expect(formatted.endsWith("\n")).toBe(true);
    expect(formatted).toContain('version: "1.0.0"');
    expect(formatted).toContain("params: {");
    expect(formatted).toContain("out = items | map: {");

    // Must remain parseable after canonical formatting.
    parse(formatted);
  });

  test("is idempotent", () => {
    const source = `spell Idempotent {
  version: "1.0.0"
  on manual: {
    pass
  }
}
`;

    const once = formatGrimoire(source);
    expect(once.success).toBe(true);

    const twice = formatGrimoire(once.formatted ?? "");
    expect(twice.success).toBe(true);
    expect(twice.formatted).toBe(once.formatted);
  });

  test("returns parser diagnostics on invalid source", () => {
    const result = formatGrimoire(`spell Broken { version: "1"`);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBeDefined();
    expect(result.error?.message.length ?? 0).toBeGreaterThan(0);
  });
});
