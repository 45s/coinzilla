import {
  mkdtemp,
  rm,
} from "node:fs/promises"
import { join } from "node:path"
import { OrderHistoryPersistenceError } from "../order-history-persistence-error.js"
import { createBackupError } from "./errors.js"
import { readAndValidateManifest } from "./backup-manifest.js"
import { resolveBackupDirectory } from "./backup-paths.js"
import { restoreAndValidate } from "./backup-sqlite.js"

async function cleanupRestoreDirectory({
  directory,
  failure,
  environment,
  backupFilename,
} = {}) {
  try {
    await rm(directory, {
      recursive: true,
      force: true,
    })
    return failure
  } catch (cause) {
    return failure
      ? new AggregateError([failure, cause], "Restore candidate cleanup failed.")
      : createBackupError({
        stage: "restore-cleanup",
        code: "HARVESTER_HISTORY_BACKUP_CLEANUP_FAILED",
        cause,
        environment,
        backupFilename,
      })
  }
}

export async function verifyBackup({
  backupFilename,
  env = process.env,
  expectedDirectory,
} = {}) {
  const environment = env.TRADING_MODE
  if (environment !== "testnet" && environment !== "live") {
    throw createBackupError({
      stage: "environment-validation",
      code: "HARVESTER_HISTORY_BACKUP_INVALID_ENVIRONMENT",
      environment,
      backupFilename,
    })
  }
  const backupDirectory = expectedDirectory ?? resolveBackupDirectory({
    tradingMode: environment,
    env,
  })
  const validated = await readAndValidateManifest({
    backupFilename,
    backupDirectory,
    environment,
  })
  const temporaryDirectory = await mkdtemp(join(backupDirectory, ".restore-check-"))
  let result
  let failure
  try {
    result = await restoreAndValidate({
      backupFilename: validated.backupFilename,
      temporaryDirectory,
      manifest: validated.manifest,
      environment,
    })
  } catch (cause) {
    failure = cause
  }
  failure = await cleanupRestoreDirectory({
    directory: temporaryDirectory,
    failure,
    environment,
    backupFilename,
  })
  if (failure) {
    throw failure instanceof OrderHistoryPersistenceError
      ? failure
      : createBackupError({
        stage: "restore-verification",
        code: "HARVESTER_HISTORY_BACKUP_RESTORE_FAILED",
        cause: failure,
        environment,
        backupFilename,
      })
  }
  return {
    ...result,
    backupFilename: validated.backupFilename,
    verified: true,
  }
}
