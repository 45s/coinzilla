import { defaultLogger, SystemCustomError } from "@coinzilla/utils"
import { createTradingHistoryQueryRepository } from "../persistence/trading-history-query-repository.js"
import { createTradingHistoryQueries } from "../../use-cases/trading-history/queries.js"
import { startTradingHistoryApiServer } from "./trading-history-api.js"

const MINIMUM_API_TOKEN_BYTES = 32
const DEFAULT_API_HOST = "127.0.0.1"
const DEFAULT_API_PORT = 4201

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

function resolveStartupConfiguration({ env, environment } = {}) {
  const selectedEnvironment = environment ?? env.TRADING_MODE
  if (selectedEnvironment !== "testnet" && selectedEnvironment !== "live") {
    throw new TradingHistoryApiStartupError({
      message: "The Harvester trading-history API requires an explicit TESTNET or LIVE environment.",
      code: "HARVESTER_TRADING_HISTORY_API_CONFIGURATION_INVALID",
      environment: selectedEnvironment ?? "unknown",
    })
  }
  const token = env.HARVESTER_API_TOKEN
  if (typeof token !== "string" || token.trim() !== token || Buffer.byteLength(token, "utf8") < MINIMUM_API_TOKEN_BYTES) {
    throw new TradingHistoryApiStartupError({
      message: "HARVESTER_API_TOKEN must contain at least 32 non-whitespace characters.",
      code: "HARVESTER_TRADING_HISTORY_API_CONFIGURATION_INVALID",
      environment: selectedEnvironment,
    })
  }
  const host = env.HARVESTER_API_HOST || DEFAULT_API_HOST
  const port = env.HARVESTER_API_PORT === undefined
    ? DEFAULT_API_PORT
    : Number(env.HARVESTER_API_PORT)
  if (typeof host !== "string" || host.trim() !== host || host.length === 0) {
    throw new TradingHistoryApiStartupError({
      message: "HARVESTER_API_HOST must be a non-empty host name or IP address.",
      code: "HARVESTER_TRADING_HISTORY_API_CONFIGURATION_INVALID",
      environment: selectedEnvironment,
    })
  }
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new TradingHistoryApiStartupError({
      message: "HARVESTER_API_PORT must be an integer between 0 and 65535.",
      code: "HARVESTER_TRADING_HISTORY_API_CONFIGURATION_INVALID",
      environment: selectedEnvironment,
    })
  }
  return Object.freeze({
    environment: selectedEnvironment,
    token,
    host,
    port,
  })
}

/**
 * Start the optional trading-history HTTP API inside the existing Harvester process.
 *
 * The API composes its query facade over Harvester's already-open relational database.
 * Harvester retains ownership of that database and closes the HTTP listener first.
 *
 * @param {object} input
 * @returns {Promise<Readonly<object>|null>} API lifecycle or null when disabled.
 */
export async function startTradingHistoryApi({
  database,
  env = process.env,
  environment,
  logger = defaultLogger,
  startServer = startTradingHistoryApiServer,
} = {}) {
  if (!env.HARVESTER_API_TOKEN) {
    return null
  }
  const configuration = resolveStartupConfiguration({
    env,
    environment,
  })
  if (!database || typeof database.prepare !== "function") {
    throw new TradingHistoryApiStartupError({
      message: "The Harvester relational trading-history database is unavailable; the optional API cannot start.",
      code: "HARVESTER_TRADING_HISTORY_API_DATABASE_UNAVAILABLE",
      environment: configuration.environment,
    })
  }
  const repository = createTradingHistoryQueryRepository({
    database,
  })
  const queries = createTradingHistoryQueries({
    repository,
  })
  const server = await startServer({
    queries,
    token: configuration.token,
    environment: configuration.environment,
    host: configuration.host,
    port: configuration.port,
    logger,
  })
  return Object.freeze({
    address: server.address,
    close: () => server.close(),
  })
}
