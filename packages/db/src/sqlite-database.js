import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"

import { createDatabase } from "./database.js"
import { migrateSqliteDatabase } from "./sqlite-migrations.js"

const DEFAULT_TIMEOUT_MS = 5_000

function validateOptions({ filename, timeout }) {
  if (typeof filename !== "string" || filename.trim() === "") {
    throw new TypeError("SQLite filename must be a non-empty string")
  }

  if (!Number.isSafeInteger(timeout) || timeout < 0) {
    throw new TypeError("SQLite timeout must be a non-negative safe integer")
  }
}

function isThenable(value) {
  return value !== null
    && (typeof value === "object" || typeof value === "function")
    && typeof value.then === "function"
}

function isAsyncFunction(callback) {
  return callback.constructor?.name === "AsyncFunction"
}

/**
 * Create a SQLite database backed by Node.js' built-in node:sqlite module.
 *
 * SQLite operations are synchronous. Transaction callbacks must therefore
 * complete synchronously; asynchronous callbacks are rejected before running.
 *
 * @param {{ filename?: string, timeout?: number }} [options]
 * @returns {ReturnType<typeof createDatabase> & {
 *   exec: (sql: string) => void,
 *   prepare: (sql: string) => import('node:sqlite').StatementSync,
 *   migrate: (migrations: Array<{version: number, name: string, up: Function}>) => Promise<number[]>
 * }}
 */
export function createSqliteDatabase({
  filename = ":memory:",
  timeout = DEFAULT_TIMEOUT_MS,
} = {}) {
  validateOptions({ filename, timeout })

  const isMemoryDatabase = filename === ":memory:"
  const databaseFilename = isMemoryDatabase ? filename : resolve(filename)
  let connection = null

  function requireConnection() {
    if (database.state !== "connected" || !connection?.isOpen) {
      throw new Error(
        `SQLite database must be connected to execute SQL (state: ${database.state})`,
      )
    }

    return connection
  }

  const adapter = {
    connect() {
      if (!isMemoryDatabase) {
        mkdirSync(dirname(databaseFilename), { recursive: true })
      }

      const openedConnection = new DatabaseSync(databaseFilename, { timeout })

      try {
        openedConnection.exec("PRAGMA foreign_keys = ON")
        if (!isMemoryDatabase) {
          openedConnection.exec("PRAGMA journal_mode = WAL")
        }
        connection = openedConnection
      } catch (error) {
        openedConnection.close()
        throw error
      }
    },

    close() {
      if (connection?.isOpen) {
        connection.close()
      }
      connection = null
    },

    withTransaction(work) {
      const activeConnection = requireConnection()

      if (activeConnection.isTransaction) {
        throw new Error("Nested SQLite transactions are not supported")
      }

      if (isAsyncFunction(work)) {
        throw new TypeError("SQLite transaction callbacks must be synchronous")
      }

      activeConnection.exec("BEGIN IMMEDIATE")

      try {
        const transaction = Object.freeze({
          exec: (sql) => activeConnection.exec(sql),
          prepare: (sql) => activeConnection.prepare(sql),
        })
        const result = work(transaction)

        if (isThenable(result)) {
          Promise.resolve(result).catch(() => {})
          throw new TypeError("SQLite transaction callbacks must be synchronous")
        }

        activeConnection.exec("COMMIT")
        return result
      } catch (error) {
        if (activeConnection.isTransaction) {
          try {
            activeConnection.exec("ROLLBACK")
          } catch (rollbackError) {
            throw new AggregateError(
              [error, rollbackError],
              "SQLite transaction failed and rollback also failed",
              { cause: error },
            )
          }
        }

        throw error
      }
    },
  }

  const database = createDatabase({ adapter })

  return Object.freeze({
    connect: database.connect,
    transaction: database.transaction,
    close: database.close,
    get state() {
      return database.state
    },
    exec(sql) {
      return requireConnection().exec(sql)
    },
    prepare(sql) {
      return requireConnection().prepare(sql)
    },
    migrate(migrations) {
      return migrateSqliteDatabase(this, migrations)
    },
  })
}
