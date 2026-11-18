import test from "node:test"
import assert from "node:assert/strict"
import { main as startMain } from "./index.js"
import { appConfig as defaultAppConfig } from "../config/index.js"

const disabledJournalService = () => ({
  ready: Promise.resolve({ ok: true, disabled: true }),
  flush: async () => ({ ok: true, durable: true }),
  close: async () => ({ ok: true, closed: true, disabled: true }),
})

const main = (options = {}) => {
  const { createJournalService = disabledJournalService, env = {}, ...rest } = options
  return startMain({
    acquireProcessLock: async () => ({
      ok: true,
      release: async () => ({ ok: true, released: true }),
    }),
    createOperationalStateStore: () => ({
      verify: async () => ({ ok: true, data: { valid: true, durableWriteSupported: true } }),
    }),
    ...rest,
    env: { TRADING_MODE: "testnet", ...env },
    createJournalService: (...args) => {
      const service = createJournalService(...args) ?? {}
      if (!Object.hasOwn(service, "ready")) {
        service.ready = Promise.resolve({ ok: true })
      }
      if (!Object.hasOwn(service, "flush")) {
        service.flush = async () => ({ ok: true, durable: true })
      }
      if (!Object.hasOwn(service, "close")) {
        service.close = async () => ({ ok: true, closed: true })
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
      stop: async () => {
        stopped.push(input.providerIdentity.providerInstanceId)
        return {
          ok: true,
        }
      },
    }
  }
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
  const config = {
    ...defaultAppConfig,
    operatorControl: {
      telegram: {
        enabled: true,
        allowedUserIds: ["12345"],
      },
    },
    brokers: {
      instances: providerInstances,
    },
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
      error() {},
    },
  })
  return {
    run,
    started,
    stopped,
    lockScopes,
    releasedLocks,
    signalHandlers,
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
    assert.ok(result)
    assert.equal(result.runtime.providerAccounts.length, 2)
    assert.deepEqual(fixture.started.map(({ identity }) => identity.providerInstanceId), [
      "binanceTestnetPrimary",
      "testProviderLiveSecondary",
    ])
    assert.deepEqual(fixture.started.map(({ tradingMode }) => tradingMode), [
      "testnet",
      "live",
    ])
    assert.deepEqual(fixture.started.map(({ operatorControlEnabled }) => operatorControlEnabled), [
      true,
      false,
    ])
    assert.deepEqual(fixture.lockScopes.map(({ accountId, tradingMode }) => [accountId, tradingMode]), [
      ["binance-primary", "testnet"],
      ["test-provider-secondary", "live"],
    ])
    await fixture.signalHandlers.get("SIGINT")()
    assert.deepEqual(fixture.stopped, [
      "testProviderLiveSecondary",
      "binanceTestnetPrimary",
    ])
    assert.deepEqual(fixture.releasedLocks, [
      "testProviderLiveSecondary",
      "binanceTestnetPrimary",
    ])
    assert.equal(process.exitCode, 0)
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
    assert.ok(result)
    assert.equal(result.runtime.failedAccounts[0].lockRetained, true)
    assert.deepEqual(fixture.releasedLocks, [])
    await fixture.signalHandlers.get("SIGINT")()
    assert.deepEqual(fixture.stopped, ["binanceTestnetPrimary"])
    assert.deepEqual(fixture.releasedLocks, [
      "binanceTestnetPrimary",
      "binanceTestnetSecondary",
    ])
    assert.equal(process.exitCode, 0)
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
    assert.ok(result)
    assert.deepEqual(fixture.started.map(({ identity }) => identity.providerInstanceId), [
      "binanceTestnetPrimary",
      "binanceTestnetSecondary",
    ])
    assert.deepEqual(result.runtime.providerAccounts.map(({ providerInstanceId }) => providerInstanceId), [
      "binanceTestnetPrimary",
    ])
    assert.equal(result.runtime.failedAccounts.length, 1)
    assert.equal(result.runtime.failedAccounts[0].providerInstanceId, "binanceTestnetSecondary")
    assert.deepEqual(fixture.releasedLocks, ["binanceTestnetSecondary"])
    await fixture.signalHandlers.get("SIGINT")()
    assert.deepEqual(fixture.stopped, ["binanceTestnetPrimary"])
    assert.deepEqual(fixture.releasedLocks, [
      "binanceTestnetSecondary",
      "binanceTestnetPrimary",
    ])
    assert.equal(process.exitCode, 0)
  } finally {
    process.exitCode = previousExitCode
  }
})
