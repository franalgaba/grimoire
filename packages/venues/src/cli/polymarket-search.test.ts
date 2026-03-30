import { describe, expect, test } from "bun:test";
import { streamSearchMarkets } from "./polymarket-search.js";

describe("streamSearchMarkets", () => {
  test("rejects unfiltered searches", () => {
    const run = () =>
      streamSearchMarkets({
        openOnly: false,
        activeOnly: false,
        ignoreEndDate: false,
        tradableOnly: false,
        allPages: true,
        maxPages: 1,
        stopAfterEmptyPages: 1,
        limit: 10,
      }).next();

    expect(run).toThrow(
      "search-markets requires at least one of --query, --slug, --question, --sport, --category, --league, --event, --tag, --open-only, --active-only, or --tradable-only"
    );
  });

  test("accepts boolean-only filters", () => {
    const run = () =>
      streamSearchMarkets({
        openOnly: true,
        activeOnly: true,
        ignoreEndDate: false,
        tradableOnly: false,
        allPages: true,
        maxPages: 0,
        stopAfterEmptyPages: 1,
        limit: 10,
      }).next();

    expect(run).toThrow("--max-pages must be >= 1");
  });
});
