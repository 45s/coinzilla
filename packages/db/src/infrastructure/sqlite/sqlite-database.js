import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { DatabaseSync } from "node:sqlite"

import { createDatabase } from "../../database.js"
import { backupSqliteDatabase } from "./sqlite-backup.js"
import { migrateSqliteDatabase } from "./sqlite-migration-runner.js"

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

function isSqliteLockError(error) {
  return error?.errcode === 5
    || error?.errcode === 6
    || /database (?:is locked|table is locked)/i.test(error?.message ?? "")
}

async function enableWalMode({ connection, timeout }) {
  const deadline = Date.now() + timeout

  while (true) {
    try {
      const { journal_mode: currentMode } = connection.prepare("PRAGMA journal_mode").get()
      if (currentMode === "wal") {
        return
      }

      connection.exec("PRAGMA journal_mode = WAL")
      const { journal_mode: enabledMode } = connection.prepare("PRAGMA journal_mode").get()
      if (enabledMode !== "wal") {
        throw new Error("SQLite failed to enable WAL journal mode")
      }
      return
    } catch (error) {
      const remaining = deadline - Date.now()
      if (!isSqliteLockError(error) || remaining <= 0) {
        throw error
      }

      await delay(Math.min(10, remaining))
    }
  }
}

export function createGuardedIterator({ iterator, assertActive }) {
  return Object.freeze({
    next(...args) {
      assertActive()
      return iterator.next(...args)
    },
    return(...args) {
      assertActive()
      return iterator.return?.(...args) ?? { done: true }
    },
    throw(...args) {
      assertActive()
      return iterator.throw?.(...args)
    },
    [Symbol.iterator]() {
      return this
    },
  })
}

function createGuardedStatement({ statement, assertActive }) {
  return new Proxy(statement, {
    get(...args) {
      const [target, property] = args
      const value = Reflect.get(target, property, target)
      if (typeof value !== "function") {
        return value
      }

      return (...methodArgs) => {
        assertActive()
        const result = value.apply(target, methodArgs)
        return property === "iterate"
          ? createGuardedIterator({
            iterator: result,
            assertActive,
          })
          : result
      }
    },
  })
}

function createSqliteTransactionHandle({ activeConnection, assertActive }) {
  return Object.freeze({
    exec(sql) {
      assertActive()
      return activeConnection.exec(sql)
    },
    prepare(sql) {
      assertActive()
      return createGuardedStatement({
        statement: activeConnection.prepare(sql),
        assertActive,
      })
    },
  })
}

function createSqliteTransactionHandler({ requireConnection, intent }) {
  return function withTransaction(work) {
    const activeConnection = requireConnection()

    if (activeConnection.isTransaction) {
      throw new Error("Nested SQLite transactions are not supported")
    }

    if (isAsyncFunction(work)) {
      throw new TypeError("SQLite transaction callbacks must be synchronous")
    }

    activeConnection.exec(intent === "read" ? "BEGIN DEFERRED" : "BEGIN IMMEDIATE")
    let transactionActive = true
    const assertActive = () => {
      if (!transactionActive) {
        throw new Error("SQLite transaction context is no longer active")
      }
    }

    try {
      const transaction = createSqliteTransactionHandle({
        activeConnection,
        assertActive,
      })
      const result = work(transaction)

      if (isThenable(result)) {
        transactionActive = false
        Promise.resolve(result).catch(() => {})
        throw new TypeError("SQLite transaction callbacks must be synchronous")
      }

      activeConnection.exec("COMMIT")
      transactionActive = false
      return result
    } catch (error) {
      transactionActive = false
      if (activeConnection.isTransaction) {
        let rollbackFailed = false
        let rollbackError

        try {
          activeConnection.exec("ROLLBACK")
        } catch (caughtRollbackError) {
          rollbackFailed = true
          rollbackError = caughtRollbackError
        }

        if (rollbackFailed) {
          throw new AggregateError(
            [error, rollbackError],
            "SQLite transaction failed and rollback also failed",
            { cause: error },
          )
        }
      }

      throw error
    }
  }
}

function createConnectionSetupFailure({ openedConnection, initializationError, onClosed }) {
  try {
    openedConnection.close()
    onClosed()
    return initializationError
  } catch (closeError) {
    return new AggregateError(
      [initializationError, closeError],
      "SQLite connection initialization failed and cleanup also failed",
      { cause: initializationError },
    )
  }
}

function createSqliteAdapter({
  databaseFilename,
  isMemoryDatabase,
  timeout,
  getDatabaseState,
}) {
  let connection = null

  function requireConnection() {
    const state = getDatabaseState()
    if (state !== "connected" || !connection?.isOpen) {
      throw new Error(
        `SQLite database must be connected to execute SQL (state: ${state})`,
      )
    }

    return connection
  }

  const adapter = {
    async connect() {
      if (connection) {
        if (connection.isOpen) {
          connection.close()
        }
        connection = null
      }

      if (!isMemoryDatabase) {
        mkdirSync(dirname(databaseFilename), { recursive: true })
      }

      const openedConnection = new DatabaseSync(databaseFilename, { timeout })
      connection = openedConnection

      try {
        openedConnection.exec("PRAGMA foreign_keys = ON")
        if (!isMemoryDatabase) {
          await enableWalMode({
            connection: openedConnection,
            timeout,
          })
        }
      } catch (error) {
        throw createConnectionSetupFailure({
          openedConnection,
          initializationError: error,
          onClosed: () => {
            connection = null
          },
        })
      }
    },

    close() {
      if (connection?.isOpen) {
        connection.close()
      }
      connection = null
    },

    withTransaction: createSqliteTransactionHandler({
      requireConnection,
      intent: "write",
    }),
    withReadTransaction: createSqliteTransactionHandler({
      requireConnection,
      intent: "read",
    }),
  }

  return {
    adapter,
    requireConnection,
    closeConnection: adapter.close,
  }
}

function createBackupOperation({ state, requireOpenConnection, databaseFilename, timeout }) {
  return function backup(options = {}) {
    if (state.closingRequested) {
      return Promise.reject(new Error("SQLite database is closing"))
    }

    let sourceConnection
    try {
      sourceConnection = requireOpenConnection()
    } catch (error) {
      return Promise.reject(error)
    }

    const operation = Promise.resolve().then(() => backupSqliteDatabase({
      sourceConnection,
      sourceFilename: databaseFilename,
      destination: options.destination,
      rate: options.rate,
      progress: options.progress,
      timeout,
    }))
    state.activeBackups.add(operation)
    operation.then(
      () => state.activeBackups.delete(operation),
      () => state.activeBackups.delete(operation),
    )

    return operation
  }
}

function createCloseOperation({ database, state, closeConnection }) {
  return function close() {
    if (state.closePromise) {
      return state.closePromise
    }
    if (database.state === "closed") {
      return closeConnection()
    }

    state.closingRequested = true
    state.closePromise = (async () => {
      while (state.activeBackups.size > 0) {
        await Promise.allSettled([...state.activeBackups])
      }
      await database.close()
      await closeConnection()
    })().finally(() => {
      state.closePromise = null
    })

    return state.closePromise
  }
}

function createRequireOpenConnection({ state, requireConnection, database }) {
  return function requireOpenConnection() {
    if (state.closingRequested && database.state !== "closed") {
      throw new Error("SQLite database is closing")
    }

    return requireConnection()
  }
}

function createTransactionOperation({ state, database }) {
  return function runTransaction({ work, operation }) {
    if (state.closingRequested && database.state !== "closed") {
      throw new Error("SQLite database is closing")
    }

    return operation(work)
  }
}

function createSqliteDatabaseFacade({ database, requireConnection, closeConnection, databaseFilename, timeout }) {
  const state = {
    closingRequested: false,
    closePromise: null,
    activeBackups: new Set(),
  }

  const requireOpenConnection = createRequireOpenConnection({
    state,
    requireConnection,
    database,
  })
  const runTransaction = createTransactionOperation({
    state,
    database,
  })

  const backup = createBackupOperation({
    state,
    requireOpenConnection,
    databaseFilename,
    timeout,
  })
  const close = createCloseOperation({
    database,
    state,
    closeConnection,
  })

  const sqliteDatabase = Object.freeze({
    connect: database.connect,
    transaction: (work) => runTransaction({
      work,
      operation: database.transaction,
    }),
    readTransaction: (work) => runTransaction({
      work,
      operation: database.readTransaction,
    }),
    close,
    backup,
    get state() {
      if (state.closingRequested && database.state !== "closed") {
        return "closing"
      }

      return database.state
    },
    exec(sql) {
      return requireOpenConnection().exec(sql)
    },
    prepare(sql) {
      return requireOpenConnection().prepare(sql)
    },
    migrate(migrations) {
      return migrateSqliteDatabase({
        database: sqliteDatabase,
        migrations,
      })
    },
  })

  return sqliteDatabase
}

/**
 * Create a SQLite database backed by Node.js' built-in node:sqlite module.
 *
 * SQLite operations are synchronous. Transaction callbacks must therefore
 * complete synchronously; asynchronous callbacks are rejected before running.
 * The asynchronous backup operation is drained before close completes.
 *
 * @param {{ filename: string, timeout?: number }} options
 * @returns {ReturnType<typeof createDatabase> & {
 *   exec: (sql: string) => void,
 *   prepare: (sql: string) => import('node:sqlite').StatementSync,
 *   transaction: (work: (transaction: unknown) => unknown) => Promise<unknown>,
 *   readTransaction: (work: (transaction: unknown) => unknown) => Promise<unknown>,
 *   migrate: (migrations: Array<{version: number, name: string, up: Function}>) => Promise<number[]>,
 *   backup: (options: {
 *     destination: string,
 *     rate?: number,
 *     progress?: (state: {remainingPages: number, totalPages: number}) => void
 *   }) => Promise<number>
 * }}
 */
export function createSqliteDatabase({
  filename,
  timeout = DEFAULT_TIMEOUT_MS,
} = {}) {
  validateOptions({
    filename,
    timeout,
  })

  const isMemoryDatabase = filename === ":memory:"
  const databaseFilename = isMemoryDatabase ? filename : resolve(filename)
  const databaseReference = {
    current: null,
  }

  const { adapter, requireConnection, closeConnection } = createSqliteAdapter({
    databaseFilename,
    isMemoryDatabase,
    timeout,
    getDatabaseState: () => databaseReference.current.state,
  })
  const database = createDatabase({ adapter })
  databaseReference.current = database

  return createSqliteDatabaseFacade({
    database,
    requireConnection,
    closeConnection,
    databaseFilename,
    timeout,
  })
}
