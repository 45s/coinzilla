import { readFile, readdir } from "node:fs/promises"
import { resolve } from "node:path"

const PROBE_MARKER_PREFIX = "bitunix-order-probe-"
const PROBE_MARKER_SUFFIX = ".json"

function validateMatrixGuardInput({ diagnosticsDirectory, probeId }) {
  if (typeof diagnosticsDirectory !== "string" || !diagnosticsDirectory.trim() ||
      typeof probeId !== "string" || !probeId.trim()) {
    throw new TypeError("Bitunix order probe matrix requires a diagnostics directory and probe id")
  }
}

async function listProbeMarkerFiles({ diagnosticsDirectory }) {
  try {
    const filenames = await readdir(diagnosticsDirectory)
    return filenames.filter((filename) =>
      filename.startsWith(PROBE_MARKER_PREFIX) && filename.endsWith(PROBE_MARKER_SUFFIX))
  } catch (error) {
    if (error?.code === "ENOENT") {
      return []
    }
    throw error
  }
}

function assertProbeIdIsUnused({ markerFiles, probeId }) {
  const selectedMarker = `${PROBE_MARKER_PREFIX}${probeId}${PROBE_MARKER_SUFFIX}`
  if (markerFiles.includes(selectedMarker)) {
    throw new Error(`Bitunix order probe matrix blocked: probe ${probeId} already has a one-shot marker`)
  }
}

async function readProbeMarker({ diagnosticsDirectory, filename }) {
  try {
    return JSON.parse(await readFile(resolve(diagnosticsDirectory, filename), "utf8"))
  } catch (error) {
    throw new Error(`Bitunix order probe matrix blocked: cannot verify prior marker ${filename}`, {
      cause: error,
    })
  }
}

function assertPriorProbeWasRejected({ marker, filename }) {
  if (marker?.status !== "REJECTED") {
    throw new Error(
      `Bitunix order probe matrix blocked: prior probe ${filename} has status ${String(marker?.status ?? "UNKNOWN")}; manual review is required before another probe`,
    )
  }
}

/**
 * Fail closed if any earlier probe was accepted, ambiguous, or did not reach a
 * definitive exchange rejection. A new matrix probe is allowed only after all
 * existing probe markers say REJECTED. A probe ID itself is one-shot.
 *
 * @param {{diagnosticsDirectory: string, probeId: string}} input
 * @returns {Promise<void>}
 */
export async function assertBitunixOrderProbeMatrixCanContinue({
  diagnosticsDirectory,
  probeId,
} = {}) {
  validateMatrixGuardInput({
    diagnosticsDirectory,
    probeId,
  })
  const markerFiles = await listProbeMarkerFiles({
    diagnosticsDirectory,
  })
  assertProbeIdIsUnused({
    markerFiles,
    probeId,
  })
  for (const filename of markerFiles) {
    const marker = await readProbeMarker({
      diagnosticsDirectory,
      filename,
    })
    assertPriorProbeWasRejected({
      marker,
      filename,
    })
  }
}
