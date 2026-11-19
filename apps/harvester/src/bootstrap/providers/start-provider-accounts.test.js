import assert from "node:assert/strict"
import test from "node:test"
import { startProviderAccounts } from "./start-provider-accounts.js"

function createProvider({
  providerInstanceId,
  providerType,
  accountId,
  environment = "testnet",
  credentialEnvironmentNames = {},
  required = true,
}) {
  return {
    providerInstanceId,
    providerType,
    accountId,
    environment,
    required,
    credentialEnvironmentNames,
    identity: {
      providerInstanceId,
      providerType,
      accountId,
    },
    brokerAdapterFactory: () => ({}),
  }
}

const appConfig = {
  marketDataRouting: {
    routes: [
      { symbol: "BTCUSDT",
  providerInstanceId: "first" },
      { symbol: "ETHUSDT",
  providerInstanceId: "second" },
      { symbol: "SOLUSDT",
  providerInstanceId: "third" },
    ],
  },
  executionRouting: {
    routes: [
      { strategyId: "CG_coinGrabber",
  symbol: "BTCUSDT",
  providerInstanceId: "first" },
      { strategyId: "CG_coinGrabber",
  symbol: "ETHUSDT",
  providerInstanceId: "second" },
      { strategyId: "CG_coinGrabber",
  symbol: "SOLUSDT",
  providerInstanceId: "third" },
    ],
  },
  operatorControl: {
    telegram: {
      enabled: true,
      allowedUserIds: ["12345"],
    },
  },
  strategies: {
    CG_coinGrabber: {
      pairs: {
        BTCUSDT: { enabled: true },
        ETHUSDT: { enabled: true },
        SOLUSDT: { enabled: true },
      },
    },
  },
}

function appConfigForMarketDataProvider(providerInstanceId) {
  return {
    ...appConfig,
    marketDataRouting: {
      routes: [
        { symbol: "BTCUSDT",
  providerInstanceId },
        { symbol: "ETHUSDT",
  providerInstanceId: "binance-two" },
        { symbol: "SOLUSDT",
  providerInstanceId: "other-live" },
      ],
    },
    executionRouting: {
      routes: [
        { strategyId: "CG_coinGrabber",
  symbol: "BTCUSDT",
  providerInstanceId: "binance-one" },
        { strategyId: "CG_coinGrabber",
  symbol: "ETHUSDT",
  providerInstanceId: "binance-two" },
        { strategyId: "CG_coinGrabber",
  symbol: "SOLUSDT",
  providerInstanceId: "other-live" },
      ],
    },
  }
}

function appConfigForProviderSubset(providers) {
  const symbolsByProvider = {
    first: "BTCUSDT",
    second: "ETHUSDT",
    third: "SOLUSDT",
  }
  const routes = providers.map((provider) => ({
    strategyId: "CG_coinGrabber",
    symbol: symbolsByProvider[provider.providerInstanceId],
    providerInstanceId: provider.providerInstanceId,
  }))
  const pairs = Object.fromEntries(routes.map(({ symbol }) => [symbol, { enabled: true }]))
  return {
    ...appConfig,
    marketDataRouting: {
      routes: routes.map(({ symbol,
  providerInstanceId }) => ({
        symbol,
        providerInstanceId,
      })),
    },
    executionRouting: {
      routes,
    },
    strategies: {
      ...appConfig.strategies,
      CG_coinGrabber: {
        ...appConfig.strategies.CG_coinGrabber,
        pairs,
      },
    },
  }
}

function createCredentialedProviderFixtures() {
  return [
    createProvider({
      providerInstanceId: "binance-one",
      providerType: "binance",
      accountId: "account-one",
      credentialEnvironmentNames: {
        apiKeyEnv: "PRIMARY_KEY",
        apiSecretEnv: "PRIMARY_SECRET",
      },
    }),
    createProvider({
      providerInstanceId: "binance-two",
      providerType: "binance",
      accountId: "account-two",
      credentialEnvironmentNames: {
        apiKeyEnv: "SECONDARY_KEY",
        apiSecretEnv: "SECONDARY_SECRET",
      },
    }),
    createProvider({
      providerInstanceId: "other-live",
      providerType: "other",
      accountId: "account-three",
      environment: "live",
      credentialEnvironmentNames: {
        apiKeyEnv: "OTHER_KEY",
        apiSecretEnv: "OTHER_SECRET",
      },
    }),
  ]
}

function createAccountRuntimeFixtures({
  providers,
  starts,
}) {
  return providers.map((provider) => ({
    account: provider.identity,
    brokerName: provider.providerType,
    connected: true,
    tradingEnabled: true,
    strategyMode: "conservative",
    subscriptions: [],
    startMarketData: async () => ({ ok: true }),
    stopMarketData: async () => ({ ok: true }),
    stop: async () => {
      starts.push(`stop:${provider.providerInstanceId}`)
      return {
        ok: true,
      }
    },
  }))
}

function createAccountRuntimeStarter({
  starts,
  runtimes,
}) {
  let runtimeIndex = 0
  return async (input) => {
    starts.push({
      identity: input.providerIdentity,
      tradingMode: input.env.TRADING_MODE,
      operatorControlEnabled: input.appConfig.operatorControl.telegram.enabled,
      hasOperationalStateStore: input.operationalStateStore !== undefined,
      executionSymbols: input.executionSymbols,
      executionRoutes: input.executionRoutes,
      marketDataSymbols: input.marketDataSymbols,
      marketDataSources: input.marketDataSources,
      marketDataProviderTypes: input.marketDataProviderTypes,
      providerRequired: input.providerRequired,
      credentialValues: [
        input.env.PRIMARY_KEY,
        input.env.SECONDARY_KEY,
        input.env.OTHER_KEY,
      ],
    })
    const runtime = runtimes[runtimeIndex]
    runtimeIndex += 1
    return {
      ...runtime,
      executionSymbols: [...input.executionSymbols],
      executionRoutes: [...(input.executionRoutes ?? [])],
      marketDataSources: input.marketDataSources,
      marketDataProviderTypes: input.marketDataProviderTypes,
      subscriptions: [...input.executionSymbols],
      tradingEnabled: input.executionSymbols.length > 0,
    }
  }
}

function assertAccountStartupInputs({
  starts,
}) {
  const inputs = starts.filter((entry) => typeof entry === "object")
  assert.deepEqual(inputs.map((entry) => entry.tradingMode), [
    "testnet",
    "testnet",
    "live",
  ])
  assert.deepEqual(inputs.map((entry) => entry.operatorControlEnabled), [
    true,
    false,
    false,
  ])
  assert.deepEqual(inputs.map((entry) => entry.hasOperationalStateStore), [
    true,
    false,
    false,
  ])
  assert.deepEqual(inputs.map((entry) => entry.executionSymbols), [
    ["BTCUSDT"],
    ["ETHUSDT"],
    ["SOLUSDT"],
  ])
  assert.deepEqual(inputs.map((entry) => entry.executionRoutes), [
    [{
      strategyId: "CG_coinGrabber",
      symbol: "BTCUSDT",
    }],
    [{
      strategyId: "CG_coinGrabber",
      symbol: "ETHUSDT",
    }],
    [{
      strategyId: "CG_coinGrabber",
      symbol: "SOLUSDT",
    }],
  ], "Provider startup must retain strategy ownership instead of receiving only deduplicated market symbols")
  assert.deepEqual(inputs.map((entry) => entry.marketDataSymbols), [
    ["BTCUSDT"],
    ["ETHUSDT"],
    ["SOLUSDT"],
  ])
  assert.deepEqual(inputs.map((entry) => entry.marketDataSources), [
    { BTCUSDT: "binance-one" },
    { ETHUSDT: "binance-two" },
    { SOLUSDT: "other-live" },
  ])
  assert.deepEqual(inputs.map((entry) => entry.marketDataProviderTypes), [
    { BTCUSDT: "binance" },
    { ETHUSDT: "binance" },
    { SOLUSDT: "other" },
  ])
  assert.deepEqual(inputs.map((entry) => entry.providerRequired), [true, true, true])
  assert.deepEqual(inputs.map((entry) => entry.credentialValues), [
    ["primary-key", undefined, undefined],
    [undefined, "secondary-key", undefined],
    [undefined, undefined, "other-key"],
  ])
}

function createShutdownTrackingProviderStarter(shutdownOrder) {
  return async (input) => {
    const { providerInstanceId } = input.providerIdentity
    return {
      executionSymbols: [...input.executionSymbols],
      executionRoutes: [...(input.executionRoutes ?? [])],
      marketDataSources: input.marketDataSources,
      marketDataProviderTypes: input.marketDataProviderTypes,
      tradingEnabled: true,
      startMarketData: async () => ({ ok: true }),
      stop: async () => {
        shutdownOrder.push(`runtime:${providerInstanceId}`)
        return { ok: true }
      },
      stopMarketData: async () => {
        shutdownOrder.push(`market-data:${providerInstanceId}`)
        return { ok: true }
      },
    }
  }
}

function createStopTrackingProviderStarter({ stopCalls, firstStopAttempts }) {
  return async (input) => ({
    startMarketData: async () => ({ ok: true }),
    stopMarketData: async () => ({ ok: true }),
    stop: async () => {
      const { providerInstanceId } = input.providerIdentity
      stopCalls.push(providerInstanceId)
      if (providerInstanceId === "first") {
        firstStopAttempts.value += 1
        if (firstStopAttempts.value === 1) {
          return {
            ok: false,
            errors: [new Error("first account still stopping")],
          }
        }
      }
      return { ok: true }
    },
  })
}

test("stops market-data intake only after each account runtime completes shutdown", async () => {
  const providers = [
    createProvider({
      providerInstanceId: "first",
      providerType: "binance",
      accountId: "account-one",
    }),
    createProvider({
      providerInstanceId: "second",
      providerType: "binance",
      accountId: "account-two",
    }),
  ]
  const shutdownOrder = []
  const runtime = await startProviderAccounts({
    providers,
    appConfig: appConfigForProviderSubset(providers),
    env: { TRADING_MODE: "testnet" },
    start: createShutdownTrackingProviderStarter(shutdownOrder),
  })

  const result = await runtime.stop()

  assert.equal(result.ok, true)
  assert.deepEqual(shutdownOrder, [
    "runtime:second",
    "market-data:second",
    "runtime:first",
    "market-data:first",
  ], "Market-data intake must remain active until each account's strategy shutdown has completed safely.")
})


test("starts one independent runtime per configured provider account", async () => {
  const providers = createCredentialedProviderFixtures()
  const starts = []
  const runtimes = createAccountRuntimeFixtures({
    providers,
    starts,
  })
  const runtime = await startProviderAccounts({
    providers,
    start: createAccountRuntimeStarter({
      starts,
      runtimes,
    }),
    appConfig: appConfigForMarketDataProvider(providers[0].providerInstanceId),
    env: {
      TRADING_MODE: "testnet",
      PRIMARY_KEY: "primary-key",
      PRIMARY_SECRET: "primary-secret",
      SECONDARY_KEY: "secondary-key",
      SECONDARY_SECRET: "secondary-secret",
      OTHER_KEY: "other-key",
      OTHER_SECRET: "other-secret",
    },
    eventPublisher: {},
    runtimeSessionId: "session",
    operationalStateStore: {
      append() {},
    },
  })

  assert.equal(starts.filter((entry) => typeof entry === "object").length, 3)
  assertAccountStartupInputs({
    starts,
  })
  assert.deepEqual(runtime.providerAccounts.map((account) => account.executionRoutes), [
    [{
      strategyId: "CG_coinGrabber",
      symbol: "BTCUSDT",
    }],
    [{
      strategyId: "CG_coinGrabber",
      symbol: "ETHUSDT",
    }],
    [{
      strategyId: "CG_coinGrabber",
      symbol: "SOLUSDT",
    }],
  ], "Multi-account runtime metadata must retain each provider's strategy ownership")

  assert.equal(runtime.providerAccounts.length, 3)
  assert.deepEqual(runtime.subscriptions, ["BTCUSDT", "ETHUSDT", "SOLUSDT"])
  assert.equal(runtime.connected, true)
  assert.equal((await runtime.stop()).ok, true)
  assert.deepEqual(starts.slice(-3), [
    "stop:other-live",
    "stop:binance-two",
    "stop:binance-one",
  ])
})

function createThreeAccountProviders() {
  return [
    createProvider({
      providerInstanceId: "first",
      providerType: "binance",
      accountId: "account-one",
    }),
    createProvider({
      providerInstanceId: "second",
      providerType: "binance",
      accountId: "account-two",
      required: false,
    }),
    createProvider({
      providerInstanceId: "third",
      providerType: "binance",
      accountId: "account-three",
    }),
  ]
}

function createSecondAccountFailureStarter({
  stopCalls,
}) {
  let startCount = 0
  return async (input) => {
    startCount += 1
    if (startCount === 2) {
      const error = new Error("second account connection failed")
      error.startupCleanupConfirmed = true
      throw error
    }
    const account = startCount === 1 ? "first" : "third"
    return {
      executionSymbols: [...input.executionSymbols],
      executionRoutes: [...(input.executionRoutes ?? [])],
      marketDataSources: input.marketDataSources,
      marketDataProviderTypes: input.marketDataProviderTypes,
      subscriptions: [...input.executionSymbols],
      tradingEnabled: input.executionSymbols.length > 0,
      startMarketData: async () => ({ ok: true }),
      stopMarketData: async () => ({ ok: true }),
      stop: async () => {
        stopCalls.push(account)
        return {
          ok: true,
        }
      },
    }
  }
}

function createSuccessfulLockReleaser({
  releasedLocks,
}) {
  return async (providerInstanceId) => {
    releasedLocks.push(providerInstanceId)
    return {
      ok: true,
      released: true,
    }
  }
}

test("transfers process-wide ownership to the first successfully started optional account", async () => {
  const providers = createThreeAccountProviders()
  providers[0].required = false
  const operationalStateStore = {}
  const starts = []
  const runtime = await startProviderAccounts({
    providers,
    appConfig: appConfigForProviderSubset(providers),
    env: { TRADING_MODE: "testnet" },
    operationalStateStore,
    releaseProviderLock: async () => ({ ok: true }),
    start: async (input) => {
      const { providerInstanceId } = input.providerIdentity
      starts.push({
        providerInstanceId,
        operatorControlEnabled: input.appConfig.operatorControl.telegram.enabled,
        hasOperationalStateStore: input.operationalStateStore === operationalStateStore,
      })
      if (providerInstanceId === "first") {
        const error = new Error("optional primary account failed")
        error.startupCleanupConfirmed = true
        throw error
      }
      return {
        executionSymbols: [...input.executionSymbols],
        marketDataSources: input.marketDataSources,
        marketDataProviderTypes: input.marketDataProviderTypes,
        tradingEnabled: true,
        startMarketData: async () => ({ ok: true }),
        stopMarketData: async () => ({ ok: true }),
        stop: async () => ({ ok: true }),
      }
    },
  })

  assert.deepEqual(starts, [
    {
      providerInstanceId: "first",
      operatorControlEnabled: true,
      hasOperationalStateStore: true,
    },
    {
      providerInstanceId: "second",
      operatorControlEnabled: true,
      hasOperationalStateStore: true,
    },
    {
      providerInstanceId: "third",
      operatorControlEnabled: false,
      hasOperationalStateStore: false,
    },
  ])
  assert.equal(runtime.account.providerInstanceId, "second")
  assert.equal(runtime.failedAccounts[0].providerInstanceId, "first")
})

test("keeps healthy account runtimes running when another account fails to start", async () => {
  const stopCalls = []
  const releasedLocks = []
  const runtime = await startProviderAccounts({
    providers: createThreeAccountProviders(),
    start: createSecondAccountFailureStarter({
      stopCalls,
    }),
    releaseProviderLock: createSuccessfulLockReleaser({
      releasedLocks,
    }),
    appConfig,
    env: {
      TRADING_MODE: "testnet",
    },
  })

  assert.deepEqual(runtime.providerAccounts.map(({ providerInstanceId }) => providerInstanceId), [
    "first",
    "third",
  ])
  assert.equal(runtime.failedAccounts.length, 1)
  assert.equal(runtime.failedAccounts[0].providerInstanceId, "second")
  assert.match(runtime.failedAccounts[0].errorMessage, /second account connection failed/)
  assert.deepEqual(releasedLocks, ["second"])
  assert.deepEqual(stopCalls, [])
  assert.equal((await runtime.stop()).ok, true)
  assert.deepEqual(stopCalls, ["third", "first"])
})

function createFailedSecondAccountStarter({ startupError, stopped }) {
  let startCount = 0
  return async () => {
    startCount += 1
    if (startCount === 2) {
      throw startupError
    }
    const account = startCount === 1 ? "first" : "third"
    return {
      startMarketData: async () => ({ ok: true }),
      stopMarketData: async () => ({ ok: true }),
      stop: async () => {
        stopped.push(account)
        return { ok: true }
      },
    }
  }
}

function createFailedAccountLockReleaser({ cleanupError }) {
  return async (providerInstanceId) => providerInstanceId === "second"
    ? {
      ok: false,
      errors: [cleanupError],
    }
    : {
      ok: true,
    }
}

test("reports failed-account lock cleanup errors without stopping healthy accounts", async () => {
  const startupError = new Error("second account failed")
  startupError.startupCleanupConfirmed = true
  const cleanupError = new Error("second account lock cleanup failed")
  const stopped = []
  const runtime = await startProviderAccounts({
    providers: [
      createProvider({
        providerInstanceId: "first",
        providerType: "binance",
        accountId: "account-one",
      }),
      createProvider({
        providerInstanceId: "second",
        providerType: "binance",
        accountId: "account-two",
        required: false,
      }),
      createProvider({
        providerInstanceId: "third",
        providerType: "binance",
        accountId: "account-three",
      }),
    ],
    start: createFailedSecondAccountStarter({
      startupError,
      stopped,
    }),
    releaseProviderLock: createFailedAccountLockReleaser({
      cleanupError,
    }),
    appConfig,
    env: { TRADING_MODE: "testnet" },
  })

  assert.equal(runtime.failedAccounts.length, 1)
  assert.equal(runtime.failedAccounts[0].errorMessage, startupError.message)
  assert.equal(runtime.failedAccounts[0].cleanupErrors[0].message, cleanupError.message)
  assert.deepEqual(stopped, [])
  assert.equal((await runtime.stop()).ok, true)
  assert.deepEqual(stopped, ["third", "first"])
})


test("retains a failed account lock when startup cleanup is not confirmed", async () => {
  const retainedLocks = []
  const releasedLocks = []
  const runtime = await startProviderAccounts({
    providers: [
      createProvider({
        providerInstanceId: "first",
        providerType: "binance",
        accountId: "account-one",
      }),
      createProvider({
        providerInstanceId: "second",
        providerType: "binance",
        accountId: "account-two",
        required: false,
      }),
    ],
    start: async (input) => {
      const { providerInstanceId } = input.providerIdentity
      if (providerInstanceId === "second") {
        throw new Error("second account cleanup is uncertain")
      }
      return {
        startMarketData: async () => ({ ok: true }),
        stopMarketData: async () => ({ ok: true }),
        stop: async () => ({
          ok: true,
        }),
      }
    },
    retainProviderLock: async (providerInstanceId) => {
      retainedLocks.push(providerInstanceId)
      return {
        ok: true,
        retained: true,
      }
    },
    releaseProviderLock: createSuccessfulLockReleaser({
      releasedLocks,
    }),
    appConfig: appConfigForProviderSubset([
      createProvider({ providerInstanceId: "first",
  providerType: "binance",
  accountId: "account-one" }),
      createProvider({ providerInstanceId: "second",
  providerType: "binance",
  accountId: "account-two",
  required: false }),
    ]),
    env: {
      TRADING_MODE: "testnet",
    },
  })

  assert.equal(runtime.failedAccounts[0].lockRetained, true)
  assert.deepEqual(retainedLocks, ["second"])
  assert.deepEqual(releasedLocks, [])
  assert.equal((await runtime.stop()).ok, true)
  assert.deepEqual(releasedLocks, ["first"])
})

test("isolates an optional provider market-data startup failure", async () => {
  const providers = createThreeAccountProviders()
  providers[0].required = false
  const calls = []
  const runtime = await startProviderAccounts({
    providers,
    appConfig: appConfigForProviderSubset(providers),
    env: { TRADING_MODE: "testnet" },
    start: async (input) => {
      const { providerInstanceId } = input.providerIdentity
      return {
        executionSymbols: [...input.executionSymbols],
        marketDataSources: input.marketDataSources,
        marketDataProviderTypes: input.marketDataProviderTypes,
        tradingEnabled: true,
        startMarketData: async () => {
          calls.push(`start-market-data:${providerInstanceId}`)
          if (providerInstanceId === "first") {
            throw new Error("optional market-data subscription failed")
          }
          return { ok: true }
        },
        stopMarketData: async () => {
          calls.push(`stop-market-data:${providerInstanceId}`)
          return { ok: true }
        },
        stop: async () => {
          calls.push(`stop-runtime:${providerInstanceId}`)
          return { ok: true }
        },
      }
    },
  })

  assert.deepEqual(calls, [
    "start-market-data:first",
    "stop-market-data:first",
    "start-market-data:second",
    "start-market-data:third",
  ])
  assert.equal(runtime.tradingEnabled, true)
  assert.deepEqual(runtime.providerAccounts.map(({ executionEnabled }) => executionEnabled), [
    false,
    true,
    true,
  ])
  assert.equal(runtime.failedAccounts[0].providerInstanceId, "first")
})

test("fails startup when no configured account can start", async () => {
  await assert.rejects(
    startProviderAccounts({
      providers: [
        createProvider({
          providerInstanceId: "first",
          providerType: "binance",
          accountId: "account-one",
        }),
      ],
      start: async () => {
        throw new Error("account unavailable")
      },
      releaseProviderLock: async () => ({
        ok: true,
      }),
      appConfig: appConfigForProviderSubset([
        createProvider({ providerInstanceId: "first",
  providerType: "binance",
  accountId: "account-one" }),
      ]),
      env: {
        TRADING_MODE: "testnet",
      },
    }),
    /account unavailable/,
  )
})


test("releases only accounts whose runtime shutdown is confirmed", async () => {
  const providers = [
    createProvider({
      providerInstanceId: "first",
      providerType: "binance",
      accountId: "account-one",
    }),
    createProvider({
      providerInstanceId: "second",
      providerType: "binance",
      accountId: "account-two",
      required: false,
    }),
  ]
  const stopCalls = []
  const releasedLocks = []
  const firstStopAttempts = { value: 0 }
  const runtime = await startProviderAccounts({
    providers,
    start: createStopTrackingProviderStarter({
      stopCalls,
      firstStopAttempts,
    }),
    releaseProviderLock: async (providerInstanceId) => {
      releasedLocks.push(providerInstanceId)
      return { ok: true }
    },
    appConfig: appConfigForProviderSubset(providers),
    env: { TRADING_MODE: "testnet" },
  })

  const firstStop = await runtime.stop()
  assert.equal(firstStop.ok, false)
  assert.deepEqual(releasedLocks, ["second"])
  const secondStop = await runtime.stop()
  assert.equal(secondStop.ok, true)
  assert.deepEqual(stopCalls, ["second", "first", "first"])
  assert.deepEqual(releasedLocks, ["second", "first"])
})

test("rejects multi-provider startup without explicit market-data ownership before starting accounts", async () => {
  let startCalls = 0
  await assert.rejects(
    startProviderAccounts({
      providers: createThreeAccountProviders(),
      start: async () => {
        startCalls += 1
        return { stop: async () => ({ ok: true }) }
      },
      appConfig: {
        ...appConfig,
        marketDataRouting: undefined,
      },
      env: { TRADING_MODE: "testnet" },
    }),
    /requires explicit marketDataRouting\.routes/,
    "multi-provider startup must fail before connecting any account when market ownership is ambiguous",
  )
  assert.equal(startCalls, 0, "invalid market-data routes must be rejected before account startup")
})


function createSameMarketCgAndRsConfig() {
  return {
    ...appConfig,
    marketDataRouting: {
      routes: [{
        symbol: "BTCUSDT",
        providerInstanceId: "first",
      }],
    },
    executionRouting: {
      routes: [
        {
          strategyId: "CG_coinGrabber",
          symbol: "BTCUSDT",
          providerInstanceId: "first",
        },
        {
          strategyId: "RS_recoverySeller",
          symbol: "BTCUSDT",
          providerInstanceId: "first",
        },
      ],
    },
    strategies: {
      ...appConfig.strategies,
      CG_coinGrabber: {
        pairs: {
          BTCUSDT: { enabled: true },
        },
      },
      RS_recoverySeller: {
        enabled: true,
        pairs: {
          BTCUSDT: { enabled: true },
        },
      },
    },
  }
}

test("passes both strategy routes to one provider while deduplicating its market subscription", async () => {
  const provider = createProvider({
    providerInstanceId: "first",
    providerType: "binance",
    accountId: "account-one",
  })
  const starts = []

  await startProviderAccounts({
    providers: [provider],
    appConfig: createSameMarketCgAndRsConfig(),
    start: async (input) => {
      starts.push(input)
      return {}
    },
  })

  assert.deepEqual(starts[0].executionRoutes, [
    {
      strategyId: "CG_coinGrabber",
      symbol: "BTCUSDT",
    },
    {
      strategyId: "RS_recoverySeller",
      symbol: "BTCUSDT",
    },
  ], "A shared provider account must retain both independently owned strategy routes")
  assert.deepEqual(starts[0].executionSymbols, ["BTCUSDT"], "The shared market must be subscribed only once")
})
