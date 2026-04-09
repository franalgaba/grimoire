import { compileFile, type TriggerHandlerIR } from "@grimoirelabs/core";
import chalk from "chalk";
import ora from "ora";
import { stringifyJson } from "../lib/json.js";

interface TriggersCommandOptions {
  json?: boolean;
  suppressOutput?: boolean;
}

interface TriggerDescriptor {
  id: string;
  index: number;
  label: string;
  source: {
    line: number;
    column: number;
  };
  trigger: TriggerHandlerIR["trigger"];
  stepCount: number;
  stepIds: string[];
}

export interface TriggersCommandResult {
  success: boolean;
  spell: {
    id: string;
    name: string;
    version: string;
  };
  triggers: TriggerDescriptor[];
}

export async function triggersCommand(
  spellPath: string,
  options: TriggersCommandOptions = {}
): Promise<TriggersCommandResult> {
  const spinner = ora(`Loading triggers for ${spellPath}...`).start();

  try {
    const result = await compileFile(spellPath);

    if (!result.success || !result.ir) {
      spinner.fail(chalk.red("Compilation failed"));
      for (const error of result.errors) {
        console.error(chalk.red(`  [${error.code}] ${error.message}`));
      }
      throw new Error("Triggers inspection failed");
    }

    const handlers = result.ir.triggerHandlers ?? [];
    const payload: TriggersCommandResult = {
      success: true,
      spell: {
        id: result.ir.id,
        name: result.ir.meta.name,
        version: result.ir.version,
      },
      triggers: handlers.map((handler) => ({
        id: handler.selector.id,
        index: handler.selector.index,
        label: handler.selector.label,
        source: handler.selector.source,
        trigger: handler.trigger,
        stepCount: handler.stepIds.length,
        stepIds: [...handler.stepIds],
      })),
    };

    spinner.succeed(chalk.green("Trigger handlers loaded"));

    if (!options.suppressOutput) {
      console.error();
      if (options.json) {
        console.error(stringifyJson(payload));
      } else {
        renderTriggerSummary(payload);
      }
    }

    return payload;
  } catch (error) {
    if ((error as Error).message === "Triggers inspection failed") {
      throw error;
    }
    spinner.fail(chalk.red(`Failed to inspect triggers: ${(error as Error).message}`));
    throw error;
  }
}

function renderTriggerSummary(payload: TriggersCommandResult): void {
  console.error(chalk.cyan(`Trigger handlers for ${payload.spell.name}:`));
  if (payload.triggers.length === 0) {
    console.error(chalk.dim("  No trigger handlers found."));
    return;
  }

  for (const trigger of payload.triggers) {
    console.error(
      `  [${trigger.index}] ${trigger.label} ${chalk.dim(`id=${trigger.id}`)} ${chalk.dim(`@ ${trigger.source.line}:${trigger.source.column}`)}`
    );
    console.error(chalk.dim(`      steps=${trigger.stepCount} type=${trigger.trigger.type}`));
  }
}
