import {
  mkdir,
  rename,
} from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { backup as sqliteBackup } from "node:sqlite"

import { DatabaseProviderError } from "../../domain/errors/database-errors.js"
import {
  assertDifferentFiles,
  createTemporaryDirectory,
  removeTemporaryDirectory,
  validateDatabasePath,
  verifyDatabaseFile,
} from "./sqlite-file-operations.js"

const DEFAULT_BACKUP_RATE = 100
const DEFAULT_TIMEOUT_MS = 5_000

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
    if (progressError) {
      if (operationError instanceof AggregateError) {
        throw new AggregateError(
          [progressError, ...operationError.errors],
          "SQLite backup progress callback failed and cleanup also failed",
        )
      }

      throw progressError
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
