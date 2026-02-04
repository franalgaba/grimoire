import { describe, expect, it } from "bun:test";
import { parseArgs } from "./utils.js";

describe("parseArgs", () => {
  it("treats --help as global help", () => {
    const result = parseArgs(["--help"]);
    expect(result.command).toBeUndefined();
    expect(result.options.help).toBe(true);
  });

  it("treats -h as global help", () => {
    const result = parseArgs(["-h"]);
    expect(result.command).toBeUndefined();
    expect(result.options.help).toBe(true);
  });

  it("captures help after command", () => {
    const result = parseArgs(["vaults", "--help"]);
    expect(result.command).toBe("vaults");
    expect(result.options.help).toBe(true);
  });

  it("parses options with values", () => {
    const result = parseArgs(["vaults", "--chain", "8453", "--asset", "USDC"]);
    expect(result.command).toBe("vaults");
    expect(result.options.chain).toBe("8453");
    expect(result.options.asset).toBe("USDC");
  });
});
