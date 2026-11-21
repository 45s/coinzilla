const DEFAULT_QUEUE_CAPACITY = 10_000
const MAX_RETAINED_ERRORS = 20

function reportPersistenceFailure({ logger, error } = {}) {
  try {
    logger?.warn?.({
      message: "Harvester runtime error relational projection failed; full diagnostics remain in session logs",
      errorName: error?.name ?? "Error",
      errorCode: error?.code ?? "HARVESTER_RUNTIME_ERROR_PERSISTENCE_FAILED",
    })
  } catch {
    // A diagnostic projection must never recurse into or disrupt the Logger.
  }
}

function reportQueueOverflow({ logger, droppedCount } = {}) {
  try {
    logger?.warn?.({
      message: "Harvester runtime error persistence queue overflow; additional ERROR records remain available only in session logs",
      droppedCount,
    })
  } catch {
    // Queue diagnostics must never recurse into or disrupt the Logger.
  }
}

function createQueueDrain({ state, repository, logger } = {}) {
  return async function drain() {
    if (state.draining) {
      await state.drainPromise
      return
    }
    state.draining = true
    state.drainPromise = (async () => {
      while (state.queue.length > 0) {
        const entry = state.queue.shift()
        try {
          await repository.create({ entry })
        } catch (error) {
          state.failedCount += 1
          if (state.errors.length < MAX_RETAINED_ERRORS) {
            state.errors.push(error)
          }
          reportPersistenceFailure({
            logger,
            error,
          })
        }
      }
    })()
    try {
      await state.drainPromise
    } finally {
      state.draining = false
    }
  }
}

function enqueueRuntimeError({ entry, state, queueCapacity, logger, drain } = {}) {
  if (state.closed) {
    return false
  }
  if (state.queue.length >= queueCapacity) {
    state.droppedCount += 1
    if (!state.overflowReported) {
      state.overflowReported = true
      reportQueueOverflow({
        logger,
        droppedCount: state.droppedCount,
      })
    }
    return false
  }
  state.queue.push(entry)
  void drain()
  return true
}

function getObserverDiagnostics(state) {
  return Object.freeze({
    queuedCount: state.queue.length,
    droppedCount: state.droppedCount,
    failedCount: state.failedCount,
    closed: state.closed,
  })
}

/**
 * Bridge the process-start error buffer to a bounded, non-blocking SQLite writer.
 *
 * @param {{repository: object, errorBuffer: object, logger?: object, queueCapacity?: number}} options
 * @returns {object}
 */
export function createRuntimeErrorObserver({
  repository,
  errorBuffer,
  logger,
  queueCapacity = DEFAULT_QUEUE_CAPACITY,
} = {}) {
  if (typeof repository?.create !== "function") {
    throw new TypeError("Runtime error observer requires a repository")
  }
  if (typeof errorBuffer?.activate !== "function") {
    throw new TypeError("Runtime error observer requires the process error buffer")
  }
  if (!Number.isSafeInteger(queueCapacity) || queueCapacity < 1) {
    throw new RangeError("Runtime error persistence queue capacity must be a positive safe integer")
  }
  const state = {
    queue: [],
    errors: [],
    droppedCount: 0,
    failedCount: 0,
    closed: false,
    draining: false,
    overflowReported: false,
    drainPromise: Promise.resolve(),
  }
  const drain = createQueueDrain({
    state,
    repository,
    logger,
  })
  const enqueue = (entry) => enqueueRuntimeError({
    entry,
    state,
    queueCapacity,
    logger,
    drain,
  })
  const activation = errorBuffer.activate(enqueue)
  const flush = async () => {
    await drain()
    return Object.freeze({
      ok: state.errors.length === 0 && state.droppedCount === 0,
      errors: [...state.errors],
    })
  }
  return Object.freeze({
    activation,
    enqueue,
    flush,
    getDiagnostics: () => getObserverDiagnostics(state),
    async close() {
      if (state.closed) {
        return flush()
      }
      await errorBuffer.close()
      state.closed = true
      await drain()
      return flush()
    },
  })
}
