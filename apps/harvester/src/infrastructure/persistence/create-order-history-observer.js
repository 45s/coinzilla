import { defaultLogger } from "@coinzilla/utils"
import { assertOrderHistoryRepository } from "../../application/ports/order-history-repository.js"
import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { createOrderHistoryRecord } from "../../domain/order-history/order-history-record.js"
import { OrderHistoryPersistenceError } from "./order-history-persistence-error.js"

const ORDER_HISTORY_EVENT_NAMES = new Set([
  HARVESTER_EVENT_NAMES.ORDER_SUBMITTED,
  HARVESTER_EVENT_NAMES.ORDER_UPDATED,
  HARVESTER_EVENT_NAMES.ORDER_CANCELLED,
  HARVESTER_EVENT_NAMES.ORDER_CANCEL_FAILED,
])
const DEFAULT_MAX_PENDING_WRITES = 1000
const MAX_RETAINED_ERRORS = 20

function createEventContext(event) {
  const data = event?.data ?? {}
  return {
    eventId: event?.id ?? null,
    eventName: event?.name ?? null,
    providerInstanceId: data.providerInstanceId ?? null,
    accountId: data.accountId ?? null,
    clientOrderId: data.clientOrderId ?? null,
  }
}

function createObserverError({ error, event, stage, code } = {}) {
  if (error && typeof error.code === "string") {
    return error
  }
  return new OrderHistoryPersistenceError({
    stage,
    code,
    cause: error,
    context: createEventContext(event),
  })
}

function createFailureDiagnostic({ error, event, stage } = {}) {
  const normalized = createObserverError({
    error,
    event,
    stage,
  })
  return {
    message: "Order history projection failed",
    persistenceStage: stage,
    errorName: normalized.name,
    errorCode: normalized.code ?? "HARVESTER_ORDER_HISTORY_PERSISTENCE_FAILED",
    ...createEventContext(event),
  }
}

/**
 * Observe canonical order events and serialize best-effort history writes off the publisher call stack.
 *
 * @param {{eventBus: object, repository: object, environment: string, logger?: object, maxPending?: number}} input
 * @returns {{flush: () => Promise<object>, close: () => Promise<object>, getDiagnostics: () => object}}
 * @throws {TypeError} When the event bus, repository, environment, or queue bound is invalid.
 */
export function createOrderHistoryObserver({
  eventBus,
  repository,
  environment,
  logger = defaultLogger,
  maxPending = DEFAULT_MAX_PENDING_WRITES,
} = {}) {
  if (!eventBus || typeof eventBus.subscribeAll !== "function") {
    throw new TypeError("OrderHistoryObserver requires an EventBus with subscribeAll")
  }
  if (!["testnet", "live"].includes(environment)) {
    throw new TypeError("OrderHistoryObserver environment must be testnet or live")
  }
  if (!Number.isSafeInteger(maxPending) || maxPending < 1) {
    throw new TypeError("OrderHistoryObserver maxPending must be a positive safe integer")
  }
  const orderHistoryRepository = assertOrderHistoryRepository({
    repository,
  })
  let pendingCount = 0
  let droppedCount = 0
  let failureCount = 0
  let closed = false
  let queue = Promise.resolve()
  let closePromise
  const errors = []

  function recordFailure({ error, event, stage, code } = {}) {
    const normalized = createObserverError({
      error,
      event,
      stage,
      code,
    })
    const diagnostic = createFailureDiagnostic({
      error: normalized,
      event,
      stage,
    })
    failureCount += 1
    droppedCount += 1
    if (errors.length === MAX_RETAINED_ERRORS) {
      errors.shift()
    }
    errors.push(normalized)
    try {
      logger?.error?.(diagnostic)
    } catch {
      // Optional diagnostics must never escape into EventBus delivery.
    }
  }

  function getDiagnostics() {
    return Object.freeze({
      pendingCount,
      maxPending,
      droppedCount,
      failureCount,
      closed,
    })
  }

  async function flush() {
    await queue
    return {
      ok: failureCount === 0,
      errors: [...errors],
      diagnostics: getDiagnostics(),
    }
  }

  function enqueue({ record, event } = {}) {
    if (pendingCount >= maxPending) {
      recordFailure({
        error: new OrderHistoryPersistenceError({
          stage: "queue",
          code: "HARVESTER_ORDER_HISTORY_QUEUE_FULL",
          retryable: true,
          context: createEventContext(event),
        }),
        event,
        stage: "queue",
      })
      return
    }
    pendingCount += 1
    queue = queue
      .then(async () => {
        await orderHistoryRepository.upsert(record)
      })
      .catch((error) => {
        recordFailure({
          error,
          event,
          stage: "write",
        })
      })
      .finally(() => {
        pendingCount -= 1
      })
  }

  function handleEvent(event) {
    if (!ORDER_HISTORY_EVENT_NAMES.has(event?.name)) {
      return
    }
    if (closed) {
      recordFailure({
        error: new OrderHistoryPersistenceError({
          stage: "closed",
          code: "HARVESTER_ORDER_HISTORY_OBSERVER_CLOSED",
          context: createEventContext(event),
        }),
        event,
        stage: "closed",
      })
      return
    }
    let record
    try {
      record = createOrderHistoryRecord({
        order: event.data,
        sourceEvent: event,
        environment,
      })
    } catch (error) {
      recordFailure({
        error,
        event,
        stage: "mapping",
      })
      return
    }
    if (record !== null) {
      enqueue({
        record,
        event,
      })
    }
  }

  const subscription = eventBus.subscribeAll({
    handler: handleEvent,
  })
  if (!subscription || typeof subscription.unsubscribe !== "function") {
    throw new TypeError("OrderHistoryObserver EventBus subscription must expose unsubscribe()")
  }

  function close() {
    if (!closePromise) {
      closed = true
      try {
        subscription.unsubscribe()
      } catch (error) {
        recordFailure({
          error,
          stage: "unsubscribe",
        })
      }
      closePromise = flush()
    }
    return closePromise
  }

  return Object.freeze({
    flush,
    close,
    getDiagnostics,
  })
}
