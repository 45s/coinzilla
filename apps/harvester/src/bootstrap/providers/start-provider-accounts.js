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

function createMultiAccountRuntime({ appConfig, startedAccounts, failedAccounts }) {
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
    failedAccounts: Object.freeze(failedAccounts),
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

async function releaseFailedAccountLock({ provider, releaseProviderLock }) {
  if (typeof releaseProviderLock !== "function") {
    return []
  }
  try {
    const result = await releaseProviderLock(provider.providerInstanceId)
    if (result?.ok !== false) {
      return []
    }
    return Array.isArray(result.errors) && result.errors.length > 0
      ? result.errors
      : [new Error(`Provider account ${provider.providerInstanceId} process-lock release failed`)]
  } catch (error) {
    return [error]
  }
}

function createFailedAccount({ provider, error, cleanupErrors }) {
  return Object.freeze({
    providerInstanceId: provider.providerInstanceId,
    providerType: provider.providerType,
    accountId: provider.accountId,
    environment: provider.environment,
    errorName: error?.name ?? "Error",
    errorCode: error?.code,
    errorMessage: error?.message ?? String(error),
    cleanupErrors: Object.freeze(cleanupErrors.map((cleanupError) => Object.freeze({
      name: cleanupError?.name ?? "Error",
      code: cleanupError?.code,
      message: cleanupError?.message ?? String(cleanupError),
    }))),
  })
}

function throwIfNoAccountStarted({ providers, failedErrors }) {
  if (failedErrors.length === 0) {
    return
  }
  const failures = failedErrors
  if (providers.length === 1 && failures.length === 1) {
    throw failures[0]
  }
  throw new AggregateError(
    failures,
    "No configured Harvester provider account could be started",
    { cause: failures[0] },
  )
}

/**
 * Start an independent Harvester runtime for each configured provider account.
 * Account startup failures release only that account's process lock; successful
 * account runtimes remain active and retain their own broker/state lifecycle.
 *
 * The first configured account owns process-wide Telegram control and optional
 * operational-state callbacks. All accounts share the process event publisher.
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
  releaseProviderLock,
} = {}) {
  if (!Array.isArray(providers) || providers.length === 0) {
    throw new TypeError("Harvester requires at least one configured provider account")
  }
  if (typeof start !== "function") {
    throw new TypeError("Harvester provider-account startup requires a start function")
  }
  const startedAccounts = []
  const failedAccounts = []
  const failedErrors = []
  for (const [index, provider] of providers.entries()) {
    try {
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
      if (runtime === null || typeof runtime !== "object" || Array.isArray(runtime)) {
        throw new TypeError(`Provider account ${provider.providerInstanceId} startup must return a runtime object`)
      }
      startedAccounts.push({
        provider,
        runtime,
        stopped: false,
      })
    } catch (error) {
      const cleanupErrors = await releaseFailedAccountLock({
        provider,
        releaseProviderLock,
      })
      failedAccounts.push(createFailedAccount({
        provider,
        error,
        cleanupErrors,
      }))
      failedErrors.push(error, ...cleanupErrors)
    }
  }
  throwIfNoAccountStarted({ providers, failedErrors })
  if (providers.length === 1) {
    return startedAccounts[0].runtime
  }
  return createMultiAccountRuntime({
    appConfig,
    startedAccounts,
    failedAccounts,
  })
}
