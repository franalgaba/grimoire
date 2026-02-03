#!/usr/bin/env node

import { AaveClient, chainId, evmAddress } from "@aave/client";
import { chains, health, market, markets, reserve } from "@aave/client/actions";
import { getOption, parseArgs, printResult, requireOption } from "./utils.js";

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (!command || command === "help" || options.help) {
    printUsage();
    return;
  }

  const client = AaveClient.create();

  switch (command) {
    case "health": {
      const result = await unwrap(health(client));
      printResult({ healthy: result });
      return;
    }
    case "chains": {
      const result = await unwrap(chains(client));
      printResult(result);
      return;
    }
    case "markets": {
      const chain = Number.parseInt(getOption(options, "chain") ?? "1", 10);
      const user = getOption(options, "user");
      const result = await unwrap(
        markets(client, {
          chainIds: [chainId(chain)],
          user: user ? evmAddress(user) : undefined,
        })
      );
      printResult(result);
      return;
    }
    case "market": {
      const chain = Number.parseInt(requireOption(options, "chain"), 10);
      const address = requireOption(options, "address");
      const user = getOption(options, "user");
      const result = await unwrap(
        market(client, {
          chainId: chainId(chain),
          address: evmAddress(address),
          user: user ? evmAddress(user) : undefined,
        })
      );
      printResult(result);
      return;
    }
    case "reserve": {
      const chain = Number.parseInt(requireOption(options, "chain"), 10);
      const marketAddress = requireOption(options, "market");
      const token = requireOption(options, "token");
      const result = await unwrap(
        reserve(client, {
          chainId: chainId(chain),
          market: evmAddress(marketAddress),
          underlyingToken: evmAddress(token),
        })
      );
      printResult(result);
      return;
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function printUsage() {
  console.log(
    "\nAave CLI (grimoire-aave)\n\nCommands:\n  health\n  chains\n  markets --chain <id> [--user <address>]\n  market --chain <id> --address <market> [--user <address>]\n  reserve --chain <id> --market <address> --token <address>\n"
  );
}

type AaveResult<T> = {
  isErr?: () => boolean;
  error?: { message?: string };
  value?: T;
};

async function unwrap<T>(result: Promise<AaveResult<T> | T> | AaveResult<T> | T): Promise<T> {
  const resolved = await result;

  if (resolved && typeof resolved === "object" && "isErr" in resolved) {
    const aaveResult = resolved as AaveResult<T>;
    if (aaveResult.isErr?.()) {
      throw new Error(aaveResult.error?.message ?? "Aave request failed");
    }
    if (aaveResult.value !== undefined) {
      return aaveResult.value;
    }
  }

  return resolved as T;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
