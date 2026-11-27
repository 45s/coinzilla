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

function createBlockingLockError({ lockPath, owner } = {}) {
  const error = new Error(
    `A Harvester process lock exists${describeLockOwner(owner)} at ${lockPath}; stop Harvester before resetting or archiving local operational data.`,
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

async function listHarvesterProcessLockPaths({ lockDirectory } = {}) {
  let directoryStats
  try {
    directoryStats = await lstat(lockDirectory)
  } catch (error) {
    if (error?.code === "ENOENT") {
      return []
    }
    throw error
  }
  if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
    throw new Error("Harvester process-lock directory is not a regular directory; refusing local operational-state mutation.")
  }
  const lockFileNames = (await readdir(lockDirectory))
    .filter((filename) => filename.endsWith(".lock"))
    .sort()
  return lockFileNames.map((filename) => path.join(lockDirectory, filename))
}

async function readLockOwner({ lockPath } = {}) {
  try {
    const owner = JSON.parse(await readFile(lockPath, "utf8"))
    validateLockOwner({ owner, lockPath })
    return owner
  } catch (error) {
    throw new Error(
      `A Harvester process lock exists at ${lockPath}, but its owner metadata cannot be safely inspected; refusing local operational-state mutation.`,
      { cause: error },
    )
  }
}

async function inspectHarvesterProcessLock({ lockPath, hostname, isProcessAlive } = {}) {
  let lockStats
  try {
    lockStats = await lstat(lockPath)
  } catch (error) {
    if (error?.code === "ENOENT") {
      return
    }
    throw error
  }
  if (lockStats.isSymbolicLink() || !lockStats.isFile()) {
    throw createBlockingLockError({ lockPath })
  }

  const owner = await readLockOwner({ lockPath })
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

  const lockPaths = await listHarvesterProcessLockPaths({ lockDirectory })
  for (const lockPath of lockPaths) {
    await inspectHarvesterProcessLock({
      lockPath,
      hostname,
      isProcessAlive,
    })
  }
}
