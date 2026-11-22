import { lstat, readdir } from "node:fs/promises"

/**
 * Fail closed when a Harvester process may still own local operational files.
 *
 * @param {{ lockDirectory: string }} input
 * @returns {Promise<void>}
 */
export async function assertHarvesterProcessStopped({ lockDirectory } = {}) {
  if (typeof lockDirectory !== "string" || lockDirectory.trim() === "") {
    throw new TypeError("lockDirectory must be a non-empty path")
  }
  let directoryStats
  try {
    directoryStats = await lstat(lockDirectory)
  } catch (error) {
    if (error?.code === "ENOENT") {
      return
    }
    throw error
  }
  if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
    throw new Error("Harvester process-lock directory is not a regular directory; refusing local operational-state mutation.")
  }
  const entries = await readdir(lockDirectory, { withFileTypes: true })
  if (entries.some((entry) => entry.name.endsWith(".lock"))) {
    throw new Error("A Harvester process lock exists; stop Harvester before resetting or archiving local operational data.")
  }
}
