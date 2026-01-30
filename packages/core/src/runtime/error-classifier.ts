/**
 * Error Classifier
 * Maps error messages to typed ErrorType values for catch block matching
 */

import type { ErrorType } from "../types/steps.js";

const ERROR_PATTERNS: Array<[RegExp, ErrorType]> = [
  [/slippage/i, "slippage_exceeded"],
  [/insufficient.*liquidity/i, "insufficient_liquidity"],
  [/insufficient.*(?:balance|funds)/i, "insufficient_balance"],
  [/venue.*(?:unavailable|down)/i, "venue_unavailable"],
  [/deadline/i, "deadline_exceeded"],
  [/simulation.*fail/i, "simulation_failed"],
  [/policy.*violation/i, "policy_violation"],
  [/guard.*fail/i, "guard_failed"],
  [/revert/i, "tx_reverted"],
  [/(?:gas.*exceed|out.*gas)/i, "gas_exceeded"],
];

/**
 * Classify an error message into a typed ErrorType.
 * Returns null if no pattern matches.
 */
export function classifyError(error: string): ErrorType | null {
  for (const [pattern, errorType] of ERROR_PATTERNS) {
    if (pattern.test(error)) {
      return errorType;
    }
  }
  return null;
}

/**
 * Check whether an error type matches a catch block's error type filter.
 * Wildcard "*" matches any error (including unclassified ones).
 */
export function matchesCatchBlock(
  errorType: ErrorType | null,
  catchErrorType: ErrorType | "*"
): boolean {
  if (catchErrorType === "*") return true;
  return errorType === catchErrorType;
}
