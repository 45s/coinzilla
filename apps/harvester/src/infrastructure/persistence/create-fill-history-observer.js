import { defaultLogger } from "@coinzilla/utils"
import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { assertFillHistoryRepository } from "../../application/ports/fill-history-repository.js"
import { OrderHistoryPersistenceError } from "./order-history-persistence-error.js"

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
    tradeId: data.tradeId ?? null,
  }
}

function recordFailure({ state, logger, error, event, stage } = {}) {
  const normalized = error?.code
    ? error
    : new OrderHistoryPersistenceError({
        stage,
        cause: error,
        context: createEventContext(event),
      })
  state.failureCount += 1
  state.droppedCount += 1
  if (state.errors.length >= MAX_RETAINED_ERRORS) {
    state.errors.shift()
  }
  state.errors.push(normalized)
  try {
    logger?.error?.({
      message: "Fill history projection failed",
      persistenceStage: stage,
      errorName: normalized.name,
      errorCode: normalized.code ?? "HARVESTER_FILL_HISTORY_PERSISTENCE_FAILED",
      ...createEventContext(event),
    })
  } catch {
    // Optional diagnostics must never escape into EventBus delivery.
  }
}

function getDiagnostics({ state, maxPending } = {}) {
  return Object.freeze({
    pendingCount: state.pendingCount,
    maxPending,
    droppedCount: state.droppedCount,
    failureCount: state.failureCount,
    closed: state.closed,
  })
}

function enqueueFill({ state, repository, event, environment, logger, maxPending } = {}) {
  if (state.pendingCount >= maxPending) {
    recordFailure({
      state,
      logger,
      event,
      stage: "queue",
      error: new OrderHistoryPersistenceError({
        stage: "queue",
        code: "HARVESTER_FILL_HISTORY_QUEUE_FULL",
        retryable: true,
        context: createEventContext(event),
      }),
    })
    return
  }
  state.pendingCount += 1
  state.queue = state.queue
    .then(() => repository.upsert({
      fill: event.data,
      sourceEvent: event,
      environment,
    }))
    .catch((error) => recordFailure({
      state,
      logger,
      error,
      event,
      stage: "write",
    }))
    .finally(() => {
      state.pendingCount -= 1
    })
}

function handleEvent({ event, state, repository, environment, logger, maxPending } = {}) {
  if (event?.name !== HARVESTER_EVENT_NAMES.FILL_APPLIED) {
    return
  }
  if (state.closed) {
    recordFailure({
      state,
      logger,
      event,
      stage: "closed",
      error: new OrderHistoryPersistenceError({
        stage: "closed",
        code: "HARVESTER_FILL_HISTORY_OBSERVER_CLOSED",
        context: createEventContext(event),
      }),
    })
    return
  }
  enqueueFill({ state, repository, event, environment, logger, maxPending })
}

function subscribe({ eventBus, handler } = {}) {
  const result = eventBus.subscribeAll({ handler })
  const subscription = result?.subscription
  if (result?.ok !== true || typeof subscription?.unsubscribe !== "function") {
    throw new TypeError("FillHistoryObserver EventBus subscribeAll must return a successful subscription")
  }
  return subscription
}

async function flushQueue(state) {
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
      recordFailure({ state, logger, error, stage: "unsubscribe" })
    }
    state.closePromise = flushQueue(state)
  }
  return state.closePromise
}

/**
 * Persist canonical applied-fill events through a bounded asynchronous queue.
 *
 * @param {{eventBus: object, repository: object, environment: string, logger?: object, maxPending?: number}} input
 * @returns {{flush: () => Promise<object>, close: () => Promise<object>, getDiagnostics: () => object}}
 */
export function createFillHistoryObserver({
  eventBus,
  repository,
  environment,
  logger = defaultLogger,
  maxPending = DEFAULT_MAX_PENDING_WRITES,
} = {}) {
  if (!eventBus || typeof eventBus.subscribeAll !== "function") {
    throw new TypeError("FillHistoryObserver requires an EventBus with subscribeAll")
  }
  if (!["testnet", "live"].includes(environment)) {
    throw new TypeError("FillHistoryObserver environment must be testnet or live")
  }
  if (!Number.isSafeInteger(maxPending) || maxPending < 1) {
    throw new TypeError("FillHistoryObserver maxPending must be a positive safe integer")
  }
  const fillRepository = assertFillHistoryRepository({ repository })
  const state = {
    pendingCount: 0,
    droppedCount: 0,
    failureCount: 0,
    closed: false,
    queue: Promise.resolve(),
    closePromise: null,
    errors: [],
  }
  state.diagnostics = () => getDiagnostics({ state, maxPending })
  const handler = (event) => handleEvent({
    event,
    state,
    repository: fillRepository,
    environment,
    logger,
    maxPending,
  })
  const subscription = subscribe({ eventBus, handler })
  return Object.freeze({
    flush: () => flushQueue(state),
    close: () => closeObserver({ state, subscription, logger }),
    getDiagnostics: state.diagnostics,
  })
}
