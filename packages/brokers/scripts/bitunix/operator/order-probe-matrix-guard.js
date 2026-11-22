import { readFile, readdir } from "node:fs/promises"
import { resolve } from "node:path"

const PROBE_MARKER_PREFIX = "bitunix-order-probe-"
const PROBE_MARKER_SUFFIX = ".json"

/**
 * Fail closed if any earlier probe was accepted, ambiguous, or did not reach a
 * definitive exchange rejection. A new matrix probe is allowed only after all
 * existing probe markers say REJECTED.
 *
 * @param {{diagnosticsDirectory: string}} input
 * @returns {Promise<void>}
 */
export async function assertBitunixOrderProbeMatrixCanContinue({
  diagnosticsDirectory,
} = {}) {
  if (typeof diagnosticsDirectory !== "string" || !diagnosticsDirectory.trim()) {
    throw new TypeError("Bitunix order probe matrix requires a diagnostics directory")
  }
  let filenames
  try {
    filenames = await readdir(diagnosticsDirectory)
  } catch (error) {
    if (error?.code === "ENOENT") {
      return
    }
    throw error
  }
  const markerFiles = filenames.filter((filename) =>
    filename.startsWith(PROBE_MARKER_PREFIX) && filename.endsWith(PROBE_MARKER_SUFFIX))
  for (const filename of markerFiles) {
    let marker
    try {
      marker = JSON.parse(await readFile(resolve(diagnosticsDirectory, filename), "utf8"))
    } catch (error) {
      throw new Error(`Bitunix order probe matrix blocked: cannot verify prior marker ${filename}`, {
        cause: error,
      })
    }
    if (marker?.status !== "REJECTED") {
      throw new Error(
        `Bitunix order probe matrix blocked: prior probe ${filename} has status ${String(marker?.status ?? "UNKNOWN")}; manual review is required before another probe`,
      )
    }
  }
}
