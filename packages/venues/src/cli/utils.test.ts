import { afterEach, describe, expect, it } from "bun:test";
import { parseArgs, printResult } from "./utils.js";

let originalConsoleLog: typeof console.log;

afterEach(() => {
  if (originalConsoleLog) {
    console.log = originalConsoleLog;
    // @ts-expect-error reset for next test
    originalConsoleLog = undefined;
  }
});

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

describe("printResult", () => {
  it("auto format prints table for flat objects on TTY", () => {
    const logs: string[] = [];
    originalConsoleLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    printResult({ healthy: true }, "auto", { isTTY: true });

    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("key");
    expect(logs[0]).toContain("healthy");
  });

  it("auto format prints JSON for flat objects off TTY", () => {
    const logs: string[] = [];
    originalConsoleLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    printResult({ healthy: true }, "auto", { isTTY: false });

    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('"healthy": true');
  });

  it("auto format prints JSON for nested structures", () => {
    const logs: string[] = [];
    originalConsoleLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    printResult({ universe: [{ name: "BTC" }] }, "auto");

    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('"universe"');
    expect(logs[0]).toContain('"name": "BTC"');
  });

  it("table format summarizes nested values", () => {
    const logs: string[] = [];
    originalConsoleLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    printResult(
      {
        universe: [{ name: "BTC", maxLeverage: 40 }],
        marginTables: [[56, { marginTiers: [{ maxLeverage: 40 }] }]],
        collateralToken: 0,
      },
      "table"
    );

    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("universe");
    expect(logs[0]).toContain("[1 items]");
    expect(logs[0]).toContain("marginTables");
    expect(logs[0]).toContain("collateralToken");
  });
});
