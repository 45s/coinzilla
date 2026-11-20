import { readdir, unlink } from "node:fs/promises"
import { join } from "node:path"
import { createBackupError } from "./errors.js"
import { readAndValidateManifest } from "./backup-manifest.js"

async function readManagedBackupPairs({ backupDirectory, environment } = {}) {
  const entries = await readdir(backupDirectory, {
    withFileTypes: true,
  })
  const pairs = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".sqlite.manifest.json")) {
      continue
    }
    const manifestFilename = join(backupDirectory, entry.name)
    const backupFilename = manifestFilename.slice(0, -".manifest.json".length)
    try {
      const validated = await readAndValidateManifest({
        backupFilename,
        backupDirectory,
        environment,
      })
      pairs.push(validated)
    } catch {
      continue
    }
  }
  return pairs
}

function sortBackupPairs(pairs) {
  const pairsByKey = new Map()
  const sortKeys = pairs.map((pair) => {
    const key = `${pair.manifest.createdAt}\u0000${pair.backupFilename}`
    pairsByKey.set(key, pair)
    return key
  }).sort()
  return sortKeys.map((key) => pairsByKey.get(key))
}

async function removeBackupPair({ pair, environment } = {}) {
  try {
    await unlink(pair.manifestFilename)
    await unlink(pair.backupFilename)
  } catch (cause) {
    if (cause.code === "ENOENT") {
      return
    }
    throw createBackupError({
      stage: "backup-retention",
      code: "HARVESTER_HISTORY_BACKUP_RETENTION_FAILED",
      cause,
      environment,
      backupFilename: pair.backupFilename,
    })
  }
}

export async function rotateBackups({
  backupDirectory,
  environment,
  keep,
} = {}) {
  if (!Number.isSafeInteger(keep) || keep < 1 || keep > 3650) {
    throw createBackupError({
      stage: "backup-retention-validation",
      code: "HARVESTER_HISTORY_BACKUP_INVALID_INPUT",
      environment,
    })
  }
  let pairs
  try {
    pairs = await readManagedBackupPairs({
      backupDirectory,
      environment,
    })
  } catch (cause) {
    throw createBackupError({
      stage: "backup-retention",
      code: "HARVESTER_HISTORY_BACKUP_RETENTION_FAILED",
      cause,
      environment,
    })
  }
  const sortedPairs = sortBackupPairs(pairs)
  const excessCount = Math.max(0, sortedPairs.length - keep)
  for (const pair of sortedPairs.slice(0, excessCount)) {
    await removeBackupPair({
      pair,
      environment,
    })
  }
  return {
    retainedBackupCount: sortedPairs.length - excessCount,
    deletedBackupCount: excessCount,
  }
}
