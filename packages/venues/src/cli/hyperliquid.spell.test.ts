import { describe, expect, it } from "bun:test";
import {
  printL2BookSpellSnapshot,
  printMetaSpellSnapshot,
  printMidsSpellSnapshot,
  printOpenOrdersSpellSnapshot,
  printSpotMetaSpellSnapshot,
} from "./hyperliquid.js";

function captureOutput(fn: () => void): string {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map((arg) => String(arg)).join(" "));
  };

  try {
    fn();
  } finally {
    console.log = originalLog;
  }

  return logs.join("\n");
}

describe("hyperliquid spell snapshots", () => {
  it("prints mids snapshot params", () => {
    const output = captureOutput(() => printMidsSpellSnapshot({ BTC: "50000", ETH: "2500" }));

    expect(output.includes("params:")).toBe(true);
    expect(output.includes("mid_assets")).toBe(true);
    expect(output.includes('"BTC"')).toBe(true);
    expect(output.includes("mid_prices")).toBe(true);
  });

  it("prints l2 book snapshot params", () => {
    const output = captureOutput(() =>
      printL2BookSpellSnapshot(
        {
          coin: "ETH",
          time: 123456,
          levels: [[{ px: "2500", sz: "1.2", n: 2 }], [{ px: "2501", sz: "0.8", n: 1 }]],
        },
        { coin: "ETH" }
      )
    );

    expect(output.includes("l2_coin")).toBe(true);
    expect(output.includes("l2_bids_px")).toBe(true);
    expect(output.includes("l2_asks_px")).toBe(true);
  });

  it("prints open orders snapshot params", () => {
    const output = captureOutput(() =>
      printOpenOrdersSpellSnapshot(
        [
          {
            coin: "ETH",
            side: "B",
            limitPx: "2500",
            sz: "1",
            oid: 12,
            timestamp: 123456,
            origSz: "1",
          },
        ],
        { user: "0x0000000000000000000000000000000000000000" }
      )
    );

    expect(output.includes("open_order_coins")).toBe(true);
    expect(output.includes('"ETH"')).toBe(true);
    expect(output.includes("open_order_limit_px")).toBe(true);
  });

  it("prints perp meta snapshot params", () => {
    const output = captureOutput(() =>
      printMetaSpellSnapshot({
        universe: [
          {
            name: "ETH",
            szDecimals: 2,
            maxLeverage: 10,
            marginTableId: 1,
            onlyIsolated: true,
            marginMode: "strictIsolated",
          },
        ],
      })
    );

    expect(output.includes("perp_universe_names")).toBe(true);
    expect(output.includes('"ETH"')).toBe(true);
  });

  it("prints spot meta snapshot params", () => {
    const output = captureOutput(() =>
      printSpotMetaSpellSnapshot({
        universe: [
          {
            name: "USDC",
            index: 1,
            isCanonical: true,
          },
        ],
        tokens: [
          {
            name: "USDC",
            szDecimals: 2,
            weiDecimals: 6,
            index: 1,
            tokenId: "0x0000000000000000000000000000000000000000",
            isCanonical: true,
            evmContract: { address: "0x0000000000000000000000000000000000000001" },
          },
        ],
      })
    );

    expect(output.includes("spot_token_names")).toBe(true);
    expect(output.includes('"USDC"')).toBe(true);
    expect(output.includes("spot_universe_names")).toBe(true);
  });
});
