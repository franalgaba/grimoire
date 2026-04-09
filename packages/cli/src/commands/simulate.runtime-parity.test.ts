import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Address, SpellIR, VenueAdapter } from "@grimoirelabs/core";
import { compile, preview } from "@grimoirelabs/core";
import { simulateCommand } from "./simulate.js";

function assertIR(
  result: ReturnType<typeof compile>
): asserts result is { success: true; ir: SpellIR; errors: never[]; warnings: never[] } {
  if (!result.success || !result.ir) {
    throw new Error(
      `Expected successful compilation: ${result.errors.map((e) => e.message).join(", ")}`
    );
  }
}

function parseLastJson(logs: string[]): Record<string, unknown> {
  for (let i = logs.length - 1; i >= 0; i--) {
    const entry = logs[i]?.trim();
    if (!entry || !entry.startsWith("{")) continue;
    try {
      return JSON.parse(entry) as Record<string, unknown>;
    } catch {
      // Continue searching.
    }
  }

  throw new Error(`No JSON payload found in logs:\n${logs.join("\n")}`);
}

function createTestIO(logs: string[]): {
  log: typeof console.log;
  exit: typeof process.exit;
} {
  return {
    log: (...args: unknown[]) => {
      logs.push(args.map((arg) => String(arg)).join(" "));
    },
    exit: ((code?: number) => {
      throw new Error(`process.exit(${code ?? 0})`);
    }) as typeof process.exit,
  };
}

const VAULT: Address = "0x0000000000000000000000000000000000000000";
const MOCK_UNISWAP_V3_ADAPTER: VenueAdapter = {
  meta: {
    name: "uniswap_v3",
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
const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("Runtime parity: CLI simulate vs embedded preview", () => {
  test("returns equivalent preview schema for action planning", async () => {
    const source = `spell CliParityAction {
  version: "1.0.0"
  assets: [ETH, USDC]

  venues: {
    uniswap: @uniswap_v3
  }

  params: {
    amount: 1000
  }

  on manual: {
    uniswap_v3.swap(ETH, USDC, params.amount)
  }
}`;

    const compileResult = compile(source);
    assertIR(compileResult);

    const embedded = await preview({
      spell: compileResult.ir,
      vault: VAULT,
      chain: 1,
      adapters: [MOCK_UNISWAP_V3_ADAPTER],
    });
    expect(embedded.success).toBe(true);
    expect(embedded.receipt).toBeDefined();

    const dir = await mkdtemp(join(tmpdir(), "grimoire-cli-parity-"));
    tempDirs.push(dir);
    const spellPath = join(dir, "parity.spell");
    await writeFile(spellPath, source, "utf8");

    const logs: string[] = [];

    try {
      await simulateCommand(
        spellPath,
        {
          json: true,
          noState: true,
          chain: "1",
        },
        createTestIO(logs)
      );
    } catch {
      // simulateCommand exits non-zero on failure after printing JSON.
    }

    const parsed = parseLastJson(logs);
    expect(parsed.success).toBe(true);
    expect(parsed.error).toBeUndefined();

    const receipt = parsed.receipt as Record<string, unknown>;
    expect(receipt.phase).toBe("preview");
    expect(receipt.status).toBe("ready");
    expect(Array.isArray(receipt.plannedActions)).toBe(true);
    expect(Array.isArray(receipt.guardResults)).toBe(true);
    expect(Array.isArray(receipt.constraintResults)).toBe(true);

    const embeddedReceipt = embedded.receipt as NonNullable<typeof embedded.receipt>;
    const plannedActions = receipt.plannedActions as unknown[];
    expect(plannedActions.length).toBe(embeddedReceipt.plannedActions.length);
    const guardResults = receipt.guardResults as unknown[];
    expect(guardResults.length).toBe(embeddedReceipt.guardResults.length);
  });

  test("returns equivalent structured error for guard rejection", async () => {
    const source = `spell CliParityGuard {
  version: "1.0.0"

  guards: {
    always_fail: 1 > 2 with severity="halt", message="Guard intentionally fails"
  }

  on manual: {
    x = 1
  }
}`;

    const compileResult = compile(source);
    assertIR(compileResult);

    const embedded = await preview({
      spell: compileResult.ir,
      vault: VAULT,
      chain: 1,
    });
    expect(embedded.success).toBe(false);
    expect(embedded.error?.code).toBe("GUARD_FAILED");

    const dir = await mkdtemp(join(tmpdir(), "grimoire-cli-parity-"));
    tempDirs.push(dir);
    const spellPath = join(dir, "guard-parity.spell");
    await writeFile(spellPath, source, "utf8");

    const logs: string[] = [];

    try {
      await simulateCommand(
        spellPath,
        {
          json: true,
          noState: true,
          chain: "1",
        },
        createTestIO(logs)
      );
    } catch {
      // simulateCommand exits non-zero on failure after printing JSON.
    }

    const parsed = parseLastJson(logs);
    expect(parsed.success).toBe(false);

    const error = parsed.error as Record<string, unknown>;
    expect(error.code).toBe(embedded.error?.code);
    expect(error.phase).toBe("preview");
    expect((parsed.receipt as Record<string, unknown>).status).toBe("rejected");
  });

  test("supports selected-trigger JSON output for multi-handler spells", async () => {
    const source = `spell CliParityMultiTrigger {
  version: "1.0.0"

  on condition 1 > 0 every 10: {
    emit above(level=1)
  }

  on condition 1 > 0 every 10: {
    emit below(level=2)
  }
}`;

    const compileResult = compile(source);
    assertIR(compileResult);
    const triggerId = compileResult.ir.triggerHandlers?.[1]?.selector.id;
    expect(triggerId).toBeDefined();

    const dir = await mkdtemp(join(tmpdir(), "grimoire-cli-trigger-"));
    tempDirs.push(dir);
    const spellPath = join(dir, "multi-trigger.spell");
    await writeFile(spellPath, source, "utf8");

    const logs: string[] = [];

    try {
      await simulateCommand(
        spellPath,
        {
          json: true,
          noState: true,
          chain: "1",
          triggerId,
        },
        createTestIO(logs)
      );
    } catch {
      // simulateCommand exits non-zero on failure after printing JSON.
    }

    const parsed = parseLastJson(logs);
    expect(parsed.success).toBe(true);
    expect((parsed.selectedTrigger as Record<string, unknown>).id).toBe(triggerId);
    expect(parsed.finalState as Record<string, unknown>).toEqual({});

    const events = parsed.events as Array<Record<string, unknown>>;
    expect(events).toHaveLength(1);
    expect(events[0]?.name).toBe("below");
    expect(events[0]?.data).toEqual({ level: 2 });
  });
});
