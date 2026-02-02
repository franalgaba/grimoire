#!/usr/bin/env bun

import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { getOption, parseArgs, printResult, requireOption } from "./utils.js";

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
    case "withdraw": {
      const amount = requireOption(options, "amount");
      const keystorePath = requireOption(options, "keystore");
      const passwordEnv = getOption(options, "password-env") ?? "KEYSTORE_PASSWORD";
      const password = process.env[passwordEnv];
      if (!password) throw new Error(`${passwordEnv} not set`);

      const { loadPrivateKey } = await import("@grimoire/core");
      const { readFileSync } = await import("node:fs");
      const { privateKeyToAccount } = await import("viem/accounts");

      const keystoreJson = readFileSync(keystorePath, "utf-8");
      const rawKey = loadPrivateKey({ type: "keystore", source: keystoreJson, password });
      const account = privateKeyToAccount(rawKey);
      const destination = (getOption(options, "destination") ?? account.address) as `0x${string}`;

      const exchange = new ExchangeClient({ transport, wallet: account });
      const result = await exchange.withdraw3({ destination, amount });

      console.log(`Withdrew ${amount} USDC from HyperCore`);
      console.log(`  Destination: ${destination}`);
      printResult(result);
      return;
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function printUsage() {
  console.log(
    "\nHyperliquid CLI (grimoire-hyperliquid)\n\nCommands:\n  mids\n  l2-book --coin <symbol>\n  open-orders --user <address>\n  meta\n  spot-meta\n  withdraw --amount <usdc> --keystore <path> [--password-env <var>] [--destination <addr>]\n"
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
