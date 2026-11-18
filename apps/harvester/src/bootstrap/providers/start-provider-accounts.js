function createAccountAppConfig({ appConfig, isPrimary }) {
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

function collectRuntimeStopErrors({ result, providerInstanceId }) {
  if (result?.ok !== false) {
    return []
  }
  const errors = Array.isArray(result.errors) && result.errors.length > 0
    ? result.errors
    : [new Error(`Provider account ${providerInstanceId} did not confirm shutdown`)]
  return errors
}

async function stopStartedAccounts({ startedAccounts }) {
  const errors = []
  for (const entry of [...startedAccounts].reverse()) {
    if (entry.stopped) {
      continue
    }
    try {
      const result = await entry.runtime.stop?.()
      const stopErrors = collectRuntimeStopErrors({
        result,
        providerInstanceId: entry.provider.providerInstanceId,
      })
      if (stopErrors.length === 0) {
        entry.stopped = true
      } else {
        errors.push(...stopErrors)
      }
    } catch (error) {
      errors.push(error)
    }
  }
  return errors
}

function createMultiAccountRuntime({ appConfig, startedAccounts }) {
  const stop = async () => {
    const errors = await stopStartedAccounts({ startedAccounts })
    if (errors.length > 0) {
      return { ok: false, errors }
    }
    return { ok: true, stopped: true }
  }
  const primary = startedAccounts[0].runtime
  const providerAccounts = Object.freeze(startedAccounts.map(({ provider }) => Object.freeze({
    providerInstanceId: provider.providerInstanceId,
    providerType: provider.providerType,
    accountId: provider.accountId,
    environment: provider.environment,
  })))
  const subscriptions = Object.freeze([...new Set(
    startedAccounts.flatMap(({ runtime }) => runtime.subscriptions ?? []),
  )])
  return Object.freeze({
    appConfig,
    account: primary.account ?? providerAccounts[0],
    providerAccounts,
    accountRuntimes: Object.freeze(startedAccounts.map(({ runtime }) => runtime)),
    brokerName: providerAccounts.length === 1 ? providerAccounts[0].providerType : "multiple",
    environment: primary.environment,
    tradingMode: providerAccounts[0].environment,
    tradingEnabled: startedAccounts.some(({ runtime }) => runtime.tradingEnabled === true),
    strategyMode: primary.strategyMode ?? "conservative",
    connected: startedAccounts.every(({ runtime }) => runtime.connected !== false),
    subscriptions,
    get userDataReady() {
      return startedAccounts.every(({ runtime }) => runtime.userDataReady === true)
    },
    stop,
  })
}

async function rollbackStartedAccounts({ startupError, startedAccounts }) {
  const cleanupErrors = await stopStartedAccounts({ startedAccounts })
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      [startupError, ...cleanupErrors],
      "Harvester provider-account startup failed and account cleanup was incomplete",
      { cause: startupError },
    )
  }
  throw startupError
}

/**
 * Start one independent Harvester runtime for each configured provider account.
 * The first account owns process-wide Telegram control and operational-state callbacks;
 * all account runtimes share the process event publisher but retain separate broker/state lifecycles.
 *
 * @param {{providers: object[], start: Function, appConfig: object, env: object}} input
 * @returns {Promise<object>}
 */
export async function startProviderAccounts({
  providers,
  start,
  appConfig,
  env = process.env,
  eventPublisher,
  runtimeSessionId,
  operationalStateStore,
} = {}) {
  if (!Array.isArray(providers) || providers.length === 0) {
    throw new TypeError("Harvester requires at least one configured provider account")
  }
  if (typeof start !== "function") {
    throw new TypeError("Harvester provider-account startup requires a start function")
  }
  const startedAccounts = []
  try {
    for (const [index, provider] of providers.entries()) {
      const runtime = await start({
        appConfig: createAccountAppConfig({
          appConfig,
          isPrimary: index === 0,
        }),
        env: {
          ...env,
          TRADING_MODE: provider.environment,
        },
        eventPublisher,
        runtimeSessionId,
        operationalStateStore: index === 0 ? operationalStateStore : undefined,
        brokerAdapterFactory: provider.brokerAdapterFactory,
        providerIdentity: provider.identity,
      })
      startedAccounts.push({
        provider,
        runtime,
        stopped: false,
      })
    }
  } catch (startupError) {
    await rollbackStartedAccounts({
      startupError,
      startedAccounts,
    })
  }
  if (startedAccounts.length === 1) {
    return startedAccounts[0].runtime
  }
  return createMultiAccountRuntime({
    appConfig,
    startedAccounts,
  })
}
