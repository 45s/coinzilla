import { readdir, unlink } from "node:fs/promises"
import { basename, join } from "node:path"
import { OrderHistoryPersistenceError } from "../order-history-persistence-error.js"
import { readAndValidateManifest } from "./verify-backup.js"

function createRetentionError({ environment, backupFilename, cause } = {}) {
  return new OrderHistoryPersistenceError({
    stage: "backup-retention",
    code: "HARVESTER_HISTORY_BACKUP_RETENTION_FAILED",
    cause,
    context: {
      environment,
      ...(backupFilename ? { backupFilename: basename(backupFilename) } : {}),
    },
  })
}

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

async function removeBackupPair(pair, environment) {
  try {
    await unlink(pair.manifestFilename)
    await unlink(pair.backupFilename)
  } catch (cause) {
    if (cause.code === "ENOENT") {
      return
    }
    throw createRetentionError({
      environment,
      backupFilename: pair.backupFilename,
      cause,
    })
  }
}

export async function rotateBackups({
  backupDirectory,
  environment,
  keep,
} = {}) {
  if (!Number.isSafeInteger(keep) || keep < 1 || keep > 3650) {
    throw createRetentionError({
      environment,
      cause: new TypeError("Backup retention count must be between 1 and 3650."),
    })
  }
  let pairs
  try {
    pairs = await readManagedBackupPairs({
      backupDirectory,
      environment,
    })
  } catch (cause) {
    throw createRetentionError({
      environment,
      cause,
    })
  }
  pairs.sort((left, right) => (
    Date.parse(left.manifest.createdAt) - Date.parse(right.manifest.createdAt)
  ))
  const excessCount = Math.max(0, pairs.length - keep)
  for (const pair of pairs.slice(0, excessCount)) {
    await removeBackupPair(pair, environment)
  }
  return {
    retainedBackupCount: pairs.length - excessCount,
    deletedBackupCount: excessCount,
  }
}
