import { describe, expect, test } from "bun:test";
import type { VenueAdapter } from "@grimoirelabs/core";
import { parseVenueDoctorArgs, runVenueDoctor } from "./venue-doctor.js";

function makeAdapter(meta: VenueAdapter["meta"]): VenueAdapter {
  return {
    meta,
  };
}

describe("venue doctor", () => {
  test("parses args", () => {
    const parsed = parseVenueDoctorArgs([
      "--chain",
      "1",
      "--adapter",
      "uniswap",
      "--rpc-url",
      "https://rpc.example",
      "--json",
    ]);

    expect(parsed).toEqual({
      chainId: 1,
      adapter: "uniswap",
      rpcUrl: "https://rpc.example",
      json: true,
    });
  });

  test("returns help marker", () => {
    const parsed = parseVenueDoctorArgs(["--help"]);
    expect(parsed).toEqual({ help: true });
  });

  test("checks registration, env, chain, and rpc reachability", async () => {
    const adapters: VenueAdapter[] = [
      makeAdapter({
        name: "uniswap_v3",
        supportedChains: [1],
        actions: ["swap"],
        supportedConstraints: [],
        requiredEnv: ["API_KEY"],
      }),
      makeAdapter({
        name: "uniswap_v4",
        supportedChains: [1],
        actions: ["swap"],
        supportedConstraints: [],
      }),
    ];

    const report = await runVenueDoctor(
      { chainId: 1, adapter: "uniswap" },
      {
        adapters,
        env: { API_KEY: "set" },
        createProviderFn: () => ({
          rpcUrl: "https://rpc.example",
          getBlockNumber: async () => 123n,
        }),
      }
    );

    expect(report.ok).toBe(true);
    expect(report.adapters).toHaveLength(2);
    expect(report.rpcBlockNumber).toBe("123");
    expect(report.checks.find((check) => check.name === "rpc_reachability")?.status).toBe("pass");
  });

  test("fails when required env vars are missing", async () => {
    const adapters: VenueAdapter[] = [
      makeAdapter({
        name: "hyperliquid",
        supportedChains: [999],
        actions: ["custom"],
        supportedConstraints: [],
        requiredEnv: ["HYPERLIQUID_PRIVATE_KEY"],
      }),
    ];

    const report = await runVenueDoctor(
      { chainId: 999, adapter: "hyperliquid" },
      {
        adapters,
        env: {},
        createProviderFn: () => ({
          rpcUrl: "https://rpc.hyperliquid.xyz/evm",
          getBlockNumber: async () => 1n,
        }),
      }
    );

    expect(report.ok).toBe(false);
    expect(report.adapters[0]?.missingEnv).toContain("HYPERLIQUID_PRIVATE_KEY");
    expect(report.checks.find((check) => check.name === "required_env")?.status).toBe("fail");
  });

  test("fails when chain is unsupported", async () => {
    const adapters: VenueAdapter[] = [
      makeAdapter({
        name: "across",
        supportedChains: [1, 8453],
        actions: ["bridge"],
        supportedConstraints: [],
      }),
    ];

    const report = await runVenueDoctor(
      { chainId: 42161, adapter: "across" },
      {
        adapters,
        env: {},
        createProviderFn: () => ({
          rpcUrl: "https://rpc.example",
          getBlockNumber: async () => 77n,
        }),
      }
    );

    expect(report.ok).toBe(false);
    expect(report.adapters[0]?.chainSupported).toBe(false);
    expect(report.checks.find((check) => check.name === "chain_support")?.status).toBe("fail");
  });

  test("marks rpc check failed when provider call fails", async () => {
    const adapters: VenueAdapter[] = [
      makeAdapter({
        name: "aave_v3",
        supportedChains: [1],
        actions: ["lend"],
        supportedConstraints: [],
      }),
    ];

    const report = await runVenueDoctor(
      { chainId: 1, adapter: "aave_v3" },
      {
        adapters,
        env: {},
        createProviderFn: () => ({
          getBlockNumber: async () => {
            throw new Error("RPC unavailable");
          },
        }),
      }
    );

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.name === "rpc_reachability")?.status).toBe("fail");
  });
});
