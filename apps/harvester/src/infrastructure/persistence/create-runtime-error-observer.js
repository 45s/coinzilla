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

  const queue = []
  const errors = []
  let droppedCount = 0
  let failedCount = 0
  let closed = false
  let draining = false
  let overflowReported = false
  let drainPromise = Promise.resolve()

  async function drain() {
    if (draining) {
      await drainPromise
      return
    }
    draining = true
    drainPromise = (async () => {
      while (queue.length > 0) {
        const entry = queue.shift()
        try {
          await repository.create({ entry })
        } catch (error) {
          failedCount += 1
          if (errors.length < MAX_RETAINED_ERRORS) {
            errors.push(error)
          }
          reportPersistenceFailure({ logger, error })
        }
      }
    })()
    try {
      await drainPromise
    } finally {
      draining = false
    }
  }

  function enqueue(entry) {
    if (closed) {
      return false
    }
    if (queue.length >= queueCapacity) {
      droppedCount += 1
      if (!overflowReported) {
        overflowReported = true
        reportQueueOverflow({
          logger,
          droppedCount,
        })
      }
      return false
    }
    queue.push(entry)
    void drain()
    return true
  }

  const activation = errorBuffer.activate(enqueue)

  async function flush() {
    await drain()
    return Object.freeze({
      ok: errors.length === 0 && droppedCount === 0,
      errors: [...errors],
    })
  }

  return Object.freeze({
    activation,
    enqueue,
    flush,
    getDiagnostics() {
      return Object.freeze({
        queuedCount: queue.length,
        droppedCount,
        failedCount,
        closed,
      })
    },
    async close() {
      if (closed) {
        return flush()
      }
      errorBuffer.close()
      closed = true
      await drain()
      return flush()
    },
  })
}
