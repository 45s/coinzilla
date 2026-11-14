import path from "node:path"
import { fileURLToPath } from "node:url"

export const DEFAULT_OPERATIONAL_STATE_DIRECTORY = fileURLToPath(
  new URL("../../../recovery-facts", import.meta.url),
)

/**
 * Resolve the one shared Operational State Store directory.
 * DURABLE_FACTS_DIRECTORY remains a legacy compatibility alias.
 */
export function resolveOperationalStateDirectory({ env = process.env } = {}) {
  const configured = env?.OPERATIONAL_STATE_DIRECTORY
  const legacyConfigured = env?.DURABLE_FACTS_DIRECTORY

  if (configured !== undefined && legacyConfigured !== undefined &&
      (typeof configured !== "string" || typeof legacyConfigured !== "string" ||
       !configured.trim() || !legacyConfigured.trim() ||
       path.resolve(configured) !== path.resolve(legacyConfigured))) {
    throw new TypeError(
      "OPERATIONAL_STATE_DIRECTORY and legacy DURABLE_FACTS_DIRECTORY must resolve to the same directory when both are set",
    )
  }

  const directory = configured ?? legacyConfigured
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
