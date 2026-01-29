#!/usr/bin/env bun

import { HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { parseArgs, printResult, requireOption } from "./utils.js";

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (!command || command === "help" || options.help) {
    printUsage();
    return;
  }

  const transport = new HttpTransport();
  const info = new InfoClient({ transport });

  switch (command) {
    case "mids": {
      const result = await info.allMids();
      printResult(result);
      return;
    }
    case "l2-book": {
      const coin = requireOption(options, "coin");
      const result = await info.l2Book({ coin });
      printResult(result);
      return;
    }
    case "open-orders": {
      const user = requireOption(options, "user");
      const result = await info.openOrders({ user });
      printResult(result);
      return;
    }
    case "meta": {
      const result = await info.meta();
      printResult(result);
      return;
    }
    case "spot-meta": {
      const result = await info.spotMeta();
      printResult(result);
      return;
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function printUsage() {
  console.log(
    "\nHyperliquid CLI (grimoire-hyperliquid)\n\nCommands:\n  mids\n  l2-book --coin <symbol>\n  open-orders --user <address>\n  meta\n  spot-meta\n"
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
