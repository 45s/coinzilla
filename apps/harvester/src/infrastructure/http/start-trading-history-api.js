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

function resolveTradingHistoryApiEnvironment({ env, environment } = {}) {
  const selectedEnvironment = environment ?? env.TRADING_MODE
  if (selectedEnvironment !== "testnet" && selectedEnvironment !== "live") {
    throw new TradingHistoryApiStartupError({
      message: "The Harvester trading-history API requires an explicit TESTNET or LIVE environment.",
      code: "HARVESTER_TRADING_HISTORY_API_CONFIGURATION_INVALID",
      environment: selectedEnvironment ?? "unknown",
    })
  }
  return selectedEnvironment
}

function resolveTradingHistoryApiToken({ env, environment } = {}) {
  const token = env.HARVESTER_API_TOKEN
  if (typeof token !== "string" || token.trim() !== token || Buffer.byteLength(token, "utf8") < MINIMUM_API_TOKEN_BYTES) {
    throw new TradingHistoryApiStartupError({
      message: "HARVESTER_API_TOKEN must contain at least 32 non-whitespace characters.",
      code: "HARVESTER_TRADING_HISTORY_API_CONFIGURATION_INVALID",
      environment,
    })
  }
  return token
}

function resolveTradingHistoryApiHost({ env, environment } = {}) {
  const host = env.HARVESTER_API_HOST || DEFAULT_API_HOST
  if (typeof host !== "string" || host.trim() !== host || host.length === 0) {
    throw new TradingHistoryApiStartupError({
      message: "HARVESTER_API_HOST must be a non-empty host name or IP address.",
      code: "HARVESTER_TRADING_HISTORY_API_CONFIGURATION_INVALID",
      environment,
    })
  }
  return host
}

function resolveTradingHistoryApiPort({ env, environment } = {}) {
  const port = env.HARVESTER_API_PORT === undefined
    ? DEFAULT_API_PORT
    : Number(env.HARVESTER_API_PORT)
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new TradingHistoryApiStartupError({
      message: "HARVESTER_API_PORT must be an integer between 0 and 65535.",
      code: "HARVESTER_TRADING_HISTORY_API_CONFIGURATION_INVALID",
      environment,
    })
  }
  return port
}

function resolveStartupConfiguration({ env, environment } = {}) {
  const selectedEnvironment = resolveTradingHistoryApiEnvironment({
    env,
    environment,
  })
  return Object.freeze({
    environment: selectedEnvironment,
    token: resolveTradingHistoryApiToken({
      env,
      environment: selectedEnvironment,
    }),
    host: resolveTradingHistoryApiHost({
      env,
      environment: selectedEnvironment,
    }),
    port: resolveTradingHistoryApiPort({
      env,
      environment: selectedEnvironment,
    }),
  })
}

/**
 * Start the optional trading-history HTTP and WebSocket API inside the existing Harvester process.
 *
 * The API composes its query facade over Harvester's already-open relational database and
 * subscribes to persisted-history invalidation events on the existing EventBus.
 * Harvester retains ownership of the database and closes the listener before persistence.
 *
 * @param {{database: object, env?: object, environment?: string, logger?: object, eventBus: object, startServer?: Function}} input
 * @returns {Promise<Readonly<object>|null>} API lifecycle or null when disabled.
 */
export async function startTradingHistoryApi({
  database,
  env = process.env,
  environment,
  logger = defaultLogger,
  eventBus,
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
    eventBus,
  })
  return Object.freeze({
    address: server.address,
    close: () => server.close(),
  })
}
