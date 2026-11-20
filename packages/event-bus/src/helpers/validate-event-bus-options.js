/**
 * Validate EventBus constructor options and return normalized supported options.
 * @param {object} input
 * @param {unknown} input.options
 * @param {object} input.defaultLogger
 */
export function validateEventBusOptions({ options, defaultLogger }) {
  assertEventBusOptionsRecord({ options })
  assertSupportedEventBusOptionKeys({ options })

  const { logger = defaultLogger, onError, maxPending = 1000 } = options
  assertValidEventBusLogger({ logger })
  assertValidEventBusErrorReporter({ onError })
  assertValidEventBusPendingLimit({ maxPending })

  return {
    logger,
    onError,
    maxPending,
  }
}

function assertEventBusOptionsRecord({ options }) {
  if (
    options === null ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    (Object.getPrototypeOf(options) !== Object.prototype &&
      Object.getPrototypeOf(options) !== null)
  ) {
    throw new TypeError("EventBus options must be a plain object")
  }
}

function assertSupportedEventBusOptionKeys({ options }) {
  for (const key of Reflect.ownKeys(options)) {
    if (key !== "logger" && key !== "onError" && key !== "maxPending") {
      throw new TypeError(`Unknown EventBus option: ${String(key)}`)
    }
  }
}

function assertValidEventBusLogger({ logger }) {
  if (
    logger === null ||
    typeof logger !== "object" ||
    (logger.error !== undefined && typeof logger.error !== "function")
  ) {
    throw new TypeError(
      "EventBus logger must be an object with an optional error function",
    )
  }
}

function assertValidEventBusErrorReporter({ onError }) {
  if (onError !== undefined && typeof onError !== "function") {
    throw new TypeError("EventBus onError must be a function")
  }
}

function assertValidEventBusPendingLimit({ maxPending }) {
  if (!Number.isSafeInteger(maxPending) || maxPending < 1) {
    throw new TypeError("EventBus maxPending must be a positive safe integer")
  }
}
