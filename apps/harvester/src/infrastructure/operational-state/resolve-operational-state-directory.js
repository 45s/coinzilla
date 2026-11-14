import path from "node:path"
import { fileURLToPath } from "node:url"

export const DEFAULT_OPERATIONAL_STATE_DIRECTORY = fileURLToPath(
  new URL("../../../recovery-facts", import.meta.url),
)

/**
 * Resolve the one shared Operational State Store directory.
 * The default is anchored to this module, never to process.cwd() or the home directory.
 */
export function resolveOperationalStateDirectory({ env = process.env } = {}) {
  const directory = env?.OPERATIONAL_STATE_DIRECTORY
  if (directory === undefined) {
    return DEFAULT_OPERATIONAL_STATE_DIRECTORY
  }
  if (typeof directory !== "string" || !directory.trim() ||
      directory !== directory.trim() || !path.isAbsolute(directory)) {
    throw new TypeError(
      "OPERATIONAL_STATE_DIRECTORY must be a non-empty absolute local filesystem path",
    )
  }
  return path.resolve(directory)
}
