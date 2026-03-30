import { describe, expect, it } from "bun:test";
import { normalizeAdapter, parseVenueArgs, resolveVenueCliPath, venueCommand } from "./venue.js";

describe("venue command helpers", () => {
  it("normalizes adapter names", () => {
    expect(normalizeAdapter("grimoire-morpho_blue")).toBe("morpho-blue");
    expect(normalizeAdapter("Uniswap_V3")).toBe("uniswap-v3");
    expect(normalizeAdapter("PENDLE")).toBe("pendle");
  });

  it("resolves CLI path inside venues package", () => {
    const path = resolveVenueCliPath("morpho-blue");
    const normalized = path.replace(/\\/g, "/");
    const prefersSrcOnBun =
      typeof (process.versions as Record<string, string | undefined>).bun === "string";
    expect(
      prefersSrcOnBun
        ? normalized.endsWith("src/cli/morpho-blue.ts")
        : normalized.endsWith("dist/cli/morpho-blue.js")
    ).toBe(true);
  });

  it("parses pass-through args from a single string", () => {
    expect(parseVenueArgs("spot-meta --format table")).toEqual(["spot-meta", "--format", "table"]);
    expect(parseVenueArgs('l2-book --coin "HYPE PERP"')).toEqual([
      "l2-book",
      "--coin",
      "HYPE PERP",
    ]);
  });

  it("prints usage for missing adapter", () => {
    const logs: string[] = [];
    const originalError = console.error;
    console.error = (message?: unknown) => {
      logs.push(String(message ?? ""));
    };

    venueCommand("" as unknown as string).catch(() => {});

    console.error = originalError;
    const output = logs.join("\n");
    expect(output.includes("grimoire venue <adapter>")).toBe(true);
    expect(output.includes("Adapters:")).toBe(true);
  });
});
