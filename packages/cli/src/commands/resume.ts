import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as readline from "node:readline";
import { Writable } from "node:stream";
import {
  type Address,
  SqliteStateStore,
  compileFile,
  createProvider,
  createRunRecord,
  createWalletFromConfig,
  execute,
  injectHandoffParams,
  loadPrivateKey,
} from "@grimoirelabs/core";
import { adapters, createHyperliquidAdapter } from "@grimoirelabs/venues";
import chalk from "chalk";
import ora from "ora";
import { createAdvisoryLiveTraceLogger } from "./advisory-live-trace.js";
import { isCrossChainRunManifest, resolveRpcUrlForChain } from "./cross-chain-helpers.js";

const DEFAULT_KEYSTORE_PATH = join(homedir(), ".grimoire", "keystore.json");

interface ResumeOptions {
  watch?: boolean;
  pollIntervalSec?: string;
  json?: boolean;
  stateDir?: string;
}

export async function resumeCommand(runId: string, options: ResumeOptions): Promise<void> {
  const spinner = ora(`Resuming run ${runId}...`).start();
  const dbPath = options.stateDir ? join(options.stateDir, "grimoire.db") : undefined;
  const store = new SqliteStateStore({ dbPath });

  try {
    const run = await store.getRunById(runId);
    if (!run) {
      spinner.fail(chalk.red(`Run '${runId}' not found.`));
      process.exit(1);
    }

    const manifestCandidate = (run.provenance as { cross_chain?: unknown } | undefined)
      ?.cross_chain;
    if (!isCrossChainRunManifest(manifestCandidate)) {
      spinner.fail(chalk.red(`Run '${runId}' is not a resumable cross-chain run.`));
      process.exit(1);
    }
    const manifest = manifestCandidate;

    const destinationCompile = await compileFile(manifest.destination_spell_path);
    if (!destinationCompile.success || !destinationCompile.ir) {
      spinner.fail(chalk.red("Destination spell failed to compile during resume."));
      for (const error of destinationCompile.errors) {
        console.log(chalk.red(`  [${error.code}] ${error.message}`));
      }
      process.exit(1);
    }
    const destinationSpell = destinationCompile.ir;

    const tracks = await store.getRunTracks(runId);
    const handoffs = await store.getRunHandoffs(runId);
    const destinationTrack = tracks.find((track) => track.trackId === "destination");
    const handoff = handoffs[0];

    if (!destinationTrack || !handoff) {
      spinner.fail(chalk.red("Resume data is incomplete (missing destination track or handoff)."));
      process.exit(1);
    }

    if (destinationTrack.status === "completed") {
      spinner.succeed(chalk.green("Destination track is already completed."));
      if (options.json) {
        console.log(
          JSON.stringify({ success: true, runId, resumed: false, status: "completed" }, null, 2)
        );
      }
      return;
    }

    const sourceRpcUrl =
      manifest.rpc_by_chain[manifest.source_chain_id] ??
      resolveRpcUrlForChain(manifest.source_chain_id, {
        byChain: manifest.rpc_by_chain,
        defaultRpcUrl: undefined,
      });
    const destinationRpcUrl =
      manifest.rpc_by_chain[manifest.destination_chain_id] ??
      resolveRpcUrlForChain(manifest.destination_chain_id, {
        byChain: manifest.rpc_by_chain,
        defaultRpcUrl: undefined,
      });
    if (!sourceRpcUrl || !destinationRpcUrl) {
      spinner.fail(chalk.red("Missing RPC mapping in persisted run manifest."));
      process.exit(1);
    }

    const destinationProvider = createProvider(manifest.destination_chain_id, destinationRpcUrl);

    const keyConfig = await resolveResumeKeyConfig(spinner);
    const rawKey = loadPrivateKey(keyConfig);
    const configuredAdapters = adapters.map((adapter) => {
      if (adapter.meta.name === "hyperliquid") {
        return createHyperliquidAdapter({
          privateKey: rawKey,
          assetMap: { ETH: 4 },
        });
      }
      return adapter;
    });
    const destinationWallet = createWalletFromConfig(
      keyConfig,
      manifest.destination_chain_id,
      destinationProvider.rpcUrl
    );
    const vault = manifest.vault as Address;

    if (handoff.status !== "settled") {
      if (!options.watch) {
        spinner.succeed(
          chalk.yellow("Run is waiting for handoff settlement. Use --watch to continue.")
        );
        if (options.json) {
          console.log(
            JSON.stringify(
              {
                success: true,
                runId,
                resumed: false,
                status: "waiting",
                handoff: handoff.status,
              },
              null,
              2
            )
          );
        }
        return;
      }

      const across = configuredAdapters.find((adapter) => adapter.meta.name === "across");
      const resolver =
        across?.bridgeLifecycle?.resolveHandoffStatus ?? across?.resolveHandoffStatus;
      if (!resolver) {
        spinner.fail(chalk.red("No handoff lifecycle resolver is available for resume."));
        process.exit(1);
      }

      spinner.text = "Polling handoff settlement...";
      const pollIntervalSec = options.pollIntervalSec
        ? parseIntStrict(options.pollIntervalSec, "--poll-interval-sec")
        : manifest.poll_interval_sec;
      const deadline = Date.now() + manifest.handoff_timeout_sec * 1000;

      while (Date.now() < deadline) {
        const status = await resolver({
          handoffId: handoff.handoffId,
          originChainId: handoff.originChainId,
          destinationChainId: handoff.destinationChainId,
          originTxHash: handoff.originTxHash,
          reference: handoff.reference,
          asset: handoff.asset,
          submittedAmount: BigInt(handoff.submittedAmount),
          walletAddress: vault,
        });

        if (status.status === "settled") {
          handoff.status = "settled";
          handoff.settledAmount = (
            status.settledAmount ?? BigInt(handoff.submittedAmount)
          ).toString();
          handoff.reference = status.reference ?? handoff.reference;
          handoff.updatedAt = new Date().toISOString();
          await store.upsertRunHandoff(handoff);
          break;
        }

        if (status.status === "failed" || status.status === "expired") {
          handoff.status = status.status === "failed" ? "failed" : "expired";
          handoff.reason = status.reason ?? "Bridge handoff failed";
          handoff.updatedAt = new Date().toISOString();
          await store.upsertRunHandoff(handoff);
          destinationTrack.status = "failed";
          destinationTrack.error = handoff.reason;
          destinationTrack.updatedAt = new Date().toISOString();
          await store.upsertRunTrack(destinationTrack);
          spinner.fail(chalk.red(handoff.reason));
          process.exit(1);
        }

        await sleep(pollIntervalSec * 1000);
      }

      if (handoff.status !== "settled") {
        handoff.status = "expired";
        handoff.reason = `Handoff settlement timed out after ${manifest.handoff_timeout_sec} seconds`;
        handoff.updatedAt = new Date().toISOString();
        await store.upsertRunHandoff(handoff);
        destinationTrack.status = "failed";
        destinationTrack.error = handoff.reason;
        destinationTrack.updatedAt = new Date().toISOString();
        await store.upsertRunTrack(destinationTrack);
        spinner.fail(chalk.red(handoff.reason));
        process.exit(1);
      }
    }

    spinner.text = "Executing destination track...";
    const destinationState = (await store.load(destinationSpell.id)) ?? {};
    const destinationParams = injectHandoffParams(manifest.params, {
      handoffId: handoff.handoffId,
      sourceTrackId: handoff.sourceTrackId,
      destinationTrackId: handoff.destinationTrackId,
      sourceStepId: handoff.sourceStepId,
      originChainId: handoff.originChainId,
      destinationChainId: handoff.destinationChainId,
      asset: handoff.asset,
      submittedAmount: BigInt(handoff.submittedAmount),
      settledAmount: handoff.settledAmount ? BigInt(handoff.settledAmount) : undefined,
      status: handoff.status,
      reference: handoff.reference,
      originTxHash: handoff.originTxHash,
      reason: handoff.reason,
    });

    const advisoryEventCallback = options.json
      ? undefined
      : createAdvisoryLiveTraceLogger(console.log, { verbose: false });
    const destinationResult = await execute({
      spell: destinationSpell,
      runId,
      vault,
      chain: manifest.destination_chain_id,
      params: destinationParams,
      persistentState: destinationState,
      simulate: false,
      executionMode: manifest.mode === "execute" ? "execute" : "dry-run",
      wallet: manifest.mode === "execute" ? destinationWallet : undefined,
      provider: destinationProvider,
      adapters: configuredAdapters,
      eventCallback: advisoryEventCallback,
      crossChain: {
        enabled: true,
        runId,
        trackId: "destination",
        role: "destination",
        morphoMarketIds: manifest.morpho_market_ids,
      },
      warningCallback: (message) => console.log(chalk.yellow(`Warning: ${message}`)),
    });

    await store.save(destinationSpell.id, destinationResult.finalState);
    await store.addRun(
      destinationSpell.id,
      createRunRecord(destinationResult, {
        resumed_from_run_id: runId,
        cross_chain: manifest,
      })
    );
    await store.saveLedger(destinationSpell.id, runId, destinationResult.ledgerEvents);

    destinationTrack.status = destinationResult.success ? "completed" : "failed";
    destinationTrack.error = destinationResult.error;
    destinationTrack.updatedAt = new Date().toISOString();
    await store.upsertRunTrack(destinationTrack);

    spinner.succeed(
      destinationResult.success
        ? chalk.green("Cross-chain run resumed successfully.")
        : chalk.red(`Destination execution failed: ${destinationResult.error}`)
    );

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            success: destinationResult.success,
            runId,
            resumed: true,
            receipt: destinationResult.receipt,
            error: destinationResult.structuredError,
          },
          null,
          2
        )
      );
    }

    if (!destinationResult.success) {
      process.exit(1);
    }
  } finally {
    store.close();
  }
}

async function resolveResumeKeyConfig(
  spinner: ReturnType<typeof ora>
): Promise<{ type: "env" | "keystore"; source: string; password?: string }> {
  const keyEnv = process.env.KEY_ENV;
  if (keyEnv && process.env[keyEnv]) {
    return { type: "env", source: keyEnv };
  }

  const defaultKeystore = DEFAULT_KEYSTORE_PATH;
  if (!existsSync(defaultKeystore)) {
    spinner.fail(
      chalk.red(
        `Resume requires a wallet key. No key found in KEY_ENV and no default keystore at ${defaultKeystore}.`
      )
    );
    process.exit(1);
  }

  const envPassword = process.env.KEYSTORE_PASSWORD;
  if (envPassword) {
    const keystoreJson = readFileSync(defaultKeystore, "utf-8");
    return { type: "keystore", source: keystoreJson, password: envPassword };
  }

  if (!process.stdin.isTTY) {
    spinner.fail(chalk.red("Set KEYSTORE_PASSWORD for non-interactive resume."));
    process.exit(1);
  }

  spinner.stop();
  const password = await promptPassword("Keystore password: ");
  spinner.start("Resuming run...");
  const keystoreJson = readFileSync(defaultKeystore, "utf-8");
  return { type: "keystore", source: keystoreJson, password };
}

async function promptPassword(message: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(message);

    const silentOutput = new Writable({
      write(_chunk, _encoding, cb) {
        cb();
      },
    });

    const rl = readline.createInterface({
      input: process.stdin,
      output: silentOutput,
      terminal: true,
    });

    rl.question("", (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

function parseIntStrict(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
