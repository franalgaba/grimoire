/**
 * Fluent API for building spells programmatically
 *
 * @example
 * ```ts
 * import { spell, action, conditional } from "@grimoirelabs/core/builders";
 *
 * const mySpell = spell("MyStrategy")
 *   .version("1.0.0")
 *   .description("A sample strategy")
 *   .asset("USDC", { chain: 1, address: "0x..." })
 *   .step(
 *     conditional(binary(binding("balance"), ">", literal(1000)))
 *       .then("swapStep")
 *       .build()
 *   );
 * ```
 */

export {
  arrayAccess,
  binary,
  binding,
  call,
  literal,
  param,
  propertyAccess,
} from "./expressions.js";
export type { SpellBuilder } from "./spell-builder.js";
export { spell } from "./spell-builder.js";
export type {
  ActionBuilder,
  AdvisoryBuilder,
  ComputeBuilder,
  ConditionalBuilder,
  EmitBuilder,
  HaltBuilder,
  LoopBuilder,
  ParallelBuilder,
  PipelineBuilder,
  TryBuilder,
  WaitBuilder,
} from "./step-builder.js";
export {
  action,
  advisory,
  compute,
  conditional,
  emit,
  forLoop,
  halt,
  parallel,
  pipeline,
  repeat,
  tryBlock,
  until,
  wait,
} from "./step-builder.js";
