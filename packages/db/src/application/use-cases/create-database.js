import { createDatabaseEntity } from "../../domain/entities/database.js"

/**
 * Create the provider-independent database lifecycle facade.
 *
 * @param {{provider: import("../ports/database-provider.js").DatabaseProvider}} options
 * @returns {ReturnType<typeof createDatabaseEntity>}
 */
export function createDatabase({ adapter, provider = adapter } = {}) {
  return createDatabaseEntity({ provider })
}
