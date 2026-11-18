import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
} from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"

export function validateDatabasePath({ filename, label }) {
  if (typeof filename !== "string" || filename.trim() === "" || filename === ":memory:") {
    throw new TypeError(`${label} must be a non-empty file path`)
  }

  return resolve(filename)
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

export async function assertDifferentFiles({ sourceFilename, destinationFilename }) {
  const [sourcePath, destinationPath] = await Promise.all([
    realpath(sourceFilename),
    getCanonicalPath(destinationFilename),
  ])

  if (sourcePath === destinationPath) {
    throw new TypeError("SQLite backup source and destination must be different files")
  }
}

export function validateIntegrity(database) {
  const integrityRows = database.prepare("PRAGMA integrity_check").all()
  if (integrityRows.length !== 1 || integrityRows[0].integrity_check !== "ok") {
    throw new TypeError("SQLite backup failed integrity validation")
  }

  const foreignKeyViolations = database.prepare("PRAGMA foreign_key_check").all()
  if (foreignKeyViolations.length > 0) {
    throw new TypeError("SQLite backup contains foreign-key violations")
  }
}

export async function createTemporaryDirectory({ destinationFilename, prefix }) {
  await mkdir(dirname(destinationFilename), {
    recursive: true,
  })

  return mkdtemp(join(dirname(destinationFilename), `.${prefix}-`))
}

export async function removeTemporaryDirectory({ directory, operationError, remove = rm }) {
  try {
    await remove(directory, {
      recursive: true,
      force: true,
    })
  } catch (cleanupError) {
    if (operationError) {
      throw new AggregateError(
        [operationError, cleanupError],
        "SQLite database operation failed and temporary-file cleanup also failed",
        { cause: cleanupError },
      )
    }

    throw cleanupError
  }
}

export async function verifyDatabaseFile({ filename, timeout }) {
  const database = new DatabaseSync(filename, {
    readOnly: true,
    timeout,
  })
  let verificationFailed = false
  let verificationError

  try {
    validateIntegrity(database)
  } catch (error) {
    verificationFailed = true
    verificationError = error
  }

  try {
    database.close()
  } catch (closeError) {
    if (verificationFailed) {
      throw new AggregateError(
        [verificationError, closeError],
        "SQLite database verification failed and its connection could not close",
        { cause: closeError },
      )
    }

    throw closeError
  }

  if (verificationFailed) {
    throw verificationError
  }
}
