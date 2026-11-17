import {
  link,
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  unlink,
} from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { backup as sqliteBackup, DatabaseSync } from "node:sqlite"

import { DatabaseProviderError } from "../../domain/errors/database-errors.js"

const DEFAULT_BACKUP_RATE = 100
const DEFAULT_TIMEOUT_MS = 5_000

function validateDatabasePath({ filename, label }) {
  if (typeof filename !== "string" || filename.trim() === "" || filename === ":memory:") {
    throw new TypeError(`${label} must be a non-empty file path`)
  }

  return resolve(filename)
}

function validateBackupOptions({ destination, rate, progress }) {
  const destinationFilename = validateDatabasePath({
    filename: destination,
    label: "SQLite backup destination",
  })

  if (!Number.isSafeInteger(rate) || rate <= 0) {
    throw new TypeError("SQLite backup rate must be a positive safe integer")
  }

  if (progress !== undefined && typeof progress !== "function") {
    throw new TypeError("SQLite backup progress must be a function")
  }

  return destinationFilename
}

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

async function getCanonicalPath(filename) {
  try {
    return await realpath(filename)
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error
    }

    const canonicalDirectory = await realpath(dirname(filename))
    return join(canonicalDirectory, basename(filename))
  }
}

async function assertDifferentFiles({ sourceFilename, destinationFilename }) {
  const [sourcePath, destinationPath] = await Promise.all([
    realpath(sourceFilename),
    getCanonicalPath(destinationFilename),
  ])

  if (sourcePath === destinationPath) {
    throw new TypeError("SQLite backup source and destination must be different files")
  }
}

function validateIntegrity(database) {
  const integrityRows = database.prepare("PRAGMA integrity_check").all()
  if (integrityRows.length !== 1 || integrityRows[0].integrity_check !== "ok") {
    throw new TypeError("SQLite backup failed integrity validation")
  }

  const foreignKeyViolations = database.prepare("PRAGMA foreign_key_check").all()
  if (foreignKeyViolations.length > 0) {
    throw new TypeError("SQLite backup contains foreign-key violations")
  }
}

async function createTemporaryDirectory({ destinationFilename, prefix }) {
  await mkdir(dirname(destinationFilename), {
    recursive: true,
  })

  return mkdtemp(join(dirname(destinationFilename), `.${prefix}-`))
}

async function removeTemporaryDirectory({ directory, operationError }) {
  try {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  } catch (cleanupError) {
    if (operationError) {
      throw new AggregateError(
        [operationError, cleanupError],
        "SQLite database operation failed and temporary-file cleanup also failed",
        { cause: operationError },
      )
    }

    throw cleanupError
  }
}

async function verifyDatabaseFile({ filename, timeout }) {
  const database = new DatabaseSync(filename, {
    readOnly: true,
    timeout,
  })

  try {
    validateIntegrity(database)
  } finally {
    database.close()
  }
}

function createProgressReporter({ progress, onFailure }) {
  if (progress === undefined) {
    return undefined
  }

  return (state) => {
    try {
      progress(Object.freeze({
        remainingPages: state.remainingPages,
        totalPages: state.totalPages,
      }))
    } catch (error) {
      onFailure(error)
      throw error
    }
  }
}

async function runBackup({ sourceConnection, destinationFilename, rate, progress, timeout }) {
  let progressError = null
  let temporaryDirectory
  let operationError = null
  let pagesCopied

  try {
    temporaryDirectory = await createTemporaryDirectory({
      destinationFilename,
      prefix: "coinzilla-db-backup",
    })
    const temporaryFilename = join(temporaryDirectory, basename(destinationFilename))
    pagesCopied = await sqliteBackup(
      sourceConnection,
      temporaryFilename,
      {
        rate,
        progress: createProgressReporter({
          progress,
          onFailure: (error) => {
            progressError = error
          },
        }),
      },
    )
    await verifyDatabaseFile({
      filename: temporaryFilename,
      timeout,
    })
    await rename(temporaryFilename, destinationFilename)
  } catch (error) {
    operationError = error
  }

  if (temporaryDirectory) {
    try {
      await removeTemporaryDirectory({
        directory: temporaryDirectory,
        operationError,
      })
    } catch (error) {
      operationError = error
    }
  }

  if (operationError) {
    if (operationError === progressError) {
      throw operationError
    }

    throw new DatabaseProviderError({
      operation: "backup",
      cause: operationError,
    })
  }

  return pagesCopied
}

/**
 * Create a consistent SQLite backup using the native online backup API.
 *
 * The destination is atomically replaced only after the temporary backup passes
 * SQLite integrity and foreign-key validation. The source connection must be open
 * and outside a transaction.
 *
 * @param {object} options
 * @param {import("node:sqlite").DatabaseSync} options.sourceConnection
 * @param {string} options.sourceFilename
 * @param {string} options.destination
 * @param {number} [options.rate=100] - Number of pages copied per backup step.
 * @param {(state: {remainingPages: number, totalPages: number}) => void} [options.progress]
 * @returns {Promise<number>} Number of pages copied.
 */
export async function backupSqliteDatabase({
  sourceConnection,
  sourceFilename,
  destination,
  rate = DEFAULT_BACKUP_RATE,
  progress,
  timeout = DEFAULT_TIMEOUT_MS,
} = {}) {
  const destinationFilename = validateBackupOptions({
    destination,
    rate,
    progress,
  })

  if (!sourceConnection?.isOpen) {
    throw new TypeError("SQLite backup requires an open source connection")
  }

  if (sourceConnection.isTransaction) {
    throw new TypeError("SQLite backup cannot start while a transaction is active")
  }

  if (!Number.isSafeInteger(timeout) || timeout < 0) {
    throw new TypeError("SQLite backup timeout must be a non-negative safe integer")
  }

  try {
    await mkdir(dirname(destinationFilename), {
      recursive: true,
    })

    if (sourceFilename !== ":memory:") {
      await assertDifferentFiles({
        sourceFilename: resolve(sourceFilename),
        destinationFilename,
      })
    }

    return await runBackup({
      sourceConnection,
      destinationFilename,
      rate,
      progress,
      timeout,
    })
  } catch (error) {
    if (error instanceof TypeError || error instanceof DatabaseProviderError) {
      throw error
    }

    throw new DatabaseProviderError({
      operation: "backup",
      cause: error,
    })
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

  await unlink(temporaryFilename)
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
        { cause: operationError },
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
