#!/usr/bin/env bun

import { createUniswapV3Adapter, defaultUniswapV3Routers } from "../uniswap-v3.js";
import { getOption, parseArgs, printResult } from "./utils.js";

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (!command || command === "help" || options.help) {
    printUsage();
    return;
  }

  switch (command) {
    case "info": {
      const adapter = createUniswapV3Adapter();
      printResult(adapter.meta);
      return;
    }
    case "routers": {
      const chain = getOption(options, "chain");
      if (chain) {
        const chainId = Number.parseInt(chain, 10);
        printResult({ chainId, router: defaultUniswapV3Routers[chainId] ?? null });
        return;
      }
      printResult(defaultUniswapV3Routers);
      return;
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function printUsage() {
  console.log("\nUniswap CLI (grimoire-uniswap)\n\nCommands:\n  info\n  routers [--chain <id>]\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
