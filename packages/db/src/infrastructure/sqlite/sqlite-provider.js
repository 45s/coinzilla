import { DatabaseConflictError, DatabaseProviderError } from "../../domain/errors/database-errors.js"
import {
  normalizeReadQuery,
  serializeChanges,
  serializeRecord,
  validateCollectionName,
  validateRecordIdentifier,
} from "../../domain/contracts/record.js"
import { createSqliteDatabase } from "./sqlite-database.js"

const CREATE_RECORDS_TABLE = `
  CREATE TABLE IF NOT EXISTS db_records (
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    record TEXT NOT NULL CHECK (json_valid(record)),
    PRIMARY KEY (collection, id)
  ) WITHOUT ROWID
`

const SQLITE_CAPABILITIES = Object.freeze({
  transactions: Object.freeze({
    callbackMode: "synchronous",
  }),
  queries: Object.freeze({
    equalityFilters: true,
    sorting: true,
    pagination: true,
  }),
  storage: Object.freeze({
    fileBacked: true,
    inMemory: true,
  }),
})

function isUniqueConstraintError(error) {
  return error?.errcode === 1555
    || error?.errcode === 2067
    || /UNIQUE constraint failed/.test(error?.message ?? "")
}

function runProviderOperation({ operation, collection, work }) {
  try {
    return work()
  } catch (error) {
    if (error instanceof DatabaseConflictError || error instanceof DatabaseProviderError) {
      throw error
    }

    throw new DatabaseProviderError({
      operation,
      collection,
      cause: error,
    })
  }
}

function createReadManyStatement({ transaction, query, collection }) {
  const conditions = ["collection = ?"]
  const parameters = [collection]

  for (const [field, value] of Object.entries(query.filter)) {
    const jsonPath = `$.${field}`
    const serializedValue = JSON.stringify(value)
    conditions.push(
      "json_type(record, ?) = json_type(?, '$') AND json_extract(record, ?) IS json_extract(?, '$')",
    )
    parameters.push(jsonPath, serializedValue, jsonPath, serializedValue)
  }

  const order = []
  for (const { field, direction } of query.sort) {
    const jsonPath = `$.${field}`
    const sqlDirection = direction.toUpperCase()
    order.push(
      `CASE COALESCE(json_type(record, ?), 'null') WHEN 'null' THEN 0 WHEN 'false' THEN 1 WHEN 'true' THEN 2 WHEN 'integer' THEN 3 WHEN 'real' THEN 3 WHEN 'text' THEN 4 ELSE 5 END ${sqlDirection}`,
    )
    order.push(`json_extract(record, ?) ${sqlDirection}`)
    parameters.push(jsonPath, jsonPath)
  }
  order.push("id ASC")

  let sql = `SELECT record FROM db_records WHERE ${conditions.join(" AND ")} ORDER BY ${order.join(", ")}`
  if (query.limit !== undefined) {
    sql += " LIMIT ?"
    parameters.push(query.limit)
  } else if (query.offset > 0) {
    sql += " LIMIT -1"
  }
  if (query.offset > 0) {
    sql += " OFFSET ?"
    parameters.push(query.offset)
  }

  return transaction.prepare(sql).all(...parameters)
}

function createSqliteTransactionContext({ transaction }) {
  const insertRecord = transaction.prepare(
    "INSERT INTO db_records (collection, id, record) VALUES (?, ?, ?)",
  )
  const selectRecord = transaction.prepare(
    "SELECT record FROM db_records WHERE collection = ? AND id = ?",
  )
  const updateRecord = transaction.prepare(
    "UPDATE db_records SET record = ? WHERE collection = ? AND id = ?",
  )
  const deleteRecord = transaction.prepare(
    "DELETE FROM db_records WHERE collection = ? AND id = ?",
  )

  return Object.freeze({
    create(collection, record) {
      validateCollectionName(collection)
      const serializedRecord = serializeRecord(record)

      return runProviderOperation({
        operation: "create",
        collection,
        work: () => {
          try {
            insertRecord.run(collection, record.id, serializedRecord)
          } catch (error) {
            if (isUniqueConstraintError(error)) {
              throw new DatabaseConflictError({
                collection,
                cause: error,
              })
            }
            throw error
          }

          return JSON.parse(serializedRecord)
        },
      })
    },

    readOne(collection, identifier) {
      validateCollectionName(collection)
      validateRecordIdentifier(identifier)

      return runProviderOperation({
        operation: "readOne",
        collection,
        work: () => {
          const result = selectRecord.get(collection, identifier)
          return result ? JSON.parse(result.record) : null
        },
      })
    },

    readMany(collection, query) {
      validateCollectionName(collection)
      const normalizedQuery = normalizeReadQuery(query)

      return runProviderOperation({
        operation: "readMany",
        collection,
        work: () => createReadManyStatement({
          transaction,
          query: normalizedQuery,
          collection,
        }).map((result) => JSON.parse(result.record)),
      })
    },

    update(collection, identifier, changes) {
      validateCollectionName(collection)
      validateRecordIdentifier(identifier)
      const serializedChanges = serializeChanges(changes)

      return runProviderOperation({
        operation: "update",
        collection,
        work: () => {
          const existing = selectRecord.get(collection, identifier)
          if (!existing) {
            return null
          }

          const updatedRecord = {
            ...JSON.parse(existing.record),
            ...JSON.parse(serializedChanges),
          }
          const serializedRecord = JSON.stringify(updatedRecord)
          updateRecord.run(serializedRecord, collection, identifier)
          return updatedRecord
        },
      })
    },

    delete(collection, identifier) {
      validateCollectionName(collection)
      validateRecordIdentifier(identifier)

      return runProviderOperation({
        operation: "delete",
        collection,
        work: () => deleteRecord.run(collection, identifier).changes > 0,
      })
    },
  })
}

/**
 * Create the built-in SQLite implementation of the provider-neutral record API.
 *
 * @param {{filename: string, timeout?: number}} options
 * @returns {import("../../application/ports/database-provider.js").DatabaseProvider}
 */
export function createSqliteProvider({ filename, timeout } = {}) {
  let database = createSqliteDatabase({
    filename,
    timeout,
  })

  return Object.freeze({
    capabilities: SQLITE_CAPABILITIES,

    async connect() {
      if (database.state === "closed") {
        database = createSqliteDatabase({
          filename,
          timeout,
        })
      }

      try {
        await database.connect()
        database.exec(CREATE_RECORDS_TABLE)
      } catch (error) {
        let connectionError = error
        if (database.state === "connected") {
          try {
            await database.close()
          } catch (closeError) {
            connectionError = new AggregateError(
              [error, closeError],
              "SQLite provider connection failed and cleanup also failed",
              {
                cause: error,
              },
            )
          }
        }

        throw new DatabaseProviderError({
          operation: "connect",
          cause: connectionError,
        })
      }
    },

    async close() {
      try {
        await database.close()
      } catch (error) {
        throw new DatabaseProviderError({
          operation: "close",
          cause: error,
        })
      }
    },

    withTransaction(work) {
      let callbackError = null
      const operation = database.transaction((transaction) => {
        try {
          return work(createSqliteTransactionContext({
            transaction,
          }))
        } catch (error) {
          callbackError = error
          throw error
        }
      })

      return operation.catch((error) => {
        const isCallbackFailure = error === callbackError
          || error instanceof DatabaseConflictError
          || error instanceof DatabaseProviderError
        const isUnsupportedAsyncCallback = error instanceof TypeError
          && /SQLite transaction callbacks must be synchronous/.test(error.message)

        if (isCallbackFailure || isUnsupportedAsyncCallback) {
          throw error
        }

        throw new DatabaseProviderError({
          operation: "transaction",
          cause: error,
        })
      })
    },
  })
}
