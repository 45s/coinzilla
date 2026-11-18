import assert from "node:assert/strict"
import test from "node:test"
import { startProviderAccounts } from "./start-provider-accounts.js"

function createProvider(providerInstanceId, providerType, accountId, environment = "testnet") {
  return {
    providerInstanceId,
    providerType,
    accountId,
    environment,
    identity: { providerInstanceId, providerType, accountId },
    brokerAdapterFactory: () => ({}),
  }
}

const appConfig = {
  operatorControl: {
    telegram: { enabled: true, allowedUserIds: ["12345"] },
  },
  strategies: { CG_coinGrabber: { pairs: { BTCUSDT: { enabled: true } } } },
}

test("starts one independent runtime per configured provider account", async () => {
  const providers = [
    createProvider("binance-one", "binance", "account-one"),
    createProvider("binance-two", "binance", "account-two"),
    createProvider("other-live", "other", "account-three", "live"),
  ]
  const starts = []
  const runtimes = providers.map((provider) => ({
    account: provider.identity,
    brokerName: provider.providerType,
    connected: true,
    tradingEnabled: true,
    strategyMode: "conservative",
    subscriptions: ["BTCUSDT"],
    stop: async () => { starts.push(`stop:${provider.providerInstanceId}`); return { ok: true } },
  }))

  const runtime = await startProviderAccounts({
    providers,
    start: async (input) => {
      starts.push({
        identity: input.providerIdentity,
        tradingMode: input.env.TRADING_MODE,
        operatorControlEnabled: input.appConfig.operatorControl.telegram.enabled,
        hasOperationalStateStore: input.operationalStateStore !== undefined,
      })
      return runtimes[starts.filter((entry) => typeof entry === "object").length - 1]
    },
    appConfig,
    env: { TRADING_MODE: "testnet", API_KEY: "not-copied" },
    eventPublisher: {},
    runtimeSessionId: "session",
    operationalStateStore: { append() {} },
  })

  assert.equal(starts.filter((entry) => typeof entry === "object").length, 3)
  assert.deepEqual(starts.filter((entry) => typeof entry === "object").map((entry) => entry.tradingMode), [
    "testnet", "testnet", "live",
  ])
  assert.deepEqual(starts.filter((entry) => typeof entry === "object").map((entry) => entry.operatorControlEnabled), [
    true, false, false,
  ])
  assert.deepEqual(starts.filter((entry) => typeof entry === "object").map((entry) => entry.hasOperationalStateStore), [
    true, false, false,
  ])
  assert.equal(runtime.providerAccounts.length, 3)
  assert.deepEqual(runtime.subscriptions, ["BTCUSDT"])
  assert.equal(runtime.connected, true)

  const stopped = await runtime.stop()
  assert.equal(stopped.ok, true)
  assert.deepEqual(starts.slice(-3), [
    "stop:other-live",
    "stop:binance-two",
    "stop:binance-one",
  ])
})

test("keeps healthy account runtimes running when another account fails to start", async () => {
  const stopCalls = []
  const releasedLocks = []
  let startCount = 0
  const runtime = await startProviderAccounts({
    providers: [
      createProvider("first", "binance", "account-one"),
      createProvider("second", "binance", "account-two"),
      createProvider("third", "binance", "account-three"),
    ],
    start: async () => {
      startCount += 1
      if (startCount === 2) {
        throw new Error("second account connection failed")
      }
      const account = startCount === 1 ? "first" : "third"
      return {
        stop: async () => { stopCalls.push(account); return { ok: true } },
      }
    },
    releaseProviderLock: async (providerInstanceId) => {
      releasedLocks.push(providerInstanceId)
      return { ok: true, released: true }
    },
    appConfig,
    env: { TRADING_MODE: "testnet" },
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

  const stopped = await runtime.stop()
  assert.equal(stopped.ok, true)
  assert.deepEqual(stopCalls, ["third", "first"])
})


test("reports failed-account lock cleanup errors without stopping healthy accounts", async () => {
  const startupError = new Error("second account failed")
  const cleanupError = new Error("second account lock cleanup failed")
  const stopped = []
  let startCount = 0
  const runtime = await startProviderAccounts({
    providers: [
      createProvider("first", "binance", "account-one"),
      createProvider("second", "binance", "account-two"),
      createProvider("third", "binance", "account-three"),
    ],
    start: async () => {
      startCount += 1
      if (startCount === 2) {
        throw startupError
      }
      const account = startCount === 1 ? "first" : "third"
      return { stop: async () => { stopped.push(account); return { ok: true } } }
    },
    releaseProviderLock: async (providerInstanceId) => providerInstanceId === "second"
      ? { ok: false, errors: [cleanupError] }
      : { ok: true },
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

test("fails startup when no configured account can start", async () => {
  await assert.rejects(
    startProviderAccounts({
      providers: [createProvider("first", "binance", "account-one")],
      start: async () => { throw new Error("account unavailable") },
      releaseProviderLock: async () => ({ ok: true }),
      appConfig,
      env: { TRADING_MODE: "testnet" },
    }),
    /account unavailable/,
  )
})
