import { resolveMarketDataSymbolsByProvider } from "./resolve-market-data-symbols-by-provider.js"
import { resolveExecutionSymbolsByProvider } from "./resolve-execution-symbols-by-provider.js"

function createAccountEnvironment({
  env,
  provider,
  providers,
}) {
  const accountCredentials = new Set(Object.values(provider.credentialEnvironmentNames ?? {}))
  const allCredentialNames = new Set(
    providers.flatMap(({ credentialEnvironmentNames = {} }) => Object.values(credentialEnvironmentNames)),
  )
  const accountEnv = {
    ...env,
    TRADING_MODE: provider.environment,
  }
  for (const credentialName of allCredentialNames) {
    if (!accountCredentials.has(credentialName)) {
      delete accountEnv[credentialName]
    }
  }
  return accountEnv
}

function createAccountAppConfig({
  appConfig,
  isPrimary,
}) {
  if (isPrimary || appConfig.operatorControl?.telegram?.enabled !== true) {
    return appConfig
  }
  return {
    ...appConfig,
    operatorControl: {
      ...appConfig.operatorControl,
      telegram: {
        ...appConfig.operatorControl.telegram,
        enabled: false,
      },
    },
  }
}

function createMarketDataProviderBySymbol({ marketDataSymbolsByProvider }) {
  const providerBySymbol = new Map()
  for (const [providerInstanceId, symbols] of marketDataSymbolsByProvider) {
    for (const symbol of symbols) {
      if (providerBySymbol.has(symbol)) {
        throw new TypeError(`Market-data symbol ${symbol} has more than one configured source`)
      }
      providerBySymbol.set(symbol, providerInstanceId)
    }
  }
  return providerBySymbol
}

function assertExecutionAndMarketDataEnvironments({
  providers,
  executionSymbolsByProvider,
  marketDataProviderBySymbol,
}) {
  const providerById = new Map(providers.map((provider) => [provider.providerInstanceId, provider]))
  for (const [executionProviderId, symbols] of executionSymbolsByProvider) {
    const executionProvider = providerById.get(executionProviderId)
    for (const symbol of symbols) {
      const sourceProviderId = marketDataProviderBySymbol.get(symbol)
      const sourceProvider = providerById.get(sourceProviderId)
      if (!sourceProvider) {
        throw new TypeError(`Market-data route for ${symbol} references an unknown source provider`)
      }
      if (executionProvider.environment !== sourceProvider.environment) {
        throw new TypeError(
          `Execution and market-data providers for ${symbol} must use the same trading environment`,
        )
      }
    }
  }
}

function createRequiredCapabilitiesByProvider({
  providers,
  executionSymbolsByProvider,
  marketDataSymbolsByProvider,
}) {
  const accountCapabilities = [
    "READ_ACCOUNT_SNAPSHOT",
    "READ_OPEN_ORDERS",
    "READ_CANONICAL_ORDER",
    "READ_CANONICAL_ORDER_HISTORY",
    "READ_FILLS",
    "READ_SYMBOL_FILTERS",
    "SUBSCRIBE_USER_DATA",
    "RECOVER_USER_DATA_SESSION",
  ]
  const executionCapabilities = ["PLACE_LIMIT_ORDER", "CANCEL_ORDER"]
  const marketDataCapabilities = [
    "READ_MARKET_PRICE",
    "READ_CANDLES",
    "SUBSCRIBE_MARKET_PRICES",
    "SUBSCRIBE_CANDLES",
    "SUBSCRIBE_BOOK_TICKER",
  ]
  return new Map(providers.map(({ providerInstanceId }) => {
    const required = new Set(accountCapabilities)
    if ((executionSymbolsByProvider.get(providerInstanceId) ?? []).length > 0) {
      for (const capability of executionCapabilities) {
        required.add(capability)
      }
    }
    if ((marketDataSymbolsByProvider.get(providerInstanceId) ?? []).length > 0) {
      for (const capability of marketDataCapabilities) {
        required.add(capability)
      }
    }
    return [providerInstanceId, Object.freeze([...required])]
  }))
}

function createMarketDataBrokerResolver({
  providerBrokers,
  marketDataProviderBySymbol,
}) {
  return ({ symbol } = {}) => {
    const providerInstanceId = marketDataProviderBySymbol.get(symbol)
    if (!providerInstanceId) {
      const error = new Error(`No explicit market-data source is configured for ${symbol}`)
      error.code = "HARVESTER_MARKET_DATA_ROUTE_MISSING"
      throw error
    }
    const broker = providerBrokers.get(providerInstanceId)
    if (!broker) {
      const error = new Error(
        `Configured market-data source provider ${providerInstanceId} is unavailable for ${symbol}`,
      )
      error.code = "HARVESTER_MARKET_DATA_PROVIDER_UNAVAILABLE"
      throw error
    }
    return broker
  }
}

function collectRuntimeStopErrors({
  result,
  providerInstanceId,
}) {
  if (result === undefined || result?.ok === true) {
    return []
  }
  if (Array.isArray(result.errors) && result.errors.length > 0) {
    return result.errors
  }
  return [new Error(`Provider account ${providerInstanceId} did not confirm shutdown`)]
}

function collectProcessLockReleaseErrors({
  result,
  providerInstanceId,
}) {
  if (result?.ok === true) {
    return []
  }
  if (Array.isArray(result?.errors) && result.errors.length > 0) {
    return result.errors
  }
  return [new Error(`Provider account ${providerInstanceId} process-lock release was not confirmed`)]
}

async function releaseStoppedAccountLock({
  entry,
  releaseProviderLock,
}) {
  if (entry.lockReleased || typeof releaseProviderLock !== "function") {
    entry.lockReleased = true
    return []
  }
  try {
    const result = await releaseProviderLock(entry.provider.providerInstanceId)
    const errors = collectProcessLockReleaseErrors({
      result,
      providerInstanceId: entry.provider.providerInstanceId,
    })
    if (errors.length === 0) {
      entry.lockReleased = true
    }
    return errors
  } catch (error) {
    return [error]
  }
}

async function stopOneStartedAccount({
  entry,
  releaseProviderLock,
}) {
  if (!entry.runtimeStopped) {
    try {
      const result = await entry.runtime.stop?.()
      const stopErrors = collectRuntimeStopErrors({
        result,
        providerInstanceId: entry.provider.providerInstanceId,
      })
      if (stopErrors.length > 0) {
        return stopErrors
      }
      entry.runtimeStopped = true
    } catch (error) {
      return [error]
    }
  }
  if (typeof entry.runtime.stopMarketData === "function") {
    try {
      const result = await entry.runtime.stopMarketData()
      const stopErrors = collectRuntimeStopErrors({
        result,
        providerInstanceId: entry.provider.providerInstanceId,
      })
      if (stopErrors.length > 0) {
        return stopErrors
      }
    } catch (error) {
      return [error]
    }
  }
  return releaseStoppedAccountLock({
    entry,
    releaseProviderLock,
  })
}

async function stopStartedAccounts({
  startedAccounts,
  releaseProviderLock,
}) {
  const errors = []
  for (const entry of [...startedAccounts].reverse()) {
    errors.push(...await stopOneStartedAccount({
      entry,
      releaseProviderLock,
    }))
  }
  return errors
}

function createMultiAccountRuntime({
  appConfig,
  startedAccounts,
  failedAccounts,
  releaseProviderLock,
}) {
  const stop = async () => {
    const errors = await stopStartedAccounts({
      startedAccounts,
      releaseProviderLock,
    })
    if (errors.length > 0) {
      return {
        ok: false,
        errors,
      }
    }
    return {
      ok: true,
      stopped: true,
    }
  }
  const primary = startedAccounts[0].runtime
  const providerAccounts = Object.freeze(startedAccounts.map(({ provider, runtime }) => Object.freeze({
    providerInstanceId: provider.providerInstanceId,
    providerType: provider.providerType,
    accountId: provider.accountId,
    environment: provider.environment,
    required: provider.required !== false,
    executionSymbols: Object.freeze([...(runtime.executionSymbols ?? [])]),
    marketDataSources: Object.freeze({ ...(runtime.marketDataSources ?? {}) }),
    marketDataProviderTypes: Object.freeze({ ...(runtime.marketDataProviderTypes ?? {}) }),
  })))
  const subscriptions = Object.freeze([...new Set(
    startedAccounts.flatMap(({ runtime }) => runtime.subscriptions ?? []),
  )])
  return Object.freeze({
    appConfig,
    account: primary.account ?? providerAccounts[0],
    providerAccounts,
    accountRuntimes: Object.freeze(startedAccounts.map(({ runtime }) => runtime)),
    failedAccounts: Object.freeze(failedAccounts),
    brokerName: providerAccounts.length === 1 ? providerAccounts[0].providerType : "multiple",
    environment: primary.environment,
    tradingMode: providerAccounts[0].environment,
    tradingEnabled: startedAccounts.some(({ runtime }) =>
      runtime.tradingEnabled === true && runtime.executionEnabled !== false),
    strategyMode: primary.strategyMode ?? "conservative",
    connected: startedAccounts.every(({ runtime }) => runtime.connected !== false),
    subscriptions,
    get userDataReady() {
      return startedAccounts.every(({ runtime }) => runtime.userDataReady === true)
    },
    stop,
  })
}

async function retainFailedAccountLock({
  provider,
  retainProviderLock,
}) {
  if (typeof retainProviderLock !== "function") {
    return []
  }
  try {
    const result = await retainProviderLock(provider.providerInstanceId)
    if (result?.ok === true) {
      return []
    }
    if (Array.isArray(result?.errors) && result.errors.length > 0) {
      return result.errors
    }
    return [new Error(`Provider account ${provider.providerInstanceId} process-lock retention was not confirmed`)]
  } catch (error) {
    return [error]
  }
}

async function releaseFailedAccountLock({
  provider,
  releaseProviderLock,
}) {
  if (typeof releaseProviderLock !== "function") {
    return []
  }
  try {
    const result = await releaseProviderLock(provider.providerInstanceId)
    return collectProcessLockReleaseErrors({
      result,
      providerInstanceId: provider.providerInstanceId,
    })
  } catch (error) {
    return [error]
  }
}

function createFailedAccount({
  provider,
  error,
  cleanupErrors,
  lockRetained,
  lockReleasePending,
  executionSymbols,
}) {
  return Object.freeze({
    providerInstanceId: provider.providerInstanceId,
    providerType: provider.providerType,
    accountId: provider.accountId,
    environment: provider.environment,
    required: provider.required !== false,
    executionSymbols: Object.freeze([...(executionSymbols ?? [])]),
    errorName: error?.name ?? "Error",
    errorCode: error?.code,
    errorMessage: error?.message ?? String(error),
    lockRetained,
    lockReleasePending,
    cleanupErrors: Object.freeze(cleanupErrors.map((cleanupError) => Object.freeze({
      name: cleanupError?.name ?? "Error",
      code: cleanupError?.code,
      message: cleanupError?.message ?? String(cleanupError),
    }))),
  })
}

function throwIfNoAccountStarted({
  providers,
  startedAccounts,
  failedErrors,
}) {
  if (startedAccounts.length > 0 || failedErrors.length === 0) {
    return
  }
  if (providers.length === 1 && failedErrors.length === 1) {
    throw failedErrors[0]
  }
  throw new AggregateError(
    failedErrors,
    "No configured Harvester provider account could be started",
    { cause: failedErrors[0] },
  )
}

async function throwIfRequiredProviderFailed({
  startedAccounts,
  failedAccounts,
  failedErrors,
  releaseProviderLock,
}) {
  const requiredFailures = failedAccounts.filter(({ required }) => required !== false)
  if (requiredFailures.length === 0) {
    return
  }
  const cleanupErrors = await stopStartedAccounts({
    startedAccounts,
    releaseProviderLock,
  })
  throw new AggregateError(
    [...failedErrors, ...cleanupErrors],
    "A required provider account failed to start; all started provider accounts were rolled back",
    { cause: failedErrors[0] },
  )
}

function createProviderAccountStartInput({
  provider,
  providers,
  index,
  appConfig,
  env,
  eventPublisher,
  runtimeSessionId,
  operationalStateStore,
  executionSymbolsByProvider,
  marketDataProviderBySymbol,
  providerBrokers,
  requiredCapabilitiesByProvider,
  deferMarketDataStart,
}) {
  const executionSymbols = executionSymbolsByProvider.get(provider.providerInstanceId) ?? []
  const marketDataSources = Object.fromEntries(executionSymbols.map((symbol) => [
    symbol,
    marketDataProviderBySymbol.get(symbol),
  ]))
  const providerById = new Map(providers.map((entry) => [entry.providerInstanceId, entry]))
  const marketDataProviderTypes = Object.fromEntries(executionSymbols.map((symbol) => {
    const sourceProvider = providerById.get(marketDataProviderBySymbol.get(symbol))
    return [symbol, sourceProvider?.providerType]
  }))
  return {
    appConfig: createAccountAppConfig({
      appConfig,
      isPrimary: index === 0,
    }),
    env: createAccountEnvironment({
      env,
      provider,
      providers,
    }),
    eventPublisher,
    runtimeSessionId,
    operationalStateStore: index === 0 ? operationalStateStore : undefined,
    brokerAdapterFactory: provider.brokerAdapterFactory,
    providerIdentity: provider.identity,
    providerRequired: provider.required !== false,
    executionSymbols: Object.freeze([...executionSymbols]),
    marketDataSymbols: Object.freeze([...executionSymbols]),
    marketDataSources: Object.freeze(marketDataSources),
    marketDataProviderTypes: Object.freeze(marketDataProviderTypes),
    requiredCapabilities: requiredCapabilitiesByProvider.get(provider.providerInstanceId) ?? Object.freeze([]),
    deferMarketDataStart,
    ...(deferMarketDataStart ? {
      onBrokerConnected: ({ providerInstanceId, broker } = {}) => {
        if (providerInstanceId !== provider.providerInstanceId || !broker) {
          throw new TypeError("Provider runtime registered a broker with mismatched instance identity")
        }
        providerBrokers.set(providerInstanceId, broker)
      },
      getMarketDataBroker: createMarketDataBrokerResolver({
        providerBrokers,
        marketDataProviderBySymbol,
      }),
    } : {}),
  }
}

function validateStartedProviderRuntime({
  runtime,
  provider,
  requireStop,
}) {
  if (runtime === null || typeof runtime !== "object" || Array.isArray(runtime)) {
    throw new TypeError(`Provider account ${provider.providerInstanceId} startup must return a runtime object`)
  }
  if (requireStop && typeof runtime.stop !== "function") {
    throw new TypeError(`Provider account ${provider.providerInstanceId} runtime must expose stop()`)
  }
  if (requireStop && (
    typeof runtime.startMarketData !== "function" ||
    typeof runtime.stopMarketData !== "function"
  )) {
    throw new TypeError(
      `Provider account ${provider.providerInstanceId} runtime must expose startMarketData() and stopMarketData()`,
    )
  }
}

async function startOneProviderAccount({
  provider,
  providers,
  index,
  start,
  appConfig,
  env,
  eventPublisher,
  runtimeSessionId,
  operationalStateStore,
  releaseProviderLock,
  retainProviderLock,
  requireStop,
  executionSymbolsByProvider,
  marketDataProviderBySymbol,
  providerBrokers,
  requiredCapabilitiesByProvider,
  deferMarketDataStart,
}) {
  try {
    const runtime = await start(createProviderAccountStartInput({
      provider,
      providers,
      index,
      appConfig,
      env,
      eventPublisher,
      runtimeSessionId,
      operationalStateStore,
      executionSymbolsByProvider,
      marketDataProviderBySymbol,
      providerBrokers,
      requiredCapabilitiesByProvider,
      deferMarketDataStart,
    }))
    validateStartedProviderRuntime({
      runtime,
      provider,
      requireStop,
    })
    return {
      runtime,
      error: undefined,
    }
  } catch (error) {
    providerBrokers.delete(provider.providerInstanceId)
    const cleanupConfirmed = error?.startupCleanupConfirmed === true
    const cleanupErrors = cleanupConfirmed
      ? await releaseFailedAccountLock({
        provider,
        releaseProviderLock,
      })
      : await retainFailedAccountLock({
        provider,
        retainProviderLock,
      })
    return {
      runtime: undefined,
      error,
      cleanupErrors,
      lockRetained: !cleanupConfirmed,
      lockReleasePending: cleanupConfirmed && cleanupErrors.length > 0,
    }
  }
}

async function startConfiguredProviderAccounts({
  providers,
  start,
  appConfig,
  env,
  eventPublisher,
  runtimeSessionId,
  operationalStateStore,
  releaseProviderLock,
  retainProviderLock,
  executionSymbolsByProvider,
  marketDataProviderBySymbol,
  providerBrokers,
  requiredCapabilitiesByProvider,
  deferMarketDataStart,
}) {
  const startedAccounts = []
  const failedAccounts = []
  const failedErrors = []
  for (const [index, provider] of providers.entries()) {
    const result = await startOneProviderAccount({
      provider,
      providers,
      index,
      start,
      appConfig,
      env,
      eventPublisher,
      runtimeSessionId,
      operationalStateStore,
      releaseProviderLock,
      retainProviderLock,
      requireStop: providers.length > 1,
      executionSymbolsByProvider,
      marketDataProviderBySymbol,
      providerBrokers,
      requiredCapabilitiesByProvider,
      deferMarketDataStart,
    })
    if (result.error === undefined) {
      startedAccounts.push({
        provider,
        runtime: result.runtime,
        runtimeStopped: false,
        lockReleased: false,
      })
      continue
    }
    failedAccounts.push(createFailedAccount({
      provider,
      error: result.error,
      cleanupErrors: result.cleanupErrors ?? [],
      lockRetained: result.lockRetained === true,
      lockReleasePending: result.lockReleasePending === true,
      executionSymbols: executionSymbolsByProvider.get(provider.providerInstanceId),
    }))
    failedErrors.push(result.error, ...(result.cleanupErrors ?? []))
  }
  return {
    startedAccounts,
    failedAccounts,
    failedErrors,
  }
}

export async function startProviderAccounts({
  providers,
  start,
  appConfig,
  env = process.env,
  eventPublisher,
  runtimeSessionId,
  operationalStateStore,
  releaseProviderLock,
  retainProviderLock,
} = {}) {
  if (!Array.isArray(providers) || providers.length === 0) {
    throw new TypeError("Harvester requires at least one configured provider account")
  }
  if (typeof start !== "function") {
    throw new TypeError("Harvester provider-account startup requires a start function")
  }
  const executionSymbolsByProvider = resolveExecutionSymbolsByProvider({
    appConfig,
    providers,
  })
  const marketDataSymbolsByProvider = resolveMarketDataSymbolsByProvider({
    appConfig,
    providers,
  })
  const marketDataProviderBySymbol = createMarketDataProviderBySymbol({
    marketDataSymbolsByProvider,
  })
  assertExecutionAndMarketDataEnvironments({
    providers,
    executionSymbolsByProvider,
    marketDataProviderBySymbol,
  })
  const providerBrokers = new Map()
  const requiredCapabilitiesByProvider = createRequiredCapabilitiesByProvider({
    providers,
    executionSymbolsByProvider,
    marketDataSymbolsByProvider,
  })
  const deferMarketDataStart = providers.length > 1
  const startup = await startConfiguredProviderAccounts({
    providers,
    start,
    appConfig,
    env,
    eventPublisher,
    runtimeSessionId,
    operationalStateStore,
    releaseProviderLock,
    retainProviderLock,
    marketDataSymbolsByProvider,
    executionSymbolsByProvider,
    marketDataProviderBySymbol,
    providerBrokers,
    requiredCapabilitiesByProvider,
    deferMarketDataStart,
  })
  throwIfNoAccountStarted({
    providers,
    startedAccounts: startup.startedAccounts,
    failedErrors: startup.failedErrors,
  })
  await throwIfRequiredProviderFailed({
    startedAccounts: startup.startedAccounts,
    failedAccounts: startup.failedAccounts,
    failedErrors: startup.failedErrors,
    releaseProviderLock,
  })
  if (deferMarketDataStart) {
    try {
      for (const entry of startup.startedAccounts) {
        await entry.runtime.startMarketData()
      }
    } catch (error) {
      const cleanupErrors = await stopStartedAccounts({
        startedAccounts: startup.startedAccounts,
        releaseProviderLock,
      })
      throw new AggregateError(
        [error, ...cleanupErrors],
        "Deferred Harvester market-data startup failed",
        { cause: error },
      )
    }
  }
  if (providers.length === 1) {
    return startup.startedAccounts[0].runtime
  }
  return createMultiAccountRuntime({
    appConfig,
    startedAccounts: startup.startedAccounts,
    failedAccounts: startup.failedAccounts,
    releaseProviderLock,
  })
}
