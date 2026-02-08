import { describe, expect, test } from "bun:test";
import type { EnsProfile } from "./ens-profile.js";
import { hydrateParamsFromEnsProfile } from "./ens-profile.js";

describe("ENS profile helpers", () => {
  test("hydrates default params from ENS profile", () => {
    const profile: EnsProfile = {
      name: "vault.eth",
      address: "0x0000000000000000000000000000000000000001",
      text: {
        "io.grimoire.risk_profile": "balanced",
        "io.grimoire.max_slippage_bps": "50",
        "io.grimoire.preferred_settlement_chain": "8453",
      },
      riskProfile: "balanced",
      maxSlippageBps: 50,
      preferredSettlementChain: 8453,
    };

    const hydrated = hydrateParamsFromEnsProfile({}, profile);
    expect(hydrated.payout_address).toBe("0x0000000000000000000000000000000000000001");
    expect(hydrated.risk_profile).toBe("balanced");
    expect(hydrated.max_slippage_bps).toBe(50);
    expect(hydrated.preferred_settlement_chain).toBe(8453);
  });

  test("does not overwrite explicit params", () => {
    const profile: EnsProfile = {
      name: "vault.eth",
      address: "0x0000000000000000000000000000000000000001",
      text: {},
      riskProfile: "conservative",
      maxSlippageBps: 25,
      preferredSettlementChain: 1,
    };

    const hydrated = hydrateParamsFromEnsProfile(
      {
        payout_address: "0x0000000000000000000000000000000000000009",
        risk_profile: "aggressive",
        max_slippage_bps: 90,
        preferred_settlement_chain: 42161,
      },
      profile
    );

    expect(hydrated.payout_address).toBe("0x0000000000000000000000000000000000000009");
    expect(hydrated.risk_profile).toBe("aggressive");
    expect(hydrated.max_slippage_bps).toBe(90);
    expect(hydrated.preferred_settlement_chain).toBe(42161);
  });

  test("clamps ENS max_slippage_bps into safe bounds", () => {
    const highProfile: EnsProfile = {
      name: "vault.eth",
      text: {},
      maxSlippageBps: 5_000,
    };

    const lowProfile: EnsProfile = {
      name: "vault.eth",
      text: {},
      maxSlippageBps: -12,
    };

    expect(hydrateParamsFromEnsProfile({}, highProfile).max_slippage_bps).toBe(500);
    expect(hydrateParamsFromEnsProfile({}, lowProfile).max_slippage_bps).toBe(0);
  });
});
