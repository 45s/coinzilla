/**
 * Validate constructor options and return the normalized supported options.
 * @param {unknown} options
 * @param {object} defaultLogger
 */
export function validateOptions(options, defaultLogger) {
  if (
    options === null ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    (Object.getPrototypeOf(options) !== Object.prototype &&
      Object.getPrototypeOf(options) !== null)
  ) {
    throw new TypeError("EventBus options must be a plain object")
  }

  for (const key of Reflect.ownKeys(options)) {
    if (key !== "logger" && key !== "onError") {
      throw new TypeError(`Unknown EventBus option: ${String(key)}`)
    }
  }

  const { logger = defaultLogger, onError } = options
  if (
    logger === null ||
    typeof logger !== "object" ||
    (logger.error !== undefined && typeof logger.error !== "function")
  ) {
    throw new TypeError(
      "EventBus logger must be an object with an optional error function",
    )
  }
  if (onError !== undefined && typeof onError !== "function") {
    throw new TypeError("EventBus onError must be a function")
  }

  return { logger, onError }
}
