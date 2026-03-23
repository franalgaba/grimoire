#!/usr/bin/env node

import { getQuote } from "@across-protocol/app-sdk";
import { Cli, z } from "incur";
import { resolveTokenAddress } from "../shared/token-registry.js";

const DEFAULT_CHAINS = [1, 10, 137, 8453, 42161];
const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum",
  10: "Optimism",
  137: "Polygon",
  8453: "Base",
  42161: "Arbitrum",
};

const cli = Cli.create("grimoire-across", {
  description: "Across Protocol bridge — quotes, routes, and deposit status",
  sync: {
    suggestions: [
      "get a bridge quote for USDC from Ethereum to Base",
      "check supported bridge chains",
      "check deposit status by tx hash",
    ],
  },
})
  .use(async (c, next) => {
    const start = performance.now();
    await next();
    if (!c.agent) console.error(`Done in ${(performance.now() - start).toFixed(0)}ms`);
  })
  .command("info", {
    description: "Show adapter info and supported chains",
    run(c) {
      return c.ok(
        {
          name: "across",
          actions: ["bridge"],
          supportedChains: DEFAULT_CHAINS,
          chainNames: CHAIN_NAMES,
          constraints: [
            "max_slippage",
            "min_output",
            "require_quote",
            "require_simulation",
            "max_gas",
          ],
          supportsQuote: true,
          supportsSimulation: true,
        },
        {
          cta: {
            commands: ["chains", "quote --asset USDC --from 1 --to 8453 --amount 1000000000"],
          },
        }
      );
    },
  })
  .command("chains", {
    description: "List supported bridge chains",
    run(c) {
      const chains = DEFAULT_CHAINS.map((id) => ({
        chainId: id,
        name: CHAIN_NAMES[id] ?? `Chain ${id}`,
      }));
      return c.ok(chains, {
        cta: { commands: ["quote --asset USDC --from 1 --to 8453 --amount 1000000000"] },
      });
    },
  })
  .command("quote", {
    description: "Get a bridge quote for an asset between chains",
    alias: { from: "f", to: "t", amount: "a" },
    examples: [
      {
        options: { asset: "USDC", from: 1, to: 8453, amount: "1000000000" },
        description: "Quote bridging 1000 USDC from Ethereum to Base",
      },
    ],
    options: z.object({
      asset: z.string().describe("Asset symbol or address (e.g. USDC, WETH)"),
      from: z.coerce.number().describe("Origin chain ID"),
      to: z.coerce.number().describe("Destination chain ID"),
      amount: z.string().describe("Input amount in smallest unit (wei)"),
      recipient: z
        .string()
        .optional()
        .describe("Recipient address (defaults to zero address for quote)"),
    }),
    async run(c) {
      const { asset, from: originChainId, to: destinationChainId, amount: amountStr } = c.options;
      const amount = BigInt(amountStr);

      const inputToken = resolveAsset(asset, originChainId);
      const outputToken = resolveAsset(asset, destinationChainId);

      const quote = await getQuote({
        route: { originChainId, destinationChainId, inputToken, outputToken },
        inputAmount: amount,
        recipient: (c.options.recipient ??
          "0x0000000000000000000000000000000000000000") as `0x${string}`,
      });

      return c.ok(
        {
          inputAmount: quote.deposit.inputAmount.toString(),
          outputAmount: quote.deposit.outputAmount.toString(),
          estimatedFillTimeSec: quote.estimatedFillTimeSec,
          isAmountTooLow: quote.isAmountTooLow,
          limits: {
            minDeposit: quote.limits.minDeposit.toString(),
            maxDeposit: quote.limits.maxDeposit.toString(),
            maxDepositInstant: quote.limits.maxDepositInstant.toString(),
          },
          fees: {
            lpFee: serializeBigInts(quote.fees.lpFee),
            relayerGasFee: serializeBigInts(quote.fees.relayerGasFee),
            relayerCapitalFee: serializeBigInts(quote.fees.relayerCapitalFee),
            totalRelayFee: serializeBigInts(quote.fees.totalRelayFee),
          },
          route: {
            originChainId,
            destinationChainId,
            inputToken,
            outputToken,
            spokePoolAddress: quote.deposit.spokePoolAddress,
          },
        },
        { cta: { commands: ["status --tx-hash <hash>"] } }
      );
    },
  })
  .command("status", {
    description: "Check bridge deposit status by transaction hash",
    options: z.object({
      txHash: z.string().describe("Origin chain transaction hash"),
      apiUrl: z.string().optional().describe("Across API base URL"),
    }),
    async run(c) {
      const base = c.options.apiUrl?.replace(/\/$/, "") ?? "https://app.across.to/api";
      const url = `${base}/deposits/status?txHash=${encodeURIComponent(c.options.txHash)}`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Across API returned ${response.status}: ${response.statusText}`);
      }

      const payload = await response.json();
      return c.ok(payload);
    },
  })
  .command("routes", {
    description: "List available bridge routes for an asset",
    options: z.object({
      asset: z.string().describe("Asset symbol (e.g. USDC, WETH, ETH)"),
    }),
    run(c) {
      const routes: Array<{
        from: number;
        fromName: string;
        to: number;
        toName: string;
        asset: string;
      }> = [];

      for (const from of DEFAULT_CHAINS) {
        for (const to of DEFAULT_CHAINS) {
          if (from === to) continue;
          try {
            resolveAsset(c.options.asset, from);
            resolveAsset(c.options.asset, to);
            routes.push({
              from,
              fromName: CHAIN_NAMES[from] ?? `Chain ${from}`,
              to,
              toName: CHAIN_NAMES[to] ?? `Chain ${to}`,
              asset: c.options.asset,
            });
          } catch {
            // Asset not available on this chain pair
          }
        }
      }

      if (routes.length === 0) {
        throw new Error(`No bridge routes found for ${c.options.asset} across supported chains`);
      }

      return c.ok(routes, {
        cta: {
          commands: [`quote --asset ${c.options.asset} --from <id> --to <id> --amount <wei>`],
        },
      });
    },
  });

cli.serve();

function resolveAsset(asset: string, chainId: number): `0x${string}` {
  if (asset.startsWith("0x") && asset.length === 42) {
    return asset as `0x${string}`;
  }
  return resolveTokenAddress(asset, chainId) as `0x${string}`;
}

function serializeBigInts(obj: unknown): unknown {
  if (typeof obj === "bigint") return obj.toString();
  if (Array.isArray(obj)) return obj.map(serializeBigInts);
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = serializeBigInts(v);
    }
    return out;
  }
  return obj;
}
