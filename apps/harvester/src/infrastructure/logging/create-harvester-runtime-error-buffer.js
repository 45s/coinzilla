const DEFAULT_BUFFER_CAPACITY = 10_000
const TRANSPORT_NAME = "harvester-runtime-error-buffer"

function isErrorRecord(entry) {
  return entry?.level === "error" || entry?.method === "error"
}

function reportBufferLoss({ logger, droppedCount } = {}) {
  try {
    logger?.warn?.({
      message: "Harvester pre-database runtime error buffer overflow; dropped ERROR records remain available only in session logs",
      droppedCount,
    })
  } catch {
    // Buffer diagnostics must never recurse into or disrupt the Logger.
  }
}

/**
 * Keep ERROR records emitted before relational persistence becomes available.
 *
 * @param {{capacity?: number, logger?: object}} options
 * @returns {object}
 */
export function createHarvesterRuntimeErrorBuffer({
  capacity = DEFAULT_BUFFER_CAPACITY,
  logger,
} = {}) {
  if (!Number.isSafeInteger(capacity) || capacity < 1) {
    throw new RangeError("Harvester runtime error buffer capacity must be a positive safe integer")
  }

  let active = false
  let closed = false
  let handler
  let droppedCount = 0
  let lossReported = false
  const entries = []

  const reportLoss = () => {
    if (droppedCount > 0 && !lossReported) {
      lossReported = true
      reportBufferLoss({
        logger,
        droppedCount,
      })
    }
  }

  const write = (entry) => {
    if (closed || !isErrorRecord(entry)) {
      return
    }
    if (active) {
      try {
        handler(entry)
      } catch {
        droppedCount += 1
        reportLoss()
      }
      return
    }
    if (entries.length >= capacity) {
      droppedCount += 1
      reportLoss()
      return
    }
    entries.push(entry)
  }

  const transport = Object.freeze({
    name: TRANSPORT_NAME,
    level: "error",
    write,
    close: async () => {
      reportLoss()
      closed = true
      active = false
      entries.length = 0
    },
  })

  return Object.freeze({
    transport,
    activate(nextHandler) {
      if (closed) {
        throw new Error("Cannot activate a closed Harvester runtime error buffer")
      }
      if (typeof nextHandler !== "function") {
        throw new TypeError("Harvester runtime error buffer activation requires a handler")
      }
      if (active) {
        throw new Error("Harvester runtime error buffer is already active")
      }
      handler = nextHandler
      active = true
      const bufferedCount = entries.length
      const bufferedEntries = entries.splice(0)
      for (const entry of bufferedEntries) {
        try {
          handler(entry)
        } catch {
          droppedCount += 1
          reportLoss()
        }
      }
      return Object.freeze({ bufferedCount })
    },
    getDiagnostics() {
      return Object.freeze({
        bufferedCount: entries.length,
        droppedCount,
        active,
        closed,
      })
    },
    close: transport.close,
  })
}
