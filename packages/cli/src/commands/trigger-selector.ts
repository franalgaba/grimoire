import type { SelectedTriggerRef } from "@grimoirelabs/core";

const NON_NEGATIVE_INTEGER_PATTERN = /^(0|[1-9]\d*)$/;

export interface TriggerSelectorOptions {
  trigger?: string;
  triggerId?: string;
  triggerIndex?: string;
}

export function resolveSelectedTrigger(
  options: TriggerSelectorOptions
): SelectedTriggerRef | undefined {
  const selectedTrigger: SelectedTriggerRef = {};

  if (options.triggerId) {
    selectedTrigger.id = options.triggerId;
  }
  if (options.triggerIndex !== undefined) {
    if (!NON_NEGATIVE_INTEGER_PATTERN.test(options.triggerIndex)) {
      throw new Error(`Invalid --trigger-index value "${options.triggerIndex}"`);
    }
    const parsed = Number(options.triggerIndex);
    selectedTrigger.index = parsed;
  }
  if (options.trigger) {
    selectedTrigger.label = options.trigger;
  }

  const definedFields = [selectedTrigger.id, selectedTrigger.index, selectedTrigger.label].filter(
    (value) => value !== undefined
  );
  if (definedFields.length > 1) {
    throw new Error("Specify only one of --trigger-id, --trigger-index, or --trigger");
  }

  return definedFields.length === 0 ? undefined : selectedTrigger;
}
