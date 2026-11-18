import assert from "node:assert/strict"
import test from "node:test"
import { startProviderAccounts } from "./start-provider-accounts.js"

function createProvider({
  providerInstanceId,
  providerType,
  accountId,
  environment = "testnet",
  credentialEnvironmentNames = {},
}) {
  return {
    providerInstanceId,
    providerType,
    accountId,
    environment,
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
    routes: [{ symbol: "BTCUSDT", providerInstanceId: "first" }],
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
        BTCUSDT: {
          enabled: true,
        },
      },
    },
  },
}

function appConfigForMarketDataProvider(providerInstanceId) {
  return {
    ...appConfig,
    marketDataRouting: {
      routes: [{ symbol: "BTCUSDT", providerInstanceId }],
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
    subscriptions: ["BTCUSDT"],
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
      marketDataProviderInstanceId: input.marketDataProviderInstanceId,
      marketDataSymbols: input.marketDataSymbols,
      credentialValues: [
        input.env.PRIMARY_KEY,
        input.env.SECONDARY_KEY,
        input.env.OTHER_KEY,
      ],
    })
    const runtime = runtimes[runtimeIndex]
    runtimeIndex += 1
    return runtime
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
  assert.deepEqual(inputs.map((entry) => entry.marketDataProviderInstanceId), [
    "binance-one",
    "binance-two",
    "other-live",
  ])
  assert.deepEqual(inputs.map((entry) => entry.marketDataSymbols), [
    ["BTCUSDT"],
    [],
    [],
  ], "only the selected source provider may subscribe to this market")
  assert.deepEqual(inputs.map((entry) => entry.credentialValues), [
    ["primary-key", undefined, undefined],
    [undefined, "secondary-key", undefined],
    [undefined, undefined, "other-key"],
  ])
}

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
  assert.equal(runtime.providerAccounts.length, 3)
  assert.deepEqual(runtime.subscriptions, ["BTCUSDT"])
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
  return async () => {
    startCount += 1
    if (startCount === 2) {
      const error = new Error("second account connection failed")
      error.startupCleanupConfirmed = true
      throw error
    }
    const account = startCount === 1 ? "first" : "third"
    return {
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

test("reports failed-account lock cleanup errors without stopping healthy accounts", async () => {
  const startupError = new Error("second account failed")
  startupError.startupCleanupConfirmed = true
  const cleanupError = new Error("second account lock cleanup failed")
  const stopped = []
  let startCount = 0
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
      }),
      createProvider({
        providerInstanceId: "third",
        providerType: "binance",
        accountId: "account-three",
      }),
    ],
    start: async () => {
      startCount += 1
      if (startCount === 2) {
        throw startupError
      }
      const account = startCount === 1 ? "first" : "third"
      return {
        stop: async () => {
          stopped.push(account)
          return {
            ok: true,
          }
        },
      }
    },
    releaseProviderLock: async (providerInstanceId) => providerInstanceId === "second"
      ? {
        ok: false,
        errors: [cleanupError],
      }
      : {
        ok: true,
      },
    appConfig,
    env: {
      TRADING_MODE: "testnet",
    },
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
      }),
    ],
    start: async (input) => {
      const { providerInstanceId } = input.providerIdentity
      if (providerInstanceId === "second") {
        throw new Error("second account cleanup is uncertain")
      }
      return {
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
    appConfig,
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
      appConfig,
      env: {
        TRADING_MODE: "testnet",
      },
    }),
    /account unavailable/,
  )
})


test("releases only accounts whose runtime shutdown is confirmed", async () => {
  const stopCalls = []
  const releasedLocks = []
  let firstStopAttempts = 0
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
      }),
    ],
    start: async (input) => ({
      stop: async () => {
        const { providerInstanceId } = input.providerIdentity
        stopCalls.push(providerInstanceId)
        if (providerInstanceId === "first") {
          firstStopAttempts += 1
          if (firstStopAttempts === 1) {
            return {
              ok: false,
              errors: [new Error("first account still stopping")],
            }
          }
        }
        return {
          ok: true,
        }
      },
    }),
    releaseProviderLock: async (providerInstanceId) => {
      releasedLocks.push(providerInstanceId)
      return {
        ok: true,
      }
    },
    appConfig,
    env: {
      TRADING_MODE: "testnet",
    },
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
