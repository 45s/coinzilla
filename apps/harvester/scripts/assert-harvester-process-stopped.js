import { lstat, readFile, readdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  isHarvesterProcessAlive,
  reclaimStaleHarvesterProcessLockIfUnchanged,
} from "../src/infrastructure/process-lock/acquire-harvester-process-lock.js"

function describeLockOwner(owner) {
  if (!Number.isSafeInteger(owner?.pid) || typeof owner?.hostname !== "string") {
    return ""
  }
  return ` (PID ${owner.pid}, host ${owner.hostname})`
}

function createBlockingLockError({ lockPath, owner, cause } = {}) {
  const error = new Error(
    `A Harvester process lock exists${describeLockOwner(owner)} at ${lockPath}; stop Harvester before resetting or archiving local operational data.`,
    cause ? { cause } : undefined,
  )
  error.code = "HARVESTER_PROCESS_LOCK_EXISTS"
  return error
}

function validateLockOwner({ owner, lockPath } = {}) {
  const validOwner = (
    Number.isSafeInteger(owner?.pid)
    && owner.pid > 0
    && typeof owner?.hostname === "string"
    && owner.hostname.trim() !== ""
    && typeof owner?.startedAt === "string"
    && owner.startedAt.trim() !== ""
    && typeof owner?.token === "string"
    && owner.token.trim() !== ""
  )
  if (!validOwner) {
    throw new Error(`Harvester process-lock metadata is invalid; refusing to inspect or remove ${lockPath}.`)
  }
}

/**
 * Fail closed when a Harvester process may still own local operational files.
 * Reclaims only same-host locks with a confirmed-dead PID and unchanged ownership.
 *
 * @param {{ lockDirectory: string, hostname?: string, isProcessAlive?: (pid: number) => boolean }} input
 * @returns {Promise<void>}
 */
export async function assertHarvesterProcessStopped({
  lockDirectory,
  hostname = os.hostname(),
  isProcessAlive = isHarvesterProcessAlive,
} = {}) {
  if (typeof lockDirectory !== "string" || lockDirectory.trim() === "") {
    throw new TypeError("lockDirectory must be a non-empty path")
  }
  if (typeof hostname !== "string" || hostname.trim() === "") {
    throw new TypeError("hostname must be a non-empty string")
  }
  if (typeof isProcessAlive !== "function") {
    throw new TypeError("isProcessAlive must be a function")
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

  const entries = (await readdir(lockDirectory, { withFileTypes: true }))
    .filter((entry) => entry.name.endsWith(".lock"))
    .sort((first, second) => first.name.localeCompare(second.name))

  for (const entry of entries) {
    const lockPath = path.join(lockDirectory, entry.name)
    let lockStats
    try {
      lockStats = await lstat(lockPath)
    } catch (error) {
      if (error?.code === "ENOENT") {
        continue
      }
      throw error
    }
    if (lockStats.isSymbolicLink() || !lockStats.isFile()) {
      throw createBlockingLockError({ lockPath })
    }

    let owner
    try {
      owner = JSON.parse(await readFile(lockPath, "utf8"))
      validateLockOwner({ owner, lockPath })
    } catch (error) {
      throw new Error(
        `Cannot safely inspect Harvester process-lock metadata at ${lockPath}; refusing local operational-state mutation.`,
        { cause: error },
      )
    }

    let reclaimed
    try {
      reclaimed = await reclaimStaleHarvesterProcessLockIfUnchanged({
        lockPath,
        hostname,
        existingOwner: owner,
        attempt: 0,
        checkProcessAlive: isProcessAlive,
      })
    } catch (error) {
      throw new Error(
        `Cannot safely inspect Harvester process owner${describeLockOwner(owner)} at ${lockPath}; refusing local operational-state mutation.`,
        { cause: error },
      )
    }
    if (!reclaimed) {
      throw createBlockingLockError({ lockPath, owner })
    }
  }
}
