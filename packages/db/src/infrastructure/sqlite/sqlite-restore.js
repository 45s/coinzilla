import {
  link,
  mkdir,
  realpath,
} from "node:fs/promises"
import { basename, dirname } from "node:path"
import { backup as sqliteBackup, DatabaseSync } from "node:sqlite"

import { DatabaseProviderError } from "../../domain/errors/database-errors.js"
import {
  assertDifferentFiles,
  createTemporaryDirectory,
  removeTemporaryDirectory,
  validateDatabasePath,
  validateIntegrity,
  verifyDatabaseFile,
} from "./sqlite-file-operations.js"

const DEFAULT_BACKUP_RATE = 100
const DEFAULT_TIMEOUT_MS = 5_000

function validateRestoreOptions({ backupFilename, filename, timeout, rate }) {
  const sourceFilename = validateDatabasePath({
    filename: backupFilename,
    label: "SQLite backup source",
  })
  const destinationFilename = validateDatabasePath({
    filename,
    label: "SQLite restore destination",
  })

  if (!Number.isSafeInteger(timeout) || timeout < 0) {
    throw new TypeError("SQLite restore timeout must be a non-negative safe integer")
  }

  if (!Number.isSafeInteger(rate) || rate <= 0) {
    throw new TypeError("SQLite restore rate must be a positive safe integer")
  }

  return {
    sourceFilename,
    destinationFilename,
  }
}

async function assertRestoreDestinationIsNew({ filename }) {
  try {
    await realpath(filename)
    throw new TypeError("SQLite restore destination already exists")
  } catch (error) {
    if (error instanceof TypeError) {
      throw error
    }
    if (error.code !== "ENOENT") {
      throw error
    }
  }
}

async function publishRestoredDatabase({ temporaryFilename, destinationFilename }) {
  try {
    await link(temporaryFilename, destinationFilename)
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new TypeError("SQLite restore destination already exists", {
        cause: error,
      })
    }

    throw error
  }

}

async function createRestoreArtifact({ sourceFilename, destinationFilename, timeout, rate }) {
  const sourceDatabase = new DatabaseSync(sourceFilename, {
    readOnly: true,
    timeout,
  })
  let temporaryDirectory
  let temporaryFilename
  let operationError = null

  try {
    validateIntegrity(sourceDatabase)
    temporaryDirectory = await createTemporaryDirectory({
      destinationFilename,
      prefix: "coinzilla-db-restore",
    })
    temporaryFilename = join(temporaryDirectory, basename(destinationFilename))
    await sqliteBackup(sourceDatabase, temporaryFilename, {
      rate,
    })
    await verifyDatabaseFile({
      filename: temporaryFilename,
      timeout,
    })
  } catch (error) {
    operationError = error
  }

  try {
    sourceDatabase.close()
  } catch (error) {
    operationError = operationError
      ? new AggregateError(
        [operationError, error],
        "SQLite restore failed and its source connection could not close",
      )
      : error
  }

  if (operationError) {
    if (temporaryDirectory) {
      await removeTemporaryDirectory({
        directory: temporaryDirectory,
        operationError,
      })
    }

    throw operationError
  }

  return {
    directory: temporaryDirectory,
    filename: temporaryFilename,
  }
}

async function publishRestoreArtifact({ artifact, destinationFilename }) {
  let operationError = null

  try {
    await publishRestoredDatabase({
      temporaryFilename: artifact.filename,
      destinationFilename,
    })
  } catch (error) {
    operationError = error
  }

  try {
    await removeTemporaryDirectory({
      directory: artifact.directory,
      operationError,
    })
  } catch (error) {
    operationError = error
  }

  if (operationError) {
    throw operationError
  }
}

/**
 * Restore a validated SQLite backup into a new database file.
 *
 * Existing destination files are never overwritten. The restored file is
 * published with an atomic no-overwrite hard link after integrity validation.
 * Callers must stop other processes that may use the destination path.
 *
 * @param {object} options
 * @param {string} options.backupFilename
 * @param {string} options.filename
 * @param {number} [options.timeout=5000] - SQLite lock timeout in milliseconds.
 * @param {number} [options.rate=100] - Number of pages copied per backup step.
 * @returns {Promise<string>} Absolute path of the restored database file.
 */
export async function restoreSqliteDatabase({
  backupFilename,
  filename,
  timeout = DEFAULT_TIMEOUT_MS,
  rate = DEFAULT_BACKUP_RATE,
} = {}) {
  const {
    sourceFilename,
    destinationFilename,
  } = validateRestoreOptions({
    backupFilename,
    filename,
    timeout,
    rate,
  })

  try {
    await mkdir(dirname(destinationFilename), {
      recursive: true,
    })
    await assertDifferentFiles({
      sourceFilename,
      destinationFilename,
    })
    await assertRestoreDestinationIsNew({
      filename: destinationFilename,
    })

    const artifact = await createRestoreArtifact({
      sourceFilename,
      destinationFilename,
      timeout,
      rate,
    })
    await publishRestoreArtifact({
      artifact,
      destinationFilename,
    })
  } catch (error) {
    if (error instanceof TypeError || error instanceof DatabaseProviderError) {
      throw error
    }

    throw new DatabaseProviderError({
      operation: "restore",
      cause: error,
    })
  }

  return destinationFilename
}
