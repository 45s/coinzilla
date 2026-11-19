import { DatabaseConflictError } from "@coinzilla/db"
import { OrderHistoryIntegrityError } from "../../domain/order-history/order-history-errors.js"
import { mergeOrderHistoryRecords } from "../../domain/order-history/order-history-transition.js"
import { OrderHistoryPersistenceError } from "./order-history-persistence-error.js"

const ORDER_HISTORY_COLLECTION = "harvester_orders"

function createOrderChanges(record) {
  const changes = {
    ...record,
  }
  delete changes.id
  return changes
}

function upsertSynchronously({ transaction, record } = {}) {
  const current = transaction.readOne({
    collection: ORDER_HISTORY_COLLECTION,
    id: record.id,
  })
  if (current === null || current === undefined) {
    return transaction.create({
      collection: ORDER_HISTORY_COLLECTION,
      record,
    })
  }
  const merged = mergeOrderHistoryRecords({
    current,
    candidate: record,
  })
  if (merged === current) {
    return current
  }
  const updated = transaction.update({
    collection: ORDER_HISTORY_COLLECTION,
    id: record.id,
    changes: createOrderChanges(merged),
  })
  if (updated === null || updated === undefined) {
    throw new OrderHistoryIntegrityError({
      field: "record",
      providerInstanceId: record.providerInstanceId,
      accountId: record.accountId,
      clientOrderId: record.clientOrderId,
    })
  }
  return updated
}

async function upsertAsynchronously({ transaction, record } = {}) {
  const current = await transaction.readOne({
    collection: ORDER_HISTORY_COLLECTION,
    id: record.id,
  })
  if (current === null || current === undefined) {
    return transaction.create({
      collection: ORDER_HISTORY_COLLECTION,
      record,
    })
  }
  const merged = mergeOrderHistoryRecords({
    current,
    candidate: record,
  })
  if (merged === current) {
    return current
  }
  const updated = await transaction.update({
    collection: ORDER_HISTORY_COLLECTION,
    id: record.id,
    changes: createOrderChanges(merged),
  })
  if (updated === null || updated === undefined) {
    throw createMissingRecordError(record)
  }
  return updated
}

function createOrderHistoryPersistenceError({ cause, record } = {}) {
  return new OrderHistoryPersistenceError({
    stage: "upsert",
    cause,
    context: {
      providerInstanceId: record.providerInstanceId,
      accountId: record.accountId,
      clientOrderId: record.clientOrderId,
    },
  })
}

function isOrderHistoryDomainError(error) {
  return error instanceof OrderHistoryIntegrityError ||
    error?.code === "HARVESTER_ORDER_HISTORY_RECORD_INVALID"
}

/**
 * Create the provider-neutral repository adapter for Harvester order history.
 *
 * @param {{database: object}} input
 * @returns {{upsert: (record: object) => Promise<object>}}
 * @throws {TypeError} When the database lacks a supported transaction contract.
 */
export function createOrderHistoryRepository({ database } = {}) {
  const callbackMode = database?.capabilities?.transactions?.callbackMode
  if (
    !database ||
    typeof database.transaction !== "function" ||
    !["synchronous", "asynchronous"].includes(callbackMode)
  ) {
    throw new TypeError("OrderHistoryRepository requires a database with transaction callback capabilities")
  }

  async function executeTransaction(record) {
    if (callbackMode === "synchronous") {
      return database.transaction((transaction) => upsertSynchronously({
        transaction,
        record,
      }))
    }
    return database.transaction((transaction) => upsertAsynchronously({
      transaction,
      record,
    }))
  }

  function normalizeOrderHistoryWriteError({ error, record } = {}) {
  if (isOrderHistoryDomainError(error)) {
    return error
  }
  return createOrderHistoryPersistenceError({
    cause: error,
    record,
  })
}

async function retryConflictedOrderHistoryWrite({ executeTransaction, record } = {}) {
  try {
    return await executeTransaction(record)
  } catch (error) {
    throw normalizeOrderHistoryWriteError({
      error,
      record,
    })
  }
}

async function upsert(record) {
  if (!record || typeof record.id !== "string" || record.id.trim() === "") {
    throw new TypeError("OrderHistoryRepository.upsert requires a record with a stable ID")
  }
  try {
    return await executeTransaction(record)
  } catch (error) {
    if (error instanceof DatabaseConflictError) {
      return retryConflictedOrderHistoryWrite({
        executeTransaction,
        record,
      })
    }
    throw normalizeOrderHistoryWriteError({
      error,
      record,
    })
  }
}

  return Object.freeze({
    upsert,
  })
}
