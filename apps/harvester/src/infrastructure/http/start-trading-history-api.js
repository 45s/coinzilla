import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { defaultLogger, SystemCustomError } from "@coinzilla/utils"
import { createTradingHistoryQueryRepository } from "../persistence/trading-history-query-repository.js"
import { createBitunixFuturesMarketDataClient } from "./bitunix-futures-market-data.js"
import { createTradingHistoryQueries } from "../../use-cases/trading-history/queries.js"
import { startTradingHistoryApiServer } from "./trading-history-api.js"
import { createScenarioRunnerHost } from "./create-scenario-runner-host.js"
import { createUnavailableScenarioAdapter } from "../scenario-runner/create-unavailable-scenario-adapter.js"
import { createProcessScenarioAdapter } from "../scenario-runner/create-process-scenario-adapter.js"
import { createLinuxBubblewrapSandboxLauncher } from "../scenario-runner/create-linux-bubblewrap-sandbox-launcher.js"
import { createNodeGuardedSimulationLauncher } from "../scenario-runner/create-node-guarded-simulation-launcher.js"

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

function validateApiDependencies({ database, eventBus, environment }) {
  if (database !== undefined && database !== null && typeof database.prepare !== "function") {
    throw new TradingHistoryApiStartupError({
      message: "The supplied Harvester relational trading-history database handle is invalid.",
      code: "HARVESTER_TRADING_HISTORY_API_DATABASE_UNAVAILABLE",
      environment,
    })
  }
  if (!eventBus || typeof eventBus.subscribe !== "function") {
    throw new TradingHistoryApiStartupError({
      message: "The Harvester EventBus is unavailable; the local runtime API cannot start.",
      code: "HARVESTER_TRADING_HISTORY_API_EVENT_BUS_UNAVAILABLE",
      environment,
    })
  }
}

const HARVESTER_REPOSITORY_ROOT = fileURLToPath(new URL("../../../../..", import.meta.url))
const GIT_COMMIT_SHA_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i

function resolveScenarioRunnerSourceRevision({ env } = {}) {
  const configuredRevision = env.COINZILLA_SOURCE_REVISION
  if (configuredRevision !== undefined) {
    return typeof configuredRevision === "string" && GIT_COMMIT_SHA_PATTERN.test(configuredRevision)
      ? configuredRevision.toLowerCase()
      : null
  }
  try {
    const sourceRevision = execFileSync("git", [
      "-C", HARVESTER_REPOSITORY_ROOT, "rev-parse", "--verify", "HEAD",
    ], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
    if (!GIT_COMMIT_SHA_PATTERN.test(sourceRevision)) {
      return null
    }
    const worktreeStatus = execFileSync("git", [
      "-C", HARVESTER_REPOSITORY_ROOT, "status", "--porcelain", "--untracked-files=all",
    ], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
    return worktreeStatus ? null : sourceRevision.toLowerCase()
  } catch {
    return null
  }
}

function createScenarioRunnerAdapter({ env, platform }) {
  if (platform === "win32") {
    try {
      return createProcessScenarioAdapter({
        strategyId: "RS",
        spawnSandboxedWorker: createNodeGuardedSimulationLauncher(),
      })
    } catch {
      return createUnavailableScenarioAdapter({
        strategyId: "RS",
        reason: "The Windows guarded-simulation worker could not be initialized; scenario execution remains blocked.",
      })
    }
  }
  if (env.HARVESTER_SCENARIO_SANDBOX !== "linux-bubblewrap") {
    return createUnavailableScenarioAdapter({
      strategyId: "RS",
      reason: "No local simulation worker is configured for this host platform; Linux OS hardening remains optional.",
    })
  }
  let launcher
  try {
    launcher = createLinuxBubblewrapSandboxLauncher()
  } catch {
    return createUnavailableScenarioAdapter({
      strategyId: "RS",
      reason: "The configured Linux Bubblewrap/prlimit sandbox failed verification; Recovery Seller scenario execution remains blocked.",
    })
  }
  try {
    return createProcessScenarioAdapter({
      strategyId: "RS",
      spawnSandboxedWorker: launcher,
    })
  } catch {
    return createUnavailableScenarioAdapter({
      strategyId: "RS",
      reason: "Recovery Seller scenario execution requires a verified OS sandbox launcher.",
    })
  }
}


function createUnavailableTradingHistoryQueries() {
  const unavailable = () => ({
    ok: false,
    errors: [{
      code: "HARVESTER_TRADING_HISTORY_PERSISTENCE_UNAVAILABLE",
      message: "Persisted trading history is unavailable because relational history persistence is not ready.",
    }],
  })
  return Object.freeze({
    getSummary: unavailable,
    listOrders: unavailable,
    getOrder: unavailable,
    listFills: unavailable,
    getFill: unavailable,
    listCommissions: unavailable,
  })
}

function createQueryFacade({ database }) {
  if (!database) {
    return createUnavailableTradingHistoryQueries()
  }
  const repository = createTradingHistoryQueryRepository({ database })
  return createTradingHistoryQueries({ repository })
}

async function openApiServer({
  startServer,
  configuration,
  queries,
  logger,
  eventBus,
  operator,
  exchangeAccounts,
  subscribeExchangeAccountUpdates,
  marketData,
  runnerHost,
}) {
  return startServer({
    queries,
    environment: configuration.environment,
    host: configuration.host,
    port: configuration.port,
    logger,
    eventBus,
    ...(operator === undefined ? {} : { operator }),
    exchangeAccounts,
    subscribeExchangeAccountUpdates,
    marketData,
    scenarioRunner: runnerHost.runner,
    scenarioRunnerCatalog: runnerHost.catalog,
  })
}

/**
 * Start the local trading-history HTTP and WebSocket API inside the existing Harvester process.
 * The API owns neither Harvester's shared database nor its EventBus.
 */
export async function startTradingHistoryApi({
  database,
  env = process.env,
  environment,
  logger = defaultLogger,
  eventBus,
  operator,
  exchangeAccounts = [],
  subscribeExchangeAccountUpdates,
  marketData = createBitunixFuturesMarketDataClient(),
  startServer = startTradingHistoryApiServer,
  platform = process.platform,
} = {}) {
  const configuration = resolveStartupConfiguration({
    env,
    environment,
  })
  validateApiDependencies({
    database,
    eventBus,
    environment: configuration.environment,
  })
  const queries = createQueryFacade({ database })
  const runnerHost = createScenarioRunnerHost({
    eventBus,
    adapters: [createScenarioRunnerAdapter({
      env,
      platform,
    })],
    sourceRevision: resolveScenarioRunnerSourceRevision({ env }),
  })
  const server = await openApiServer({
    startServer,
    configuration,
    queries,
    logger,
    eventBus,
    operator,
    exchangeAccounts,
    subscribeExchangeAccountUpdates,
    marketData,
    runnerHost,
  })
  return Object.freeze({
    address: server.address,
    close: async () => {
      try {
        await runnerHost.runner.close()
      } finally {
        await server.close()
      }
    },
  })
}
