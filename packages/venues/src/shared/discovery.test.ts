import { describe, expect, test } from "bun:test";
import { discoverBuiltinVenues } from "./discovery.js";

describe("discoverBuiltinVenues", () => {
  test("includes underscore and dashed aliases for uniswap and aave", () => {
    const manifests = discoverBuiltinVenues();

    const uniswap = manifests.find((manifest) => manifest.name === "uniswap");
    expect(uniswap).toBeDefined();
    expect(uniswap?.aliases).toContain("uniswap-v4");
    expect(uniswap?.aliases).toContain("uniswap_v4");
    expect(uniswap?.aliases).toContain("uniswap-v3");
    expect(uniswap?.aliases).toContain("uniswap_v3");

    const aave = manifests.find((manifest) => manifest.name === "aave");
    expect(aave).toBeDefined();
    expect(aave?.aliases).toContain("aave-v3");
    expect(aave?.aliases).toContain("aave_v3");
  });
});
