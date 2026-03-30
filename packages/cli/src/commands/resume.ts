import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Address,
  compileFile,
  createProvider,
  createRunRecord,
  createWalletFromConfig,
  execute,
  injectHandoffParams,
  SqliteStateStore,
} from "@grimoirelabs/core";
import chalk from "chalk";
import ora from "ora";
import { parseRequiredNumber, sleep } from "../lib/execution-helpers.js";
import { DEFAULT_KEYSTORE_PATH } from "../lib/keystore.js";
import { promptPassword } from "../lib/prompts.js";
import { createAdvisoryLiveTraceLogger } from "./advisory-live-trace.js";
import { configureOffchainAdapters } from "./cast-cross-chain.js";
import { isCrossChainRunManifest, resolveRpcUrlForChain } from "./cross-chain-helpers.js";

interface ResumeOptions {
  watch?: boolean;
  pollIntervalSec?: string;
  json?: boolean;
  stateDir?: string;
}

export async function resumeCommand(runId: string, options: ResumeOptions) {
  const spinner = ora(`Resuming run ${runId}...`).start();
  const dbPath = options.stateDir ? join(options.stateDir, "grimoire.db") : undefined;
  const store = new SqliteStateStore({ dbPath });

  try {
    const run = await store.getRunById(runId);
    if (!run) {
      spinner.fail(chalk.red(`Run '${runId}' not found.`));
      throw new Error("Resume failed");
    }

    const manifestCandidate = (run.provenance as { cross_chain?: unknown } | undefined)
      ?.cross_chain;
    if (!isCrossChainRunManifest(manifestCandidate)) {
      spinner.fail(chalk.red(`Run '${runId}' is not a resumable cross-chain run.`));
      throw new Error("Resume failed");
    }
    const manifest = manifestCandidate;

    const destinationCompile = await compileFile(manifest.destination_spell_path);
    if (!destinationCompile.success || !destinationCompile.ir) {
      spinner.fail(chalk.red("Destination spell failed to compile during resume."));
      for (const error of destinationCompile.errors) {
        console.error(chalk.red(`  [${error.code}] ${error.message}`));
      }
      throw new Error("Resume failed");
    }
    const destinationSpell = destinationCompile.ir;

    const tracks = await store.getRunTracks(runId);
    const handoffs = await store.getRunHandoffs(runId);
    const destinationTrack = tracks.find((track) => track.trackId === "destination");
    const handoff = handoffs[0];

    if (!destinationTrack || !handoff) {
      spinner.fail(chalk.red("Resume data is incomplete (missing destination track or handoff)."));
      throw new Error("Resume failed");
    }

    if (destinationTrack.status === "completed") {
      spinner.succeed(chalk.green("Destination track is already completed."));
      const result = {
        success: true,
        runId,
        resumed: false as const,
        status: "completed" as const,
      };
      if (options.json) {
        console.error(JSON.stringify(result, null, 2));
      }
      return result;
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
      throw new Error("Resume failed");
    }

    const destinationProvider = createProvider(manifest.destination_chain_id, destinationRpcUrl);

    const keyConfig = await resolveResumeKeyConfig(spinner);
    const configuredAdapters = configureOffchainAdapters(keyConfig);
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
        const result = {
          success: true,
          runId,
          resumed: false as const,
          status: "waiting" as const,
          handoff: handoff.status,
        };
        if (options.json) {
          console.error(JSON.stringify(result, null, 2));
        }
        return result;
      }

      const across = configuredAdapters.find((adapter) => adapter.meta.name === "across");
      const resolver =
        across?.bridgeLifecycle?.resolveHandoffStatus ?? across?.resolveHandoffStatus;
      if (!resolver) {
        spinner.fail(chalk.red("No handoff lifecycle resolver is available for resume."));
        throw new Error("Resume failed");
      }

      spinner.text = "Polling handoff settlement...";
      const pollIntervalSec = options.pollIntervalSec
        ? parseRequiredNumber(options.pollIntervalSec, "--poll-interval-sec")
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
          throw new Error("Resume failed");
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
        throw new Error("Resume failed");
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
      : createAdvisoryLiveTraceLogger(console.error, { verbose: false });
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
      warningCallback: (message) => console.error(chalk.yellow(`Warning: ${message}`)),
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

    const result = {
      success: destinationResult.success,
      runId,
      resumed: true as const,
      receipt: destinationResult.receipt,
      error: destinationResult.structuredError,
    };

    if (options.json) {
      console.error(JSON.stringify(result, null, 2));
    }

    if (!destinationResult.success) {
      throw new Error("Resume failed");
    }

    return result;
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
    throw new Error("Resume failed");
  }

  const envPassword = process.env.KEYSTORE_PASSWORD;
  if (envPassword) {
    const keystoreJson = readFileSync(defaultKeystore, "utf-8");
    return { type: "keystore", source: keystoreJson, password: envPassword };
  }

  if (!process.stdin.isTTY) {
    spinner.fail(chalk.red("Set KEYSTORE_PASSWORD for non-interactive resume."));
    throw new Error("Resume failed");
  }

  spinner.stop();
  const password = await promptPassword("Keystore password: ");
  spinner.start("Resuming run...");
  const keystoreJson = readFileSync(defaultKeystore, "utf-8");
  return { type: "keystore", source: keystoreJson, password };
}
