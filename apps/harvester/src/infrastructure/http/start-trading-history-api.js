import { defaultLogger, SystemCustomError } from "@coinzilla/utils"
import { createTradingHistoryQueryRepository } from "../persistence/trading-history-query-repository.js"
import { createBitunixFuturesMarketDataClient } from "./bitunix-futures-market-data.js"
import { createTradingHistoryQueries } from "../../use-cases/trading-history/queries.js"
import { startTradingHistoryApiServer } from "./trading-history-api.js"

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
    host: DEFAULT_API_HOST,
    port: resolveTradingHistoryApiPort({
      env,
      environment: selectedEnvironment,
    }),
  })
}

/**
 * Start the local trading-history HTTP and WebSocket API inside the existing Harvester process.
 *
 * The API composes its query facade over Harvester's already-open relational database and
 * subscribes to persisted-history invalidation events on the existing EventBus.
 * Harvester retains ownership of the database and closes the listener before persistence.
 *
 * @param {{database: object, env?: object, environment?: string, logger?: object, eventBus: object, startServer?: Function}} input
 * @returns {Promise<Readonly<object>>} API lifecycle handle.
 */
export async function startTradingHistoryApi({
  database,
  env = process.env,
  environment,
  logger = defaultLogger,
  eventBus,
  operator,
  marketData = createBitunixFuturesMarketDataClient(),
  startServer = startTradingHistoryApiServer,
} = {}) {
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
  if (!eventBus || typeof eventBus.subscribe !== "function") {
    throw new TradingHistoryApiStartupError({
      message: "The Harvester EventBus is unavailable; the optional trading-history API cannot start.",
      code: "HARVESTER_TRADING_HISTORY_API_EVENT_BUS_UNAVAILABLE",
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
    environment: configuration.environment,
    host: configuration.host,
    port: configuration.port,
    logger,
    eventBus,
    ...(operator === undefined ? {} : { operator }),
    marketData,
  })
  return Object.freeze({
    address: server.address,
    close: () => server.close(),
  })
}
