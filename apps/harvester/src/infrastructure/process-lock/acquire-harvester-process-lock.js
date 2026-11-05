import { randomUUID } from "node:crypto"
import { open, mkdir, readFile, unlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { toResult } from "@coinzilla/utils"

/**
 * Acquire an exclusive same-host Harvester trading-process lock.
 * Existing locks are never reclaimed automatically; stale-lock removal requires
 * operator verification that the owning process is no longer running.
 * @param {{ directory: string, lockFileName?: string, pid?: number, hostname?: string, startedAt?: string, token?: string }} input
 */
export async function acquireHarvesterProcessLock({
  directory,
  lockFileName = ".harvester-trading.lock",
  pid = process.pid,
  hostname = os.hostname(),
  startedAt = new Date().toISOString(),
  token = randomUUID(),
} = {}) {
  try {
    if (typeof directory !== "string" || !directory.trim()) {
      throw new TypeError("Harvester process lock requires a non-empty directory")
    }
    if (typeof lockFileName !== "string" || !lockFileName.trim() || path.basename(lockFileName) !== lockFileName) {
      throw new TypeError("Harvester process lock file name must be a non-empty file name")
    }
    if (!Number.isSafeInteger(pid) || pid < 1) {
      throw new TypeError("Harvester process lock pid must be a positive safe integer")
    }
    if (typeof hostname !== "string" || !hostname.trim()) {
      throw new TypeError("Harvester process lock hostname must be a non-empty string")
    }
    if (typeof startedAt !== "string" || !startedAt.trim()) {
      throw new TypeError("Harvester process lock startedAt must be a non-empty string")
    }
    if (typeof token !== "string" || !token.trim()) {
      throw new TypeError("Harvester process lock token must be a non-empty string")
    }

    const resolvedDirectory = path.resolve(directory)
    const lockPath = path.join(resolvedDirectory, lockFileName)
    const owner = Object.freeze({ pid, hostname, startedAt, token })
    await mkdir(resolvedDirectory, { recursive: true })

    let handle
    try {
      handle = await open(lockPath, "wx", 0o600)
      await handle.writeFile(JSON.stringify(owner) + "\n", "utf8")
      await handle.sync()
      await handle.close()
      handle = undefined
    } catch (error) {
      await handle?.close().catch(() => undefined)
      if (error?.code !== "EEXIST") {
        await unlink(lockPath).catch(() => undefined)
        throw error
      }
      let existingOwner
      try {
        existingOwner = JSON.parse(await readFile(lockPath, "utf8"))
      } catch (readError) {
        existingOwner = {
          unreadable: true,
          errorCode: readError?.code ?? "LOCK_FILE_READ_FAILED",
        }
      }
      const conflict = new Error("Another Harvester trading process already owns the process lock")
      conflict.code = "HARVESTER_PROCESS_LOCK_EXISTS"
      conflict.details = { lockPath, existingOwner }
      return toResult({ error: conflict })
    }

    let released = false
    const release = async () => {
      if (released) return toResult({ released: false, alreadyReleased: true })
      try {
        const existingOwner = JSON.parse(await readFile(lockPath, "utf8"))
        if (existingOwner?.token !== token) {
          const error = new Error("Harvester process lock ownership changed; refusing to remove another process lock")
          error.code = "HARVESTER_PROCESS_LOCK_OWNERSHIP_MISMATCH"
          error.details = { lockPath }
          return toResult({ error })
        }
        await unlink(lockPath)
        released = true
        return toResult({ released: true })
      } catch (error) {
        if (error?.code === "ENOENT") {
          released = true
          return toResult({ released: false, alreadyReleased: true })
        }
        return toResult({ error })
      }
    }

    return toResult({ lockPath, owner, release })
  } catch (error) {
    return toResult({ error })
  }
}
