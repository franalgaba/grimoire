#!/usr/bin/env bun

import { getChainAddresses } from "@morpho-org/blue-sdk";
import { createMorphoBlueAdapter } from "../morpho-blue.js";
import { getOption, parseArgs, printResult } from "./utils.js";

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (!command || command === "help" || options.help) {
    printUsage();
    return;
  }

  switch (command) {
    case "info": {
      const adapter = createMorphoBlueAdapter({ markets: [] });
      printResult(adapter.meta);
      return;
    }
    case "addresses": {
      const chain = Number.parseInt(getOption(options, "chain") ?? "1", 10);
      const addresses = getChainAddresses(chain);
      printResult(addresses);
      return;
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function printUsage() {
  console.log(
    "\nMorpho Blue CLI (grimoire-morpho-blue)\n\nCommands:\n  info\n  addresses [--chain <id>]\n"
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
