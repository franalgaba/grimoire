/**
 * Validate Command
 * Validates a .spell file
 */

import type {
  ActionStep,
  CompilationWarning,
  SkillDef,
  SpellIR,
  VenueConstraint,
} from "@grimoirelabs/core";
import { compileFile, validateIR } from "@grimoirelabs/core";
import { adapters } from "@grimoirelabs/venues";
import chalk from "chalk";
import ora from "ora";

interface ValidateOptions {
  strict?: boolean;
  json?: boolean;
}

export async function validateCommand(spellPath: string, options: ValidateOptions): Promise<void> {
  const spinner = options.json ? undefined : ora(`Validating ${spellPath}...`).start();

  try {
    const result = await compileFile(spellPath);
    const advisorySummaries = result.ir ? validateIR(result.ir).advisorySummaries : [];
    const venueConstraintWarnings = result.ir ? collectVenueConstraintWarnings(result.ir) : [];
    const warnings = [...result.warnings, ...venueConstraintWarnings];

    // Count issues
    const errorCount = result.errors.length;
    const warningCount = warnings.length;
    const strictFailure = Boolean(options.strict && warningCount > 0);
    const success = result.success && !strictFailure;

    if (options.json) {
      const payload = {
        success,
        strict: Boolean(options.strict),
        spell: result.ir
          ? {
              id: result.ir.id,
              name: result.ir.meta.name,
              version: result.ir.version,
              steps: result.ir.steps.length,
              guards: result.ir.guards.length,
            }
          : undefined,
        errors: result.errors,
        warnings,
        advisory_summaries: advisorySummaries,
      };
      console.log(JSON.stringify(payload, null, 2));
      if (!success) {
        process.exit(1);
      }
      return;
    }

    // Report warnings
    if (warningCount > 0) {
      spinner?.info(chalk.yellow(`${warningCount} warning(s)`));
      for (const warning of warnings) {
        console.log(chalk.yellow(`  [${warning.code}] ${warning.message}`));
        if (warning.line !== undefined) {
          console.log(chalk.dim(`    at line ${warning.line}`));
        }
      }
    }

    // Report errors
    if (errorCount > 0) {
      spinner?.fail(chalk.red(`${errorCount} error(s)`));
      for (const error of result.errors) {
        console.log(chalk.red(`  [${error.code}] ${error.message}`));
        if (error.line !== undefined) {
          console.log(chalk.dim(`    at line ${error.line}`));
        }
      }
    }

    // Final result
    if (!result.success) {
      console.log();
      console.log(chalk.red("✗ Validation failed"));
      process.exit(1);
    }

    if (strictFailure) {
      console.log();
      console.log(chalk.red("✗ Validation failed (strict mode)"));
      process.exit(1);
    }

    if (errorCount === 0 && warningCount === 0) {
      spinner?.succeed(chalk.green("✓ Spell is valid"));
    } else {
      spinner?.succeed(chalk.green("✓ Spell is valid (with warnings)"));
    }

    // Show spell info
    if (result.ir) {
      console.log();
      console.log(chalk.dim("Spell info:"));
      console.log(chalk.dim(`  Name: ${result.ir.meta.name}`));
      console.log(chalk.dim(`  Version: ${result.ir.version}`));
      console.log(chalk.dim(`  Steps: ${result.ir.steps.length}`));
      console.log(chalk.dim(`  Guards: ${result.ir.guards.length}`));
      if (advisorySummaries.length > 0) {
        console.log(chalk.dim(`  Advisory summaries: ${advisorySummaries.length}`));
      }
    }
  } catch (error) {
    spinner?.fail(chalk.red(`Failed to validate: ${(error as Error).message}`));
    process.exit(1);
  }
}

const ACTION_CONSTRAINT_FIELDS: Array<[keyof ActionStep["constraints"], VenueConstraint]> = [
  ["maxSlippageBps", "max_slippage"],
  ["minOutput", "min_output"],
  ["maxInput", "max_input"],
  ["deadline", "deadline"],
  ["maxPriceImpactBps", "max_price_impact"],
  ["minLiquidity", "min_liquidity"],
  ["requireQuote", "require_quote"],
  ["requireSimulation", "require_simulation"],
  ["maxGas", "max_gas"],
];

function collectVenueConstraintWarnings(ir: SpellIR): CompilationWarning[] {
  const warnings: CompilationWarning[] = [];
  const adapterMetaByName = new Map(adapters.map((adapter) => [adapter.meta.name, adapter.meta]));
  const aliases = new Set(ir.aliases.map((alias) => alias.alias));
  const skillsByName = new Map(ir.skills.map((skill) => [skill.name, skill]));
  const seen = new Set<string>();

  for (const step of ir.steps) {
    if (step.kind !== "action") continue;

    const activeConstraints = getActiveConstraints(step);
    if (activeConstraints.length === 0) continue;

    const candidateAdapters = resolveCandidateAdapters(
      step,
      aliases,
      skillsByName,
      adapterMetaByName
    );
    if (candidateAdapters.length === 0) continue;

    for (const constraint of activeConstraints) {
      const supported = candidateAdapters.some((name) =>
        adapterMetaByName.get(name)?.supportedConstraints.includes(constraint)
      );
      if (supported) continue;

      const key = `${step.id}:${constraint}:${candidateAdapters.join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);

      warnings.push({
        code: "UNSUPPORTED_VENUE_CONSTRAINT",
        message:
          `Step '${step.id}' uses constraint '${constraint}' but candidate adapter(s) ` +
          `[${candidateAdapters.join(", ")}] do not declare support`,
        line: ir.sourceMap?.[step.id]?.line,
        column: ir.sourceMap?.[step.id]?.column,
      });
    }
  }

  return warnings;
}

function getActiveConstraints(step: ActionStep): VenueConstraint[] {
  const active: VenueConstraint[] = [];
  const constraints = step.constraints;
  if (!constraints) return active;

  for (const [field, constraint] of ACTION_CONSTRAINT_FIELDS) {
    if (constraints[field] !== undefined) {
      active.push(constraint);
    }
  }

  return active;
}

function resolveCandidateAdapters(
  step: ActionStep,
  aliases: Set<string>,
  skillsByName: Map<string, SkillDef>,
  adapterMetaByName: Map<string, { supportedConstraints: VenueConstraint[] }>
): string[] {
  const selected = new Set<string>();
  const venue = "venue" in step.action ? step.action.venue : undefined;

  if (step.skill) {
    const skill = skillsByName.get(step.skill);
    addSkillAdapters(selected, skill, aliases, adapterMetaByName);
  }

  if (venue) {
    if (aliases.has(venue) && adapterMetaByName.has(venue)) {
      selected.add(venue);
    } else {
      const inferredSkill = skillsByName.get(venue);
      addSkillAdapters(selected, inferredSkill, aliases, adapterMetaByName);
    }
  }

  return Array.from(selected);
}

function addSkillAdapters(
  selected: Set<string>,
  skill: SkillDef | undefined,
  aliases: Set<string>,
  adapterMetaByName: Map<string, { supportedConstraints: VenueConstraint[] }>
): void {
  if (!skill) return;
  for (const adapter of skill.adapters) {
    if (!aliases.has(adapter)) continue;
    if (!adapterMetaByName.has(adapter)) continue;
    selected.add(adapter);
  }
}
