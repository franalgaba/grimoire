/**
 * Interpreter tests
 */

import { describe, expect, test } from "bun:test";
import type { SpellIR } from "../types/ir.js";
import type { Address } from "../types/primitives.js";
import type { Provider } from "../wallet/provider.js";
import type { Wallet } from "../wallet/types.js";
import { execute } from "./interpreter.js";

function createSpellWithGuards(): SpellIR {
  return {
    id: "spell",
    version: "1.0.0",
    meta: {
      name: "spell",
      created: Date.now(),
      hash: "hash",
    },
    aliases: [],
    assets: [],
    skills: [],
    advisors: [{ name: "advisor", model: "haiku", scope: "read-only" }],
    params: [{ name: "value", type: "number", default: 1 }],
    state: { persistent: {}, ephemeral: {} },
    steps: [
      {
        kind: "compute",
        id: "compute_1",
        assignments: [{ variable: "x", expression: { kind: "param", name: "value" } }],
        dependsOn: [],
      },
    ],
    guards: [
      {
        id: "guard_warn",
        check: { kind: "param", name: "value" },
        severity: "warn",
        message: "warn",
      },
      {
        id: "guard_advisory",
        advisor: "advisor",
        check: "safe?",
        severity: "warn",
        fallback: true,
      },
    ],
    triggers: [{ type: "manual" }],
  };
}

describe("Interpreter", () => {
  test("executes with warning guards", async () => {
    const spell = createSpellWithGuards();

    const result = await execute({
      spell,
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
      params: { value: 1 },
      simulate: true,
    });

    expect(result.success).toBe(true);
    expect(result.metrics.stepsExecuted).toBe(1);
  });

  test("halts on guard failures", async () => {
    const spell = createSpellWithGuards();
    spell.guards = [
      {
        id: "guard_fail",
        check: { kind: "literal", value: false, type: "bool" },
        severity: "halt",
        message: "halt",
      },
    ];

    const result = await execute({
      spell,
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
      simulate: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Guard failed");
  });

  test("executes action steps with wallet", async () => {
    const spell: SpellIR = {
      id: "spell",
      version: "1.0.0",
      meta: { name: "spell", created: Date.now(), hash: "hash" },
      aliases: [],
      assets: [
        {
          symbol: "USDC",
          chain: 1,
          address: "0x0000000000000000000000000000000000000001",
          decimals: 6,
        },
      ],
      skills: [],
      advisors: [],
      params: [],
      state: { persistent: {}, ephemeral: {} },
      steps: [
        {
          kind: "action",
          id: "action_1",
          action: {
            type: "transfer",
            asset: "USDC",
            amount: { kind: "literal", value: 10, type: "int" },
            to: "0x0000000000000000000000000000000000000002",
          },
          constraints: {},
          onFailure: "revert",
          dependsOn: [],
        },
      ],
      guards: [],
      triggers: [{ type: "manual" }],
    };

    const wallet = {
      address: "0x0000000000000000000000000000000000000009",
      chainId: 1,
      signTransaction: async () => "0x",
      signMessage: async () => "0x",
      sendTransaction: async () => ({
        hash: "0xabc",
        blockNumber: 1n,
        blockHash: "0xdef",
        gasUsed: 21000n,
        effectiveGasPrice: 100n,
        status: "success",
        logs: [],
      }),
    } as Wallet;

    const provider = {
      chainId: 1,
      rpcUrl: "http://localhost",
      getGasEstimate: async () => ({
        gasLimit: 21000n,
        maxFeePerGas: 100n,
        maxPriorityFeePerGas: 2n,
        estimatedCost: 21000n * 100n,
      }),
      readContract: async () => 0n,
    } as unknown as Provider;

    const result = await execute({
      spell,
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
      wallet,
      provider,
      executionMode: "execute",
      confirmCallback: async () => true,
    });

    expect(result.success).toBe(true);
    expect(result.metrics.actionsExecuted).toBe(1);
  });

  test("skips failing action when configured", async () => {
    const spell: SpellIR = {
      id: "spell",
      version: "1.0.0",
      meta: { name: "spell", created: Date.now(), hash: "hash" },
      aliases: [],
      assets: [
        {
          symbol: "USDC",
          chain: 1,
          address: "0x0000000000000000000000000000000000000001",
          decimals: 6,
        },
      ],
      skills: [],
      advisors: [],
      params: [],
      state: { persistent: {}, ephemeral: {} },
      steps: [
        {
          kind: "action",
          id: "action_fail",
          action: {
            type: "transfer",
            asset: "USDC",
            amount: { kind: "literal", value: 10, type: "int" },
            to: "0x0000000000000000000000000000000000000002",
          },
          constraints: {},
          onFailure: "skip",
          dependsOn: [],
        },
        {
          kind: "compute",
          id: "compute_after",
          assignments: [{ variable: "x", expression: { kind: "literal", value: 1, type: "int" } }],
          dependsOn: [],
        },
      ],
      guards: [],
      triggers: [{ type: "manual" }],
    };

    const wallet = {
      address: "0x0000000000000000000000000000000000000009",
      chainId: 1,
      signTransaction: async () => "0x",
      signMessage: async () => "0x",
      sendTransaction: async () => ({
        hash: "0xabc",
        blockNumber: 1n,
        blockHash: "0xdef",
        gasUsed: 21000n,
        effectiveGasPrice: 100n,
        status: "reverted",
        logs: [],
      }),
    } as Wallet;

    const provider = {
      chainId: 1,
      rpcUrl: "http://localhost",
      getGasEstimate: async () => ({
        gasLimit: 21000n,
        maxFeePerGas: 100n,
        maxPriorityFeePerGas: 2n,
        estimatedCost: 21000n * 100n,
      }),
      readContract: async () => 0n,
    } as unknown as Provider;

    const result = await execute({
      spell,
      vault: "0x0000000000000000000000000000000000000000" as Address,
      chain: 1,
      wallet,
      provider,
      executionMode: "execute",
      confirmCallback: async () => true,
    });

    expect(result.success).toBe(true);
    expect(result.metrics.stepsExecuted).toBeGreaterThan(0);
  });
});
