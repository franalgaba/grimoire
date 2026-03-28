/**
 * E2E tests for preview/commit foundation behavior.
 */

import { describe, expect, test } from "bun:test";
import { buildTransactions, commit, compile, execute, preview, signReceipt } from "./index.js";
import type { SpellIR } from "./types/ir.js";
import type { Address, AssetDef } from "./types/primitives.js";
import type { VenueAdapter } from "./venues/types.js";
import type { Provider } from "./wallet/provider.js";
import type { BuiltTransaction } from "./wallet/tx-builder.js";
import type { Wallet } from "./wallet/types.js";

function assertIR(
  result: ReturnType<typeof compile>
): asserts result is { success: true; ir: SpellIR; errors: never[]; warnings: never[] } {
  if (!result.success || !result.ir) {
    throw new Error(
      `Expected successful compilation: ${result.errors.map((e) => e.message).join(", ")}`
    );
  }
}

function getReceipt(result: Awaited<ReturnType<typeof preview>>) {
  if (!result.success || !result.receipt) {
    throw new Error("Expected preview to produce a receipt");
  }

  return result.receipt;
}

const VAULT: Address = "0x0000000000000000000000000000000000000000";
const MOCK_UNISWAP_ADAPTER: VenueAdapter = {
  meta: {
    name: "uniswap",
    supportedChains: [1],
    actions: ["swap"],
    supportedConstraints: [
      "max_slippage",
      "min_output",
      "max_input",
      "deadline",
      "require_quote",
      "require_simulation",
      "max_gas",
    ],
  },
};

function createRuntimeSpell(
  steps: SpellIR["steps"],
  aliases: SpellIR["aliases"] = [],
  assets: SpellIR["assets"] = []
): SpellIR {
  return {
    id: "runtime_spell",
    version: "1.0.0",
    meta: {
      name: "runtime_spell",
      created: Date.now(),
      hash: "runtime-hash",
    },
    aliases,
    assets,
    skills: [],
    advisors: [],
    params: [],
    state: { persistent: {}, ephemeral: {} },
    steps,
    guards: [],
    triggers: [{ type: "manual" }],
  };
}

describe("Preview/Commit E2E", () => {
  describe("preview → commit round trip", () => {
    test("full preview for simple spell produces receipt", async () => {
      const source = `spell RoundTrip {
  version: "1.0.0"

  params: {
    amount: 100
  }

  on manual: {
    result = params.amount * 2
  }
}`;
      const compileResult = compile(source);
      assertIR(compileResult);

      const previewResult = await preview({
        spell: compileResult.ir,
        vault: VAULT,
        chain: 1,
        adapters: [MOCK_UNISWAP_ADAPTER],
      });

      expect(previewResult.success).toBe(true);
      expect(previewResult.receipt).toBeDefined();
      expect(previewResult.receipt?.status).toBe("ready");
      expect(previewResult.receipt?.plannedActions).toHaveLength(0);
      expect(previewResult.receipt?.requiresApproval).toBe(false);
    });
  });

  describe("execute() backward compat", () => {
    test("execute() still returns ExecutionResult", async () => {
      const source = `spell BackwardCompat {
  version: "1.0.0"

  params: {
    x: 5
  }

  on manual: {
    y = params.x * 10
  }
}`;
      const compileResult = compile(source);
      assertIR(compileResult);

      const result = await execute({
        spell: compileResult.ir,
        vault: VAULT,
        chain: 1,
      });

      // Same ExecutionResult shape as before
      expect(result.success).toBe(true);
      expect(result.runId).toBeDefined();
      expect(result.startTime).toBeGreaterThan(0);
      expect(result.endTime).toBeGreaterThanOrEqual(result.startTime);
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.metrics).toBeDefined();
      expect(result.metrics.stepsExecuted).toBeGreaterThan(0);
      expect(result.finalState).toBeDefined();
      expect(result.ledgerEvents).toBeInstanceOf(Array);
    });

    test("execute() with simulate:true uses preview internally", async () => {
      const source = `spell SimulatePreview {
  version: "1.0.0"

  on manual: {
    x = 1
  }
}`;
      const compileResult = compile(source);
      assertIR(compileResult);

      const result = await execute({
        spell: compileResult.ir,
        vault: VAULT,
        chain: 1,
        simulate: true,
      });

      expect(result.success).toBe(true);
      // Preview lifecycle events should be present
      const eventTypes = result.ledgerEvents.map((e) => e.event.type);
      expect(eventTypes).toContain("preview_started");
      expect(eventTypes).toContain("preview_completed");
    });

    test("execute() with wallet enforces preview then commit", async () => {
      const source = `spell WalletFlow {
  version: "1.0.0"
  assets: [ETH]

  venues: {
    wallet: @wallet
  }

  params: {
    amount: 1000
    to: "0x0000000000000000000000000000000000000002"
  }

  on manual: {
    wallet.transfer(ETH, params.amount, params.to)
  }
}`;
      const compileResult = compile(source);
      assertIR(compileResult);

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
        spell: compileResult.ir,
        vault: VAULT,
        chain: 1,
        wallet,
        provider,
        executionMode: "execute",
        confirmCallback: async () => true,
      });

      expect(result.success).toBe(true);
      const eventTypes = result.ledgerEvents.map((e) => e.event.type);
      expect(eventTypes).toContain("preview_started");
      expect(eventTypes).toContain("preview_completed");
      expect(eventTypes).toContain("commit_started");
      expect(eventTypes).toContain("commit_completed");
    });
  });

  describe("Receipt schema contract", () => {
    test("receipt has all required fields from §9.1", async () => {
      const source = `spell ReceiptSchema {
  version: "1.0.0"
  assets: [ETH, USDC]

  venues: {
    uniswap: @uniswap
  }

  params: {
    amount: 1000
  }

  on manual: {
    uniswap.swap(ETH, USDC, params.amount)
  }
}`;
      const compileResult = compile(source);
      assertIR(compileResult);

      const previewResult = await preview({
        spell: compileResult.ir,
        vault: VAULT,
        chain: 1,
        adapters: [MOCK_UNISWAP_ADAPTER],
      });

      expect(previewResult.success).toBe(true);
      const receipt = previewResult.receipt as NonNullable<typeof previewResult.receipt>;

      // Required receipt fields
      expect(receipt.id).toBeDefined();
      expect(receipt.spellId).toBeDefined();
      expect(receipt.phase).toBe("preview");
      expect(receipt.timestamp).toBeGreaterThan(0);
      expect(receipt.chainContext).toBeDefined();
      expect(receipt.chainContext.chainId).toBe(1);
      expect(receipt.chainContext.vault).toBe(VAULT);
      expect(receipt.guardResults).toBeInstanceOf(Array);
      expect(receipt.advisoryResults).toBeInstanceOf(Array);
      expect(receipt.plannedActions).toBeInstanceOf(Array);
      expect(receipt.valueDeltas).toBeInstanceOf(Array);
      expect(receipt.accounting).toBeDefined();
      expect(receipt.constraintResults).toBeInstanceOf(Array);
      expect(receipt.driftKeys).toBeInstanceOf(Array);
      expect(typeof receipt.requiresApproval).toBe("boolean");
      expect(typeof receipt.status).toBe("string");
      expect(receipt.metrics).toBeDefined();
      expect(receipt.finalState).toBeDefined();
      expect(receipt.assets).toBeInstanceOf(Array);
      expect(receipt.assets).toHaveLength(2);
      expect(receipt.assets?.map((asset) => asset.symbol)).toEqual(["ETH", "USDC"]);
    });
  });

  describe("inline advisory expressions", () => {
    test("inline advisory expression now produces compilation error", () => {
      const source = `spell InlineAdvisory {
  version: "1.0.0"

  on manual: {
    if **is this safe** {
      x = 1
    }
  }
}`;
      const compileResult = compile(source);
      expect(compileResult.success).toBe(false);
      expect(compileResult.errors.length).toBeGreaterThan(0);
      const errorMessages = compileResult.errors.map((e) => e.message);
      expect(errorMessages.some((m) => m.includes("Inline advisory expressions"))).toBe(true);
      expect(
        compileResult.errors.some((error) => error.code === "ADVISORY_INLINE_UNSUPPORTED")
      ).toBe(true);
    });
  });

  describe("migrated advisory spells", () => {
    test("explicit advise binding compiles and executes", async () => {
      const source = `spell ExplicitAdvise {
  version: "1.0.0"

  advisors: {
    analyst: {
      model: "anthropic:haiku"
    }
  }

  on manual: {
    decision = advise analyst: "should we proceed" {
      output: {
        type: boolean
      }
      timeout: 10
      fallback: true
    }
    if decision {
      result = "approved"
    } else {
      result = "rejected"
    }
  }
}`;
      const compileResult = compile(source);
      expect(compileResult.success).toBe(true);
      assertIR(compileResult);

      const result = await execute({
        spell: compileResult.ir,
        vault: VAULT,
        chain: 1,
      });

      expect(result.success).toBe(true);
    });

    test("clamp policy records raw and effective advisory outputs", async () => {
      const source = `spell AdvisoryClamp {
  version: "1.0.0"

  advisors: {
    analyst: {
      model: "anthropic:haiku"
    }
  }

  on manual: {
    decision = advise analyst: "score this opportunity" {
      context: 1
      within: constraints
      output: {
        type: number
        min: 0
        max: 10
      }
      on_violation: clamp
      clamp_constraints: [max_slippage]
      timeout: 10
      fallback: 0
    }
    emit advised(score=decision)
  }
}`;
      const compileResult = compile(source);
      assertIR(compileResult);

      const previewResult = await preview({
        spell: compileResult.ir,
        vault: VAULT,
        chain: 1,
        onAdvisory: async () => 100,
      });

      expect(previewResult.success).toBe(true);
      const advisoryResult = previewResult.receipt?.advisoryResults[0];
      expect(advisoryResult).toBeDefined();
      expect(advisoryResult?.rawOutput).toBe(100);
      expect(advisoryResult?.effectiveOutput).toBe(10);
      expect(advisoryResult?.output).toBe(10);
      expect(advisoryResult?.clamped).toBe(true);
      expect(advisoryResult?.onViolation).toBe("clamp");
    });
  });

  describe("preview with state", () => {
    test("preview preserves persistent state", async () => {
      const source = `spell StatefulPreview {
  version: "1.0.0"

  state: {
    persistent: {
      counter: 0
    }
  }

  on manual: {
    counter = counter + 1
  }
}`;
      const compileResult = compile(source);
      assertIR(compileResult);

      const result = await preview({
        spell: compileResult.ir,
        vault: VAULT,
        chain: 1,
        persistentState: { counter: 5 },
      });

      expect(result.success).toBe(true);
      expect(result.receipt?.finalState.counter).toBe(6);
    });
  });

  describe("preview with conditional", () => {
    test("preview evaluates conditionals correctly", async () => {
      const source = `spell ConditionalPreview {
  version: "1.0.0"

  params: {
    threshold: 100
    value: 150
  }

  on manual: {
    if params.value > params.threshold {
      result = "above"
    } else {
      result = "below"
    }
  }
}`;
      const compileResult = compile(source);
      assertIR(compileResult);

      const result = await preview({
        spell: compileResult.ir,
        vault: VAULT,
        chain: 1,
      });

      expect(result.success).toBe(true);
      expect(result.receipt?.status).toBe("ready");
    });
  });

  describe("buildTransactions()", () => {
    const WALLET_ADDRESS: Address = "0x0000000000000000000000000000000000000009";
    const PROVIDER = {
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
    const WALLET: Wallet = {
      address: WALLET_ADDRESS,
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
    };

    const mockBuiltTx: BuiltTransaction = {
      tx: { to: "0x0000000000000000000000000000000000000002" as Address, value: 1000n },
      description: "Mock swap",
      action: {
        type: "swap",
        venue: "uniswap",
        assetIn: "ETH",
        assetOut: "USDC",
        amount: { kind: "literal", value: 1000n, type: "int" },
        mode: "exact_in",
      },
    };

    const MOCK_ADAPTER_WITH_BUILD: VenueAdapter = {
      meta: {
        name: "uniswap",
        supportedChains: [1],
        actions: ["swap"],
        supportedConstraints: ["max_slippage"],
      },
      buildAction: async () => mockBuiltTx,
    };

    test("happy path: compute-only spell returns success with empty transactions", async () => {
      const source = `spell ComputeOnly {
  version: "1.0.0"

  params: {
    x: 42
  }

  on manual: {
    result = params.x * 2
  }
}`;
      const compileResult = compile(source);
      assertIR(compileResult);

      const previewResult = await preview({
        spell: compileResult.ir,
        vault: VAULT,
        chain: 1,
      });

      expect(previewResult.success).toBe(true);
      const receipt = getReceipt(previewResult);

      const buildResult = await buildTransactions({
        receipt,
        walletAddress: WALLET_ADDRESS,
      });

      expect(buildResult.success).toBe(true);
      expect(buildResult.receiptId).toBe(receipt.id);
      expect(buildResult.transactions).toHaveLength(0);
      expect(buildResult.driftChecks).toHaveLength(0);
      expect(buildResult.error).toBeUndefined();
    });

    test("happy path: with venue action returns built transactions", async () => {
      const source = `spell SwapSpell {
  version: "1.0.0"
  assets: [ETH, USDC]

  venues: {
    uniswap: @uniswap
  }

  params: {
    amount: 1000
  }

  on manual: {
    uniswap.swap(ETH, USDC, params.amount)
  }
}`;
      const compileResult = compile(source);
      assertIR(compileResult);

      const previewResult = await preview({
        spell: compileResult.ir,
        vault: VAULT,
        chain: 1,
        adapters: [MOCK_ADAPTER_WITH_BUILD],
      });

      expect(previewResult.success).toBe(true);
      const receipt = getReceipt(previewResult);
      expect(receipt.plannedActions.length).toBeGreaterThan(0);

      const buildResult = await buildTransactions({
        receipt,
        walletAddress: WALLET_ADDRESS,
        provider: PROVIDER,
        adapters: [MOCK_ADAPTER_WITH_BUILD],
      });

      expect(buildResult.success).toBe(true);
      expect(buildResult.transactions).toHaveLength(receipt.plannedActions.length);
      expect(buildResult.transactions[0].stepId).toBeDefined();
      expect(buildResult.transactions[0].builtTransactions).toHaveLength(1);
      expect(buildResult.transactions[0].builtTransactions[0].description).toBe("Mock swap");
    });

    test("rejects offchain adapters even when buildAction returns placeholders", async () => {
      const spellAssets: SpellIR["assets"] = [
        {
          symbol: "PTYOETH",
          chain: 8453,
          address: "0x1111111111111111111111111111111111111111",
          decimals: 18,
        },
      ];
      let capturedExecuteAssets: AssetDef[] | undefined;
      const offchainAdapter: VenueAdapter = {
        meta: {
          name: "offchain_fixture",
          supportedChains: [1],
          actions: ["custom"],
          supportedConstraints: [],
          executionType: "offchain",
        },
        buildAction: async (action) => ({
          tx: {
            to: "0x0000000000000000000000000000000000000000",
            data: "0x",
            value: 0n,
          },
          description: "Offchain placeholder",
          action,
        }),
        executeAction: async (_action, ctx) => {
          capturedExecuteAssets = ctx.assets;
          return {
            id: "offchain-1",
            status: "submitted",
            reference: "session-1",
          };
        },
      };
      const spell = createRuntimeSpell(
        [
          {
            kind: "action",
            id: "custom_offchain",
            action: {
              type: "custom",
              venue: "offchain_fixture",
              op: "session_open",
              args: { arg0: 1 },
            },
            constraints: {},
            dependsOn: [],
            onFailure: "revert",
          },
        ],
        [
          {
            alias: "offchain_fixture",
            chain: 1,
            address: "0x0000000000000000000000000000000000000001",
          },
        ],
        spellAssets
      );

      const previewResult = await preview({
        spell,
        vault: VAULT,
        chain: 1,
        adapters: [offchainAdapter],
      });

      expect(previewResult.success).toBe(true);
      const receipt = getReceipt(previewResult);
      expect(receipt.assets).toEqual(spellAssets);

      // buildTransactions rejects offchain-only adapters — they produce
      // no signable calldata and must go through commit() instead.
      const buildResult = await buildTransactions({
        receipt,
        walletAddress: WALLET_ADDRESS,
        adapters: [offchainAdapter],
      });

      expect(buildResult.success).toBe(false);
      expect(buildResult.error?.code).toBe("BUILD_TRANSACTIONS_FAILED");
      expect(buildResult.error?.message).toContain("does not produce signable transactions");

      // commit() still works for offchain adapters
      const commitResult = await commit({
        receipt,
        wallet: WALLET,
        provider: PROVIDER,
        adapters: [offchainAdapter],
        confirmCallback: async () => true,
      });

      expect(commitResult.success).toBe(true);
      expect(commitResult.transactions[0]?.success).toBe(true);
      expect(commitResult.transactions[0]?.hash).toBe("offchain-1");
      expect(capturedExecuteAssets).toEqual(spellAssets);
    });

    test("compute-only receipts on chain 0 do not require a provider", async () => {
      const source = `spell ComputeOnlyNoProvider {
  version: "1.0.0"

  on manual: {
    x = 1
  }
}`;
      const compileResult = compile(source);
      assertIR(compileResult);

      const previewResult = await preview({
        spell: compileResult.ir,
        vault: VAULT,
        chain: 0,
      });

      expect(previewResult.success).toBe(true);
      const receipt = getReceipt(previewResult);

      const buildResult = await buildTransactions({
        receipt,
        walletAddress: WALLET_ADDRESS,
      });

      expect(buildResult.success).toBe(true);
      expect(buildResult.transactions).toHaveLength(0);
    });

    test("offchain-only receipts on chain 0 fail without instantiating an EVM provider", async () => {
      const offchainAdapter: VenueAdapter = {
        meta: {
          name: "hypercore_fixture",
          supportedChains: [0],
          actions: ["custom"],
          supportedConstraints: [],
          executionType: "offchain",
        },
        buildAction: async (action) => ({
          tx: {
            to: "0x0000000000000000000000000000000000000000",
            data: "0x",
            value: 0n,
          },
          description: "Offchain placeholder",
          action,
        }),
        executeAction: async () => ({
          id: "offchain-0",
          status: "submitted",
        }),
      };
      const spell = createRuntimeSpell(
        [
          {
            kind: "action",
            id: "custom_offchain_chain0",
            action: {
              type: "custom",
              venue: "hypercore_fixture",
              op: "session_open",
              args: {},
            },
            constraints: {},
            dependsOn: [],
            onFailure: "revert",
          },
        ],
        [
          {
            alias: "hypercore_fixture",
            chain: 0,
            address: "0x0000000000000000000000000000000000000004",
          },
        ]
      );

      const previewResult = await preview({
        spell,
        vault: VAULT,
        chain: 0,
        adapters: [offchainAdapter],
      });

      expect(previewResult.success).toBe(true);
      const receipt = getReceipt(previewResult);

      const buildResult = await buildTransactions({
        receipt,
        walletAddress: WALLET_ADDRESS,
        adapters: [offchainAdapter],
      });

      expect(buildResult.success).toBe(false);
      expect(buildResult.error?.code).toBe("BUILD_TRANSACTIONS_FAILED");
      expect(buildResult.error?.message).toContain("does not produce signable transactions");
      expect(buildResult.error?.message).not.toContain("Unsupported chain ID");
    });

    test("skips build failures for steps marked onFailure=skip", async () => {
      const previewAdapter: VenueAdapter = {
        meta: {
          name: "flaky",
          supportedChains: [1],
          actions: ["custom"],
          supportedConstraints: [],
        },
      };
      const spell = createRuntimeSpell(
        [
          {
            kind: "action",
            id: "skippable_custom",
            action: {
              type: "custom",
              venue: "flaky",
              op: "session_open",
              args: {},
            },
            constraints: {},
            dependsOn: [],
            onFailure: "skip",
          },
          {
            kind: "action",
            id: "native_transfer",
            action: {
              type: "transfer",
              asset: "ETH",
              amount: 1000n,
              to: "0x0000000000000000000000000000000000000002",
            },
            constraints: {},
            dependsOn: [],
            onFailure: "revert",
          },
        ],
        [
          {
            alias: "flaky",
            chain: 1,
            address: "0x0000000000000000000000000000000000000003",
          },
        ]
      );

      const previewResult = await preview({
        spell,
        vault: VAULT,
        chain: 1,
        adapters: [previewAdapter],
      });

      expect(previewResult.success).toBe(true);
      const receipt = getReceipt(previewResult);
      expect(receipt.plannedActions).toHaveLength(2);
      expect(receipt.plannedActions[0]?.onFailure).toBe("skip");

      const buildResult = await buildTransactions({
        receipt,
        walletAddress: WALLET_ADDRESS,
        provider: PROVIDER,
      });

      expect(buildResult.success).toBe(true);
      expect(buildResult.transactions).toHaveLength(1);
      expect(buildResult.transactions[0]?.stepId).toBe("native_transfer");
      expect(buildResult.transactions[0]?.builtTransactions).toHaveLength(1);
      expect(buildResult.transactions[0]?.builtTransactions[0]?.action.type).toBe("transfer");

      const commitResult = await commit({
        receipt,
        wallet: WALLET,
        provider: PROVIDER,
        confirmCallback: async () => true,
      });

      expect(commitResult.success).toBe(true);
      expect(commitResult.transactions).toHaveLength(2);
      expect(commitResult.transactions[0]).toMatchObject({
        stepId: "skippable_custom",
        success: false,
      });
      expect(commitResult.transactions[1]).toMatchObject({
        stepId: "native_transfer",
        success: true,
      });
    });

    test("error: receipt not ready", async () => {
      const source = `spell NotReady {
  version: "1.0.0"

  on manual: {
    x = 1
  }
}`;
      const compileResult = compile(source);
      assertIR(compileResult);

      const previewResult = await preview({
        spell: compileResult.ir,
        vault: VAULT,
        chain: 1,
      });

      expect(previewResult.success).toBe(true);
      const receipt = { ...getReceipt(previewResult), status: "rejected" as const };

      const buildResult = await buildTransactions({
        receipt,
        walletAddress: WALLET_ADDRESS,
      });

      expect(buildResult.success).toBe(false);
      expect(buildResult.error?.code).toBe("RECEIPT_INVALID_STATUS");
    });

    test("rejects conflicting options.assets when receipt already has assets", async () => {
      const source = `spell AssetConflict {
  version: "1.0.0"
  assets: [ETH]

  on manual: {
    x = 1
  }
}`;
      const compileResult = compile(source);
      assertIR(compileResult);

      const previewResult = await preview({
        spell: compileResult.ir,
        vault: VAULT,
        chain: 1,
      });
      const receipt = getReceipt(previewResult);
      expect(receipt.assets).toBeDefined();

      const buildResult = await buildTransactions({
        receipt,
        walletAddress: WALLET_ADDRESS,
        assets: [
          {
            symbol: "ETH",
            chain: 1,
            address: "0x2222222222222222222222222222222222222222",
            decimals: 18,
          },
        ],
      });

      expect(buildResult.success).toBe(false);
      expect(buildResult.error?.code).toBe("ASSET_CONTEXT_MISMATCH");
    });

    test("no side effects: buildTransactions does not prevent subsequent commit", async () => {
      const source = `spell NoSideEffects {
  version: "1.0.0"
  assets: [ETH]

  venues: {
    wallet: @wallet
  }

  params: {
    amount: 1000
    to: "0x0000000000000000000000000000000000000002"
  }

  on manual: {
    wallet.transfer(ETH, params.amount, params.to)
  }
}`;
      const compileResult = compile(source);
      assertIR(compileResult);

      const previewResult = await preview({
        spell: compileResult.ir,
        vault: VAULT,
        chain: 1,
      });

      expect(previewResult.success).toBe(true);
      const receipt = getReceipt(previewResult);

      // First: buildTransactions
      const buildResult = await buildTransactions({
        receipt,
        walletAddress: WALLET_ADDRESS,
        provider: PROVIDER,
      });
      expect(buildResult.success).toBe(true);

      // Second: commit still works on same receipt
      const commitResult = await commit({
        receipt,
        wallet: WALLET,
        provider: PROVIDER,
        confirmCallback: async () => true,
      });
      expect(commitResult.success).toBe(true);
    });

    test("rejects already-committed receipts", async () => {
      const source = `spell AlreadyCommitted {
  version: "1.0.0"

  on manual: {
    x = 1
  }
}`;
      const compileResult = compile(source);
      assertIR(compileResult);

      const previewResult = await preview({
        spell: compileResult.ir,
        vault: VAULT,
        chain: 1,
      });

      expect(previewResult.success).toBe(true);
      const receipt = getReceipt(previewResult);

      // Commit first
      const commitResult = await commit({
        receipt,
        wallet: WALLET,
        provider: PROVIDER,
        confirmCallback: async () => true,
      });
      expect(commitResult.success).toBe(true);

      // buildTransactions after commit should be rejected
      const buildResult = await buildTransactions({
        receipt,
        walletAddress: WALLET_ADDRESS,
        provider: PROVIDER,
      });
      expect(buildResult.success).toBe(false);
      expect(buildResult.error?.code).toBe("RECEIPT_ALREADY_COMMITTED");
    });

    test("accepts cross-process receipts with valid integrity", async () => {
      // Simulate a receipt that was produced by a different process:
      // valid structure but not in the in-memory issuedReceipts map.
      const secret = "test-secret-key";
      const crossProcessReceipt = {
        id: `rcpt_cross_process_test_${Date.now()}`,
        spellId: "cross_process_spell",
        phase: "preview" as const,
        timestamp: Date.now(),
        chainContext: { chainId: 1, vault: VAULT },
        guardResults: [],
        advisoryResults: [],
        plannedActions: [],
        valueDeltas: [],
        accounting: { assets: [], totalUnaccounted: 0n, passed: true },
        constraintResults: [],
        driftKeys: [],
        requiresApproval: false,
        status: "ready" as const,
        metrics: {
          stepsExecuted: 0,
          actionsExecuted: 0,
          gasUsed: 0n,
          advisoryCalls: 0,
          errors: 0,
          retries: 0,
        },
        finalState: {},
      };

      const integrity = signReceipt(crossProcessReceipt, secret);

      const buildResult = await buildTransactions({
        receipt: crossProcessReceipt,
        walletAddress: WALLET_ADDRESS,
        receiptSecret: secret,
        receiptIntegrity: integrity,
      });

      expect(buildResult.success).toBe(true);
      expect(buildResult.receiptId).toBe(crossProcessReceipt.id);
      expect(buildResult.transactions).toHaveLength(0);
    });

    test("rejects cross-process receipts without integrity", async () => {
      const crossProcessReceipt = {
        id: `rcpt_no_integrity_${Date.now()}`,
        spellId: "cross_process_spell",
        phase: "preview" as const,
        timestamp: Date.now(),
        chainContext: { chainId: 1, vault: VAULT },
        guardResults: [],
        advisoryResults: [],
        plannedActions: [],
        valueDeltas: [],
        accounting: { assets: [], totalUnaccounted: 0n, passed: true },
        constraintResults: [],
        driftKeys: [],
        requiresApproval: false,
        status: "ready" as const,
        metrics: {
          stepsExecuted: 0,
          actionsExecuted: 0,
          gasUsed: 0n,
          advisoryCalls: 0,
          errors: 0,
          retries: 0,
        },
        finalState: {},
      };

      const buildResult = await buildTransactions({
        receipt: crossProcessReceipt,
        walletAddress: WALLET_ADDRESS,
      });

      expect(buildResult.success).toBe(false);
      expect(buildResult.error?.code).toBe("RECEIPT_INTEGRITY_MISSING");
    });

    test("rejects cross-process receipts with tampered actions", async () => {
      const secret = "test-secret-key";
      const crossProcessReceipt = {
        id: `rcpt_tampered_${Date.now()}`,
        spellId: "cross_process_spell",
        phase: "preview" as const,
        timestamp: Date.now(),
        chainContext: { chainId: 1, vault: VAULT },
        guardResults: [],
        advisoryResults: [],
        plannedActions: [],
        valueDeltas: [],
        accounting: { assets: [], totalUnaccounted: 0n, passed: true },
        constraintResults: [],
        driftKeys: [],
        requiresApproval: false,
        status: "ready" as const,
        metrics: {
          stepsExecuted: 0,
          actionsExecuted: 0,
          gasUsed: 0n,
          advisoryCalls: 0,
          errors: 0,
          retries: 0,
        },
        finalState: {},
      };

      // Sign the original receipt
      const integrity = signReceipt(crossProcessReceipt, secret);

      // Tamper: change spellId after signing
      const tampered = { ...crossProcessReceipt, spellId: "evil_spell" };

      const buildResult = await buildTransactions({
        receipt: tampered,
        walletAddress: WALLET_ADDRESS,
        receiptSecret: secret,
        receiptIntegrity: integrity,
      });

      expect(buildResult.success).toBe(false);
      expect(buildResult.error?.code).toBe("RECEIPT_INTEGRITY_FAILED");
    });

    test("rejects cross-process receipts with tampered assets", async () => {
      const secret = "test-secret-key";
      const crossProcessReceipt = {
        id: `rcpt_tampered_assets_${Date.now()}`,
        spellId: "cross_process_spell",
        phase: "preview" as const,
        timestamp: Date.now(),
        chainContext: { chainId: 1, vault: VAULT },
        guardResults: [],
        advisoryResults: [],
        plannedActions: [],
        valueDeltas: [],
        accounting: { assets: [], totalUnaccounted: 0n, passed: true },
        constraintResults: [],
        driftKeys: [],
        requiresApproval: false,
        status: "ready" as const,
        metrics: {
          stepsExecuted: 0,
          actionsExecuted: 0,
          gasUsed: 0n,
          advisoryCalls: 0,
          errors: 0,
          retries: 0,
        },
        finalState: {},
        assets: [
          {
            symbol: "PTYOETH",
            chain: 8453,
            address: "0x1111111111111111111111111111111111111111" as Address,
            decimals: 18,
          },
        ],
      };

      const integrity = signReceipt(crossProcessReceipt, secret);
      const tampered = {
        ...crossProcessReceipt,
        assets: [
          {
            symbol: "PTYOETH",
            chain: 8453,
            address: "0x2222222222222222222222222222222222222222" as Address,
            decimals: 18,
          },
        ],
      };

      const buildResult = await buildTransactions({
        receipt: tampered,
        walletAddress: WALLET_ADDRESS,
        receiptSecret: secret,
        receiptIntegrity: integrity,
      });

      expect(buildResult.success).toBe(false);
      expect(buildResult.error?.code).toBe("RECEIPT_INTEGRITY_FAILED");
    });

    test("rejects provider with wrong chain", async () => {
      const source = `spell ChainMismatch {
  version: "1.0.0"

  on manual: {
    x = 1
  }
}`;
      const compileResult = compile(source);
      assertIR(compileResult);

      const previewResult = await preview({
        spell: compileResult.ir,
        vault: VAULT,
        chain: 1,
      });
      const receipt = getReceipt(previewResult);

      // Provider is for chain 137 (Polygon), but receipt is for chain 1
      const wrongChainProvider = {
        ...PROVIDER,
        chainId: 137,
      } as unknown as Provider;

      const buildResult = await buildTransactions({
        receipt,
        walletAddress: WALLET_ADDRESS,
        provider: wrongChainProvider,
      });

      expect(buildResult.success).toBe(false);
      expect(buildResult.error?.code).toBe("CHAIN_MISMATCH");
      expect(buildResult.error?.message).toContain("137");
      expect(buildResult.error?.message).toContain("1");
    });

    test("commit rejects provider with wrong chain", async () => {
      const source = `spell CommitChainMismatch {
  version: "1.0.0"

  on manual: {
    x = 1
  }
}`;
      const compileResult = compile(source);
      assertIR(compileResult);

      const previewResult = await preview({
        spell: compileResult.ir,
        vault: VAULT,
        chain: 1,
      });
      const receipt = getReceipt(previewResult);
      const wrongChainProvider = {
        ...PROVIDER,
        chainId: 137,
      } as unknown as Provider;

      const commitResult = await commit({
        receipt,
        wallet: WALLET,
        provider: wrongChainProvider,
        confirmCallback: async () => true,
      });

      expect(commitResult.success).toBe(false);
      expect(commitResult.error?.code).toBe("CHAIN_MISMATCH");
      expect(commitResult.error?.message).toContain("137");
      expect(commitResult.error?.message).toContain("1");
    });

    test("forwards vault from receipt to adapter context", async () => {
      const SIGNER: Address = "0x0000000000000000000000000000000000000099";
      const SPELL_VAULT: Address = "0x0000000000000000000000000000000000000077";
      let capturedContext:
        | { walletAddress?: string; vault?: string; assets?: AssetDef[] }
        | undefined;

      const adapterWithCapture: VenueAdapter = {
        meta: {
          name: "uniswap",
          supportedChains: [1],
          actions: ["swap"],
          supportedConstraints: [],
        },
        buildAction: async (_action, ctx) => {
          capturedContext = {
            walletAddress: ctx.walletAddress,
            vault: ctx.vault,
            assets: ctx.assets,
          };
          return mockBuiltTx;
        },
      };

      const source = `spell VaultForward {
  version: "1.0.0"
  assets: [ETH, USDC]

  venues: {
    uniswap: @uniswap
  }

  params: {
    amount: 1000
  }

  on manual: {
    uniswap.swap(ETH, USDC, params.amount)
  }
}`;
      const compileResult = compile(source);
      assertIR(compileResult);

      const previewResult = await preview({
        spell: compileResult.ir,
        vault: SPELL_VAULT,
        chain: 1,
        adapters: [adapterWithCapture],
      });

      const receipt = getReceipt(previewResult);
      expect(receipt.chainContext.vault).toBe(SPELL_VAULT);

      const buildResult = await buildTransactions({
        receipt,
        walletAddress: SIGNER,
        provider: PROVIDER,
        adapters: [adapterWithCapture],
      });

      expect(buildResult.success).toBe(true);
      expect(capturedContext).toBeDefined();
      expect(capturedContext?.walletAddress).toBe(SIGNER);
      expect(capturedContext?.vault).toBe(SPELL_VAULT);
      expect(capturedContext?.assets).toEqual(receipt.assets);
    });
  });
});
