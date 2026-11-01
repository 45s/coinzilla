import { defaultLogger } from "@coinzilla/utils"

const LOGGER_METHODS = ["debug", "info", "warn", "error"]

export function createLoggerAdapter({ logger = defaultLogger } = {}) {
  if (logger === null || typeof logger !== "object") {
    throw new TypeError("logger must be an object")
  }

  for (const method of ["info", "error"]) {
    if (typeof logger[method] !== "function") {
      throw new TypeError(`logger.${method} must be a function`)
    }
  }

  const adapter = {}

  for (const method of LOGGER_METHODS) {
    if (typeof logger[method] === "function") {
      adapter[method] = (entry) => logger[method](entry)
    }
  }

  return Object.freeze(adapter)
}
