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

function recordBufferLoss({ state, logger } = {}) {
  if (state.lossReported) {
    return
  }
  state.lossReported = true
  reportBufferLoss({
    logger,
    droppedCount: state.droppedCount,
  })
}

function writeBufferedEntry({ entry, state, capacity, logger } = {}) {
  if (state.closed || !isErrorRecord(entry)) {
    return
  }
  if (state.active) {
    try {
      state.handler(entry)
    } catch {
      state.droppedCount += 1
      recordBufferLoss({
        state,
        logger,
      })
    }
    return
  }
  if (state.entries.length >= capacity) {
    state.droppedCount += 1
    recordBufferLoss({
        state,
        logger,
      })
    return
  }
  state.entries.push(entry)
}

function activateBuffer({ state, handler, logger } = {}) {
  if (state.closed) {
    throw new Error("Cannot activate a closed Harvester runtime error buffer")
  }
  if (typeof handler !== "function") {
    throw new TypeError("Harvester runtime error buffer activation requires a handler")
  }
  if (state.active) {
    throw new Error("Harvester runtime error buffer is already active")
  }
  state.handler = handler
  state.active = true
  const bufferedEntries = state.entries.splice(0)
  for (const entry of bufferedEntries) {
    try {
      handler(entry)
    } catch {
      state.droppedCount += 1
      recordBufferLoss({
        state,
        logger,
      })
    }
  }
  return Object.freeze({
    bufferedCount: bufferedEntries.length,
  })
}

function getBufferDiagnostics(state) {
  return Object.freeze({
    bufferedCount: state.entries.length,
    droppedCount: state.droppedCount,
    active: state.active,
    closed: state.closed,
  })
}

async function closeBuffer({ state, logger } = {}) {
  if (state.droppedCount > 0) {
    recordBufferLoss({
        state,
        logger,
      })
  }
  state.closed = true
  state.active = false
  state.entries.length = 0
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
  const state = {
    entries: [],
    active: false,
    closed: false,
    handler: null,
    droppedCount: 0,
    lossReported: false,
  }
  const transport = Object.freeze({
    name: TRANSPORT_NAME,
    level: "error",
    write: (entry) => writeBufferedEntry({
      entry,
      state,
      capacity,
      logger,
    }),
    close: () => closeBuffer({
      state,
      logger,
    }),
  })
  return Object.freeze({
    transport,
    activate: (handler) => activateBuffer({
      state,
      handler,
      logger,
    }),
    getDiagnostics: () => getBufferDiagnostics(state),
    close: transport.close,
  })
}
