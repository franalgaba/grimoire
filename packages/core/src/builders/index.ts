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

export { spell } from "./spell-builder.js";
export type { SpellBuilder } from "./spell-builder.js";

export { action } from "./step-builder.js";
export type { ActionBuilder } from "./step-builder.js";

export { conditional } from "./step-builder.js";
export type { ConditionalBuilder } from "./step-builder.js";

export { repeat, forLoop, until } from "./step-builder.js";
export type { LoopBuilder } from "./step-builder.js";

export { parallel } from "./step-builder.js";
export type { ParallelBuilder } from "./step-builder.js";

export { compute } from "./step-builder.js";
export type { ComputeBuilder } from "./step-builder.js";

export { wait } from "./step-builder.js";
export type { WaitBuilder } from "./step-builder.js";

export { emit } from "./step-builder.js";
export type { EmitBuilder } from "./step-builder.js";

export { halt } from "./step-builder.js";
export type { HaltBuilder } from "./step-builder.js";

export { tryBlock } from "./step-builder.js";
export type { TryBuilder } from "./step-builder.js";

export { advisory } from "./step-builder.js";
export type { AdvisoryBuilder } from "./step-builder.js";

export { pipeline } from "./step-builder.js";
export type { PipelineBuilder } from "./step-builder.js";

export {
  param,
  literal,
  binding,
  binary,
  call,
  arrayAccess,
  propertyAccess,
} from "./expressions.js";
