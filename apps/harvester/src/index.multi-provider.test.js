import test from "node:test"
import assert from "node:assert/strict"
import { main as startMain } from "./index.js"
import { appConfig as defaultAppConfig } from "../config/index.js"

const disabledJournalService = () => ({
  status: { enabled: false },
  ready: Promise.resolve({
    ok: true,
    disabled: true,
  }),
  flush: async () => ({
    ok: true,
    durable: true,
  }),
  close: async () => ({
    ok: true,
    closed: true,
    disabled: true,
  }),
})

const main = (options = {}) => {
  const { createJournalService = disabledJournalService, env = {}, ...rest } = options
  return startMain({
    acquireProcessLock: async () => ({
      ok: true,
      release: async () => ({
        ok: true,
        released: true,
      }),
    }),
    createOperationalStateStore: () => ({
      verify: async () => ({
        ok: true,
        data: {
          valid: true,
          durableWriteSupported: true,
        },
      }),
    }),
    ...rest,
    env: {
      TRADING_MODE: "testnet",
      ...env,
    },
    createJournalService: (...args) => {
      const service = createJournalService(...args) ?? {}
      if (!Object.hasOwn(service, "ready")) {
        service.ready = Promise.resolve({ ok: true })
      }
      if (!Object.hasOwn(service, "flush")) {
        service.flush = async () => ({
          ok: true,
          durable: true,
        })
      }
      if (!Object.hasOwn(service, "close")) {
        service.close = async () => ({
          ok: true,
          closed: true,
        })
      }
      return service
    },
  })
}

function createMainProcessLockAcquirer({
  lockScopes,
  releasedLocks,
}) {
  return async (input) => {
    lockScopes.push({
      broker: input.broker,
      providerInstanceId: input.providerInstanceId,
      accountId: input.accountId,
      tradingMode: input.tradingMode,
    })
    return {
      ok: true,
      lockScope: input,
      release: async () => {
        releasedLocks.push(input.providerInstanceId)
        return {
          ok: true,
          released: true,
        }
      },
    }
  }
}

function createMainProviderAccountStarter({
  started,
  stopped,
  failAccountId,
  startupCleanupConfirmed = true,
}) {
  return async (input) => {
    started.push({
      identity: input.providerIdentity,
      tradingMode: input.env.TRADING_MODE,
      operatorControlEnabled: input.appConfig.operatorControl.telegram.enabled,
      providerRequired: input.providerRequired,
      marketDataProviderInstanceId: input.marketDataProviderInstanceId,
      marketDataSymbols: input.marketDataSymbols,
      executionRoutes: input.executionRoutes,
    })
    if (input.providerIdentity.accountId === failAccountId) {
      const error = new Error("secondary account connection failed")
      if (startupCleanupConfirmed) {
        error.startupCleanupConfirmed = true
      }
      throw error
    }
    return {
      account: input.providerIdentity,
      brokerName: input.providerIdentity.providerType,
      connected: true,
      tradingEnabled: true,
      strategyMode: "conservative",
      subscriptions: ["BTCUSDT"],
      executionSymbols: input.executionSymbols,
      marketDataSources: input.marketDataSources,
      marketDataProviderTypes: input.marketDataProviderTypes,
      marketDataProviderIdentities: input.marketDataProviderIdentities,
      marketDataProviderInstanceId: input.marketDataProviderInstanceId,
      marketDataSymbols: input.marketDataSymbols,
      startMarketData: async () => ({ ok: true }),
      stopMarketData: async () => ({ ok: true }),
      stop: async () => {
        stopped.push(input.providerIdentity.providerInstanceId)
        return {
          ok: true,
          status: "STOPPED",
          data: { durableProcessStopAcknowledged: true },
        }
      },
    }
  }
}

function resolveMarketDataSourceProvider({
  pair,
  providerInstances,
}) {
  return providerInstances.find(({ environment }) =>
    pair.tradingEnvironment === "both" || pair.tradingEnvironment === environment)
}

function resolveConfiguredRecoverySellerRoutes(providerInstances) {
  const configuredRecoverySellerPairs = {}
  const recoverySellerRoutes = []
  for (const [symbol, pair] of Object.entries(defaultAppConfig.strategies.RS_recoverySeller.pairs)) {
    const sourceProvider = resolveMarketDataSourceProvider({
      pair,
      providerInstances,
    })
    configuredRecoverySellerPairs[symbol] = sourceProvider ? pair : {
      ...pair,
      enabled: false,
    }
    if (pair.enabled && sourceProvider) {
      recoverySellerRoutes.push({
        symbol,
        providerInstanceId: sourceProvider.providerInstanceId,
      })
    }
  }
  return {
    configuredRecoverySellerPairs,
    recoverySellerRoutes,
  }
}

function assertRecoverySellerProviderRouting({ started }) {
  assert.equal(started[0].marketDataSymbols.includes("LINEAUSDT"), true,
    "The TESTNET provider must receive the enabled RS-only LINEAUSDT market-data subscription.")
  assert.equal(started[1].marketDataSymbols.includes("LINEAUSDT"), false,
    "The LIVE provider must never receive the TESTNET-only LINEAUSDT market-data subscription.")
  assert.deepEqual(started[0].executionRoutes.filter(({ strategyId }) => strategyId === "RS_recoverySeller"), [
    {
      strategyId: "RS_recoverySeller",
      symbol: "LINEAUSDT",
    },
    {
      strategyId: "RS_recoverySeller",
      symbol: "ARBUSDT",
    },
  ], "The TESTNET account must receive all explicitly routed TESTNET RS execution routes.")
  assert.deepEqual(started[1].executionRoutes.filter(({ strategyId }) => strategyId === "RS_recoverySeller"), [],
    "The LIVE account must not receive an RS route for TESTNET-only LINEAUSDT.")
}

function createMarketDataTestConfiguration(providerInstances) {
  const configuredPairs = Object.fromEntries(
    Object.entries(defaultAppConfig.strategies.CG_coinGrabber.pairs).map(([symbol, pair]) => {
      const sourceProvider = resolveMarketDataSourceProvider({
        pair,
        providerInstances,
      })
      return [symbol, sourceProvider ? pair : {
        ...pair,
        enabled: false,
      }]
    }),
  )
  const routes = Object.entries(configuredPairs)
    .filter(([, pair]) => pair.enabled)
    .map(([symbol, pair]) => {
      const sourceProvider = resolveMarketDataSourceProvider({
        pair,
        providerInstances,
      })
      return {
        symbol,
        providerInstanceId: sourceProvider.providerInstanceId,
      }
    })
  const {
    configuredRecoverySellerPairs,
    recoverySellerRoutes,
  } = resolveConfiguredRecoverySellerRoutes(providerInstances)
  const executionRoutes = [
    ...routes.map(({ symbol, providerInstanceId }) => ({
      strategyId: "CG_coinGrabber",
      symbol,
      providerInstanceId,
    })),
    ...recoverySellerRoutes.map(({ symbol, providerInstanceId }) => ({
      strategyId: "RS_recoverySeller",
      symbol,
      providerInstanceId,
    })),
  ]
  return {
    configuredPairs,
    configuredRecoverySellerPairs,
    routes: [...routes, ...recoverySellerRoutes],
    executionRoutes,
  }
}

function createMainMultiProviderAppConfig(providerInstances) {
  const { configuredPairs, configuredRecoverySellerPairs, routes, executionRoutes } = createMarketDataTestConfiguration(providerInstances)
  return {
    ...defaultAppConfig,
    operatorControl: {
      telegram: {
        enabled: true,
        allowedUserIds: ["12345"],
      },
    },
    strategies: {
      ...defaultAppConfig.strategies,
      CG_coinGrabber: {
        ...defaultAppConfig.strategies.CG_coinGrabber,
        pairs: configuredPairs,
      },
      RS_recoverySeller: {
        ...defaultAppConfig.strategies.RS_recoverySeller,
        pairs: configuredRecoverySellerPairs,
      },
    },
    marketDataRouting: {
      routes,
    },
    executionRouting: {
      routes: executionRoutes,
    },
    brokers: {
      instances: providerInstances,
    },
  }
}

function assignSecondaryExecutionRoute({ config, secondaryProvider }) {
  const secondaryRoute = Object.entries(config.strategies.CG_coinGrabber.pairs).find(
    ([, pair]) => pair.tradingEnvironment === secondaryProvider.environment ||
      pair.tradingEnvironment === "both"
  )
  if (!secondaryRoute) {
    return
  }
  const [secondarySymbol] = secondaryRoute
  config.executionRouting.routes = config.executionRouting.routes.map((route) =>
    route.symbol === secondarySymbol
      ? {
        ...route,
        providerInstanceId: secondaryProvider.providerInstanceId,
      }
      : route
  )
}

function createMainMultiProviderFixture({
  providerInstances,
  env,
  failAccountId,
  startupCleanupConfirmed = true,
  providerAdapterFactories = {},
}) {
  const started = []
  const stopped = []
  const lockScopes = []
  const releasedLocks = []
  const signalHandlers = new Map()
  const errors = []
  const config = createMainMultiProviderAppConfig(providerInstances)
  if (providerInstances.length > 1) {
    assignSecondaryExecutionRoute({
      config,
      secondaryProvider: providerInstances[1],
    })
  }
  const run = () => main({
    loadConfig: async () => config,
    env,
    providerAdapterFactories,
    acquireProcessLock: createMainProcessLockAcquirer({
      lockScopes,
      releasedLocks,
    }),
    start: createMainProviderAccountStarter({
      started,
      stopped,
      failAccountId,
      startupCleanupConfirmed,
    }),
    registerSignalHandler: (...args) => signalHandlers.set(...args),
    logger: {
      info() {},
      system() {},
      error(entry) {
        errors.push(entry)
      },
    },
  })
  return {
    run,
    started,
    stopped,
    lockScopes,
    releasedLocks,
    signalHandlers,
    errors,
  }
}

function createMultiProviderInstances() {
  return [
    {
      providerInstanceId: "binanceTestnetPrimary",
      providerType: "binance",
      accountId: "binance-primary",
      environment: "testnet",
      credentials: {
        apiKeyEnv: "BINANCE_API_KEY",
        apiSecretEnv: "BINANCE_API_SECRET_KEY",
      },
    },
    {
      providerInstanceId: "testProviderLiveSecondary",
      providerType: "test-exchange",
      accountId: "test-provider-secondary",
      environment: "live",
      credentials: {
        apiKeyEnv: "TEST_PROVIDER_API_KEY",
        apiSecretEnv: "TEST_PROVIDER_API_SECRET",
      },
    },
  ]
}

function createTwoBinanceAccountInstances() {
  return [
    {
      providerInstanceId: "binanceTestnetPrimary",
      providerType: "binance",
      accountId: "binance-primary",
      environment: "testnet",
      credentials: {
        apiKeyEnv: "BINANCE_API_KEY",
        apiSecretEnv: "BINANCE_API_SECRET_KEY",
      },
    },
    {
      providerInstanceId: "binanceTestnetSecondary",
      providerType: "binance",
      accountId: "binance-secondary",
      environment: "testnet",
      required: false,
      credentials: {
        apiKeyEnv: "BINANCE_SECONDARY_API_KEY",
        apiSecretEnv: "BINANCE_SECONDARY_API_SECRET",
      },
    },
  ]
}

test("starts configured provider accounts and acquires one process lock per account", async () => {
  const fixture = createMainMultiProviderFixture({
    providerInstances: createMultiProviderInstances(),
    env: {
      TRADING_MODE: "testnet",
      BINANCE_API_KEY: "binance-key",
      BINANCE_API_SECRET_KEY: "binance-secret",
      TEST_PROVIDER_API_KEY: "test-provider-key",
      TEST_PROVIDER_API_SECRET: "test-provider-secret",
    },
    providerAdapterFactories: {
      "test-exchange": () => ({}),
    },
  })
  const previousExitCode = process.exitCode
  process.exitCode = 0
  try {
    const result = await fixture.run()
    assert.ok(result, `The configured account startup must return a runtime result: ${fixture.errors.map(({ errorMessage, error }) => errorMessage ?? error?.message ?? "unknown").join("; ")}`)
    assert.equal(result.runtime.providerAccounts.length, 2, "Both configured provider accounts must start in independent runtimes")
    assert.deepEqual(fixture.started.map(({ identity }) => identity.providerInstanceId), [
      "binanceTestnetPrimary",
      "testProviderLiveSecondary",
    ], "Each account must start with its explicitly configured provider identity")
    assert.deepEqual(fixture.started.map(({ tradingMode }) => tradingMode), [
      "testnet",
      "live",
    ], "Each account must retain its own explicit exchange environment")
    assert.deepEqual(fixture.started.map(({ marketDataProviderInstanceId }) => marketDataProviderInstanceId), [
      "binanceTestnetPrimary",
      "testProviderLiveSecondary",
    ], "Each runtime must expose its configured market-data source instance")
    assert.equal(fixture.started[0].marketDataSymbols.includes("DOGEUSDT"), true)
    assert.equal(fixture.started[1].marketDataSymbols.includes("LINKFDUSD"), true)
    assertRecoverySellerProviderRouting({
      started: fixture.started,
    })
    assert.deepEqual(fixture.started.map(({ operatorControlEnabled }) => operatorControlEnabled), [
      true,
      false,
    ], "Only the first configured account may own process-wide Telegram operator control")
    assert.deepEqual(fixture.lockScopes.map(({ accountId, tradingMode }) => [accountId, tradingMode]), [
      ["binance-primary", "testnet"],
      ["test-provider-secondary", "live"],
    ], "Each configured account must acquire a process lock scoped to its own account and environment")
    await fixture.signalHandlers.get("SIGINT")()
    assert.deepEqual(fixture.stopped, [
      "testProviderLiveSecondary",
      "binanceTestnetPrimary",
    ], "Shutdown must stop each successfully started account runtime independently")
    assert.deepEqual(fixture.releasedLocks, [
      "testProviderLiveSecondary",
      "binanceTestnetPrimary",
    ], "Shutdown must release every successfully acquired account process lock")
    assert.equal(process.exitCode, 0, "A clean multi-account shutdown must preserve a successful process exit code")
  } finally {
    process.exitCode = previousExitCode
  }
})

test("retains an account process lock when startup cleanup is unconfirmed", async () => {
  const fixture = createMainMultiProviderFixture({
    providerInstances: createTwoBinanceAccountInstances(),
    env: {
      TRADING_MODE: "testnet",
      BINANCE_API_KEY: "primary-key",
      BINANCE_API_SECRET_KEY: "primary-secret",
      BINANCE_SECONDARY_API_KEY: "secondary-key",
      BINANCE_SECONDARY_API_SECRET: "secondary-secret",
    },
    failAccountId: "binance-secondary",
    startupCleanupConfirmed: false,
  })
  const previousExitCode = process.exitCode
  process.exitCode = 0
  try {
    const result = await fixture.run()
    assert.ok(result, `The account startup result must remain available after isolating a startup failure: ${fixture.errors.map(({ errorMessage, error }) => errorMessage ?? error?.message ?? "unknown").join("; ")}`)
    assert.equal(result.runtime.failedAccounts[0].lockRetained, true, "An account lock must remain held when startup cleanup is unconfirmed")
    assert.deepEqual(fixture.releasedLocks, [], "No account lock may be released before uncertain startup cleanup is confirmed")
    await fixture.signalHandlers.get("SIGINT")()
    assert.deepEqual(fixture.stopped, ["binanceTestnetPrimary"], "Shutdown must stop the healthy account without stopping the failed account")
    assert.deepEqual(fixture.releasedLocks, [
      "binanceTestnetSecondary",
      "binanceTestnetPrimary",
    ], "Confirmed process shutdown must release all account locks in reverse acquisition order after cleanup")
    assert.equal(process.exitCode, 0, "A clean shutdown after an isolated startup failure must exit successfully")
  } finally {
    process.exitCode = previousExitCode
  }
})

test("keeps healthy accounts running and releases only a failed account's process lock", async () => {
  const fixture = createMainMultiProviderFixture({
    providerInstances: createTwoBinanceAccountInstances(),
    env: {
      TRADING_MODE: "testnet",
      BINANCE_API_KEY: "primary-key",
      BINANCE_API_SECRET_KEY: "primary-secret",
      BINANCE_SECONDARY_API_KEY: "secondary-key",
      BINANCE_SECONDARY_API_SECRET: "secondary-secret",
    },
    failAccountId: "binance-secondary",
  })
  const previousExitCode = process.exitCode
  process.exitCode = 0
  try {
    const result = await fixture.run()
    assert.ok(result, `Expected isolated account startup to return a runtime: ${fixture.errors.map(({ errorMessage, error }) => errorMessage ?? error?.message ?? "unknown").join("; ")}`)
    assert.deepEqual(fixture.started.map(({ identity }) => identity.providerInstanceId), [
      "binanceTestnetPrimary",
      "binanceTestnetSecondary",
    ], "The failed secondary account must not prevent either account startup attempt")
    assert.deepEqual(result.runtime.providerAccounts.map(({ providerInstanceId }) => providerInstanceId), [
      "binanceTestnetPrimary",
    ], "Only the healthy account may appear in the active runtime list")
    assert.equal(result.runtime.failedAccounts.length, 1, "Exactly one failed account must be reported when the secondary startup fails")
    assert.equal(result.runtime.failedAccounts[0].providerInstanceId, "binanceTestnetSecondary", "The failed-account report must identify the secondary provider instance")
    assert.deepEqual(fixture.releasedLocks, ["binanceTestnetSecondary"], "Confirmed cleanup must release only the failed account lock while the healthy account remains active")
    await fixture.signalHandlers.get("SIGINT")()
    assert.deepEqual(fixture.stopped, ["binanceTestnetPrimary"], "Shutdown must stop the healthy account runtime and leave the failed account untouched")
    assert.deepEqual(fixture.releasedLocks, [
      "binanceTestnetSecondary",
      "binanceTestnetPrimary",
    ], "Final shutdown must release the healthy account lock after the failed account lock was already released")
    assert.equal(process.exitCode, 0, "The process must exit successfully after isolating one failed account")
  } finally {
    process.exitCode = previousExitCode
  }
})
