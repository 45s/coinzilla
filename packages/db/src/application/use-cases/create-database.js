import { createDatabaseEntity } from "../../domain/entities/database.js"

const REQUIRED_ADAPTER_METHODS = Object.freeze([
  "connect",
  "close",
  "withTransaction",
])

/**
 * Create the provider-independent database lifecycle facade.
 *
 * @param {{adapter?: import("../ports/database-provider.js").DatabaseProvider, provider?: import("../ports/database-provider.js").DatabaseProvider}} options
 * @returns {ReturnType<typeof createDatabaseEntity>}
 */
export function createDatabase({ adapter, provider = adapter } = {}) {
  if (!provider || typeof provider !== "object") {
    throw new TypeError("A database adapter object is required")
  }

  const missingMethods = REQUIRED_ADAPTER_METHODS.filter(
    (method) => typeof provider[method] !== "function",
  )
  if (missingMethods.length > 0) {
    throw new TypeError(
      `Database adapter must implement: ${missingMethods.join(", ")}`,
    )
  }

  return createDatabaseEntity({ provider })
}
