/**
 * Shared keystore path constants and resolver
 */

import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_KEYSTORE_DIR = join(homedir(), ".grimoire");
export const DEFAULT_KEYSTORE_PATH = join(DEFAULT_KEYSTORE_DIR, "keystore.json");

/**
 * Resolve the keystore file path from options or default
 */
export function resolveKeystorePath(options: { keystore?: string }): string {
  return options.keystore ?? DEFAULT_KEYSTORE_PATH;
}
