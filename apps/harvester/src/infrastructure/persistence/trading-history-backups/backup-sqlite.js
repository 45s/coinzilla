import {
  createSqliteDatabase,
  restoreSqliteDatabase,
} from "@coinzilla/db"
import { join } from "node:path"
import { createBackupError, isBackupError } from "./errors.js"
import {
  assertCurrentSchema,
  validateRestoredDatabase,
} from "./backup-schema.js"

export async function createOnlineBackup({
  sourceFilename,
  destinationFilename,
  backupRate,
  environment,
} = {}) {
  const database = createSqliteDatabase({
    filename: sourceFilename,
  })
  let connected = false
  let result
  let failure
  try {
    await database.connect()
    connected = true
    const schemaVersion = assertCurrentSchema(database)
    const pagesCopied = await database.backup({
      destination: destinationFilename,
      rate: backupRate,
    })
    result = {
      schemaVersion,
      pagesCopied,
    }
  } catch (cause) {
    failure = isBackupError(cause)
      ? cause
      : createBackupError({
        stage: "online-backup",
        code: "HARVESTER_HISTORY_BACKUP_FAILED",
        cause,
        environment,
      })
  }
  if (connected) {
    try {
      await database.close()
    } catch (cause) {
      failure = failure
        ? new AggregateError([failure, cause], "Source database close failed.")
        : createBackupError({
          stage: "source-database-close",
          code: "HARVESTER_HISTORY_BACKUP_FAILED",
          cause,
          environment,
        })
    }
  }
  if (failure) {
    throw failure
  }
  return result
}

async function closeRestoreDatabase({
  database,
  connected,
  failure,
  environment,
  backupFilename,
} = {}) {
  if (!connected) {
    return failure
  }
  try {
    await database.close()
    return failure
  } catch (cause) {
    return failure
      ? new AggregateError([failure, cause], "Restore candidate close failed.")
      : createBackupError({
        stage: "restore-close",
        code: "HARVESTER_HISTORY_BACKUP_RESTORE_FAILED",
        cause,
        environment,
        backupFilename,
      })
  }
}

export async function restoreAndValidate({
  backupFilename,
  temporaryDirectory,
  manifest,
  environment,
} = {}) {
  const restoredFilename = join(temporaryDirectory, "restored-history.sqlite")
  let database
  let connected = false
  let result
  let failure
  try {
    await restoreSqliteDatabase({
      backupFilename,
      filename: restoredFilename,
    })
    database = createSqliteDatabase({
      filename: restoredFilename,
    })
    await database.connect()
    connected = true
    result = await validateRestoredDatabase({
      database,
      manifest,
      environment,
      backupFilename,
    })
  } catch (cause) {
    failure = isBackupError(cause)
      ? cause
      : createBackupError({
        stage: "restore-validation",
        code: "HARVESTER_HISTORY_BACKUP_RESTORE_FAILED",
        cause,
        environment,
        backupFilename,
      })
  }
  failure = await closeRestoreDatabase({
    database,
    connected,
    failure,
    environment,
    backupFilename,
  })
  if (failure) {
    throw failure
  }
  return {
    ...result,
    verified: true,
  }
}
