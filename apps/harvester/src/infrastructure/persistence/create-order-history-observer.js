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

function recordObserverFailure({ state, logger, error, event, stage, code } = {}) {
  const normalized = createObserverError({
    error,
    event,
    stage,
    code,
  })
  state.failureCount += 1
  state.droppedCount += 1
  if (state.errors.length === MAX_RETAINED_ERRORS) {
    state.errors.shift()
  }
  state.errors.push(normalized)
  try {
    logger?.error?.(createFailureDiagnostic({
      error: normalized,
      event,
      stage,
    }))
  } catch {
    // Optional diagnostics must never escape into EventBus delivery.
  }
}

function getObserverDiagnostics({ state, maxPending } = {}) {
  return Object.freeze({
    pendingCount: state.pendingCount,
    maxPending,
    droppedCount: state.droppedCount,
    failureCount: state.failureCount,
    closed: state.closed,
  })
}

function enqueueOrderHistoryRecord({
  state,
  repository,
  logger,
  maxPending,
  record,
  event,
} = {}) {
  if (state.pendingCount >= maxPending) {
    recordObserverFailure({
      state,
      logger,
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
  state.pendingCount += 1
  state.queue = state.queue
    .then(async () => repository.upsert(record))
    .catch((error) => {
      recordObserverFailure({
        state,
        logger,
        error,
        event,
        stage: "write",
      })
    })
    .finally(() => {
      state.pendingCount -= 1
    })
}

function handleOrderHistoryEvent({
  event,
  state,
  repository,
  environment,
  logger,
  maxPending,
} = {}) {
  if (!ORDER_HISTORY_EVENT_NAMES.has(event?.name)) {
    return
  }
  if (state.closed) {
    recordObserverFailure({
      state,
      logger,
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
    recordObserverFailure({
      state,
      logger,
      error,
      event,
      stage: "mapping",
    })
    return
  }
  if (record !== null) {
    enqueueOrderHistoryRecord({
      state,
      repository,
      logger,
      maxPending,
      record,
      event,
    })
  }
}

function subscribeToOrderHistoryEvents({ eventBus, handler } = {}) {
  const result = eventBus.subscribeAll({
    handler,
  })
  const subscription = result?.subscription
  if (result?.ok !== true || !subscription || typeof subscription.unsubscribe !== "function") {
    throw new TypeError("OrderHistoryObserver EventBus subscribeAll must return a successful subscription")
  }
  return subscription
}

async function flushObserverQueue(state) {
  await state.queue
  return {
    ok: state.failureCount === 0,
    errors: [...state.errors],
    diagnostics: state.diagnostics(),
  }
}

function closeObserver({ state, subscription, logger } = {}) {
  if (!state.closePromise) {
    state.closed = true
    try {
      subscription.unsubscribe()
    } catch (error) {
      recordObserverFailure({
        state,
        logger,
        error,
        stage: "unsubscribe",
      })
    }
    state.closePromise = flushObserverQueue(state)
  }
  return state.closePromise
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
  const state = {
    pendingCount: 0,
    droppedCount: 0,
    failureCount: 0,
    closed: false,
    queue: Promise.resolve(),
    closePromise: null,
    errors: [],
  }
  state.diagnostics = () => getObserverDiagnostics({
    state,
    maxPending,
  })
  const handler = (event) => handleOrderHistoryEvent({
    event,
    state,
    repository: orderHistoryRepository,
    environment,
    logger,
    maxPending,
  })
  const subscription = subscribeToOrderHistoryEvents({
    eventBus,
    handler,
  })
  return Object.freeze({
    flush: () => flushObserverQueue(state),
    close: () => closeObserver({
      state,
      subscription,
      logger,
    }),
    getDiagnostics: state.diagnostics,
  })
}
