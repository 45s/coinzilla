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
}) {
  return Object.freeze({
    providerInstanceId: provider.providerInstanceId,
    providerType: provider.providerType,
    accountId: provider.accountId,
    environment: provider.environment,
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

function createProviderAccountStartInput({
  provider,
  providers,
  index,
  appConfig,
  env,
  eventPublisher,
  runtimeSessionId,
  operationalStateStore,
}) {
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
  })
  throwIfNoAccountStarted({
    providers,
    startedAccounts: startup.startedAccounts,
    failedErrors: startup.failedErrors,
  })
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
