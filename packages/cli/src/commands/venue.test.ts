import { describe, expect, it } from "bun:test";
import { normalizeAdapter, resolveVenueCliPath, venueCommand } from "./venue.js";

describe("venue command helpers", () => {
  it("normalizes adapter names", () => {
    expect(normalizeAdapter("grimoire-morpho_blue")).toBe("morpho-blue");
    expect(normalizeAdapter("Uniswap_V3")).toBe("uniswap-v3");
  });

  it("resolves CLI path inside venues package", () => {
    const path = resolveVenueCliPath("morpho-blue");
    const normalized = path.replace(/\\/g, "/");
    expect(normalized.endsWith("dist/cli/morpho-blue.js")).toBe(true);
  });

  it("prints usage for missing adapter", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (message?: unknown) => {
      logs.push(String(message ?? ""));
    };

    venueCommand("" as unknown as string).catch(() => {});

    console.log = originalLog;
    const output = logs.join("\n");
    expect(output.includes("grimoire venue <adapter>")).toBe(true);
    expect(output.includes("Adapters:")).toBe(true);
  });
});
