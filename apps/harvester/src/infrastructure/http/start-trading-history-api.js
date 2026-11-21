import { access } from "node:fs/promises"
import {
  createSqliteDatabase,
} from "@coinzilla/db"
import { defaultLogger, SystemCustomError } from "@coinzilla/utils"
import { assertHarvesterDatabaseIsolation } from "../persistence/resolve-harvester-database-filename.js"
import { createTradingHistoryQueryRepository } from "../persistence/trading-history-query-repository.js"
import { createTradingHistoryQueries } from "../../use-cases/trading-history-queries.js"
import { startTradingHistoryApiServer } from "./trading-history-api.js"

const MINIMUM_API_TOKEN_BYTES = 32
const DEFAULT_API_HOST = "127.0.0.1"
const DEFAULT_API_PORT = 4201
const REQUIRED_TABLES = Object.freeze([
  "orders",
  "fills",
  "fill_commissions",
  "schema_migrations",
])

export class TradingHistoryApiStartupError extends SystemCustomError {
  constructor({ message, code, environment, cause } = {}) {
    super(message, {
      code,
      context: {
        environment,
      },
      ...(cause === undefined ? {} : { cause }),
    })
  }
}

function validateStartupConfiguration({ env } = {}) {
  const environment = env.TRADING_MODE
  if (environment !== "testnet" && environment !== "live") {
    throw new TypeError("TRADING_MODE must be exactly testnet or live to start the trading-history API.")
  }
  if (
    typeof env.HARVESTER_API_TOKEN !== "string" ||
    env.HARVESTER_API_TOKEN.trim() !== env.HARVESTER_API_TOKEN ||
    Buffer.byteLength(env.HARVESTER_API_TOKEN, "utf8") < MINIMUM_API_TOKEN_BYTES
  ) {
    throw new TypeError("HARVESTER_API_TOKEN must contain at least 32 non-whitespace characters.")
  }
  const host = env.HARVESTER_API_HOST || DEFAULT_API_HOST
  const port = env.HARVESTER_API_PORT === undefined
    ? DEFAULT_API_PORT
    : Number(env.HARVESTER_API_PORT)
  if (typeof host !== "string" || host.trim() !== host || host.length === 0) {
    throw new TypeError("HARVESTER_API_HOST must be a non-empty host name or IP address.")
  }
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new TypeError("HARVESTER_API_PORT must be an integer between 0 and 65535.")
  }
  return Object.freeze({
    environment,
    host,
    port,
    token: env.HARVESTER_API_TOKEN,
  })
}

function assertTradingHistorySchema({ database, environment } = {}) {
  const tables = new Set(database.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table'",
  ).all().map(({ name }) => name))
  const missing = REQUIRED_TABLES.filter((table) => !tables.has(table))
  if (missing.length > 0) {
    throw new TradingHistoryApiStartupError({
      message: "The selected Harvester database does not contain the trading-history schema.",
      code: "HARVESTER_TRADING_HISTORY_API_SCHEMA_UNAVAILABLE",
      environment,
    })
  }
  const migration = database.prepare(
    "SELECT MAX(version) AS version FROM schema_migrations",
  ).get()
  if (!Number.isSafeInteger(migration?.version) || migration.version < 2) {
    throw new TradingHistoryApiStartupError({
      message: "The selected Harvester database has not applied the required trading-history migrations.",
      code: "HARVESTER_TRADING_HISTORY_API_SCHEMA_UNAVAILABLE",
      environment,
    })
  }
}

async function closeDatabase({ database } = {}) {
  if (database?.state === "closed" || typeof database?.close !== "function") {
    return
  }
  await database.close()
}

async function closeResources({ server, database } = {}) {
  const failures = []
  try {
    await server?.close()
  } catch (error) {
    failures.push(error)
  }
  try {
    await closeDatabase({ database })
  } catch (error) {
    failures.push(error)
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "Trading-history API shutdown failed.", {
      cause: failures[0],
    })
  }
}

/**
 * Compose the standalone Harvester trading-history query service over the selected database.
 *
 * The service opens an existing environment-specific database, applies SQLite query_only
 * mode to its own connection, and exposes the transport-independent application queries.
 *
 * @param {{env?: object, logger?: object, createDatabase?: Function, startServer?: Function}} input
 * @returns {Promise<Readonly<{address: object, close: Function}>>} Running service lifecycle handle.
 */
async function assertExistingDatabase({ filename, environment } = {}) {
  try {
    await access(filename)
  } catch (cause) {
    throw new TradingHistoryApiStartupError({
      message: "The selected Harvester database does not exist yet; start Harvester once to initialize it.",
      code: "HARVESTER_TRADING_HISTORY_API_DATABASE_UNAVAILABLE",
      environment,
      cause,
    })
  }
}

async function openQueryDatabase({ filename, environment, createDatabase } = {}) {
  const database = createDatabase({
    filename,
    timeout: 5_000,
  })
  try {
    await database.connect()
    database.exec("PRAGMA query_only = ON")
    const queryOnly = database.prepare("PRAGMA query_only").get()
    if (queryOnly?.query_only !== 1) {
      throw new TradingHistoryApiStartupError({
        message: "The trading-history API database connection could not enable query-only SQLite mode.",
        code: "HARVESTER_TRADING_HISTORY_API_DATABASE_CONFIGURATION_FAILED",
        environment,
      })
    }
    assertTradingHistorySchema({
      database,
      environment,
    })
    return database
  } catch (error) {
    try {
      await closeDatabase({
        database,
      })
    } catch (cleanupError) {
      throw new AggregateError([
        error,
        cleanupError,
      ], "Trading-history API database initialization and cleanup failed.", { cause: cleanupError })
    }
    throw error
  }
}

async function startServerWithDatabase({
  database,
  configuration,
  logger,
  startServer,
} = {}) {
  const repository = createTradingHistoryQueryRepository({
    database,
  })
  const queries = createTradingHistoryQueries({
    repository,
  })
  try {
    return await startServer({
      queries,
      token: configuration.token,
      environment: configuration.environment,
      host: configuration.host,
      port: configuration.port,
      logger,
    })
  } catch (error) {
    try {
      await closeDatabase({
        database,
      })
    } catch (cleanupError) {
      throw new AggregateError([
        error,
        cleanupError,
      ], "Trading-history API startup and database cleanup failed.", { cause: cleanupError })
    }
    throw error
  }
}

/**
 * Compose the standalone Harvester trading-history query service over the selected database.
 *
 * The service opens an existing environment-specific database, applies SQLite query_only
 * mode to its own connection, and exposes the transport-independent application queries.
 *
 * @param {{env?: object, logger?: object, createDatabase?: Function, startServer?: Function}} input
 * @returns {Promise<Readonly<{address: object, close: Function}>>} Running service lifecycle handle.
 */
export async function startTradingHistoryApi({
  env = process.env,
  logger = defaultLogger,
  createDatabase = createSqliteDatabase,
  startServer = startTradingHistoryApiServer,
} = {}) {
  const configuration = validateStartupConfiguration({
    env,
  })
  const filename = await assertHarvesterDatabaseIsolation({
    tradingMode: configuration.environment,
    env,
  })
  await assertExistingDatabase({
    filename,
    environment: configuration.environment,
  })
  const database = await openQueryDatabase({
    filename,
    environment: configuration.environment,
    createDatabase,
  })
  const server = await startServerWithDatabase({
    database,
    configuration,
    logger,
    startServer,
  })
  return Object.freeze({
    address: server.address,
    close: () => closeResources({
      server,
      database,
    }),
  })
}
