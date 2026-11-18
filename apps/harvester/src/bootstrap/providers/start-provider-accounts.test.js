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

test("rolls back already-started account runtimes when a later account fails", async () => {
  const stopCalls = []
  let startCount = 0
  await assert.rejects(
    startProviderAccounts({
      providers: [
        createProvider("first", "binance", "account-one"),
        createProvider("second", "binance", "account-two"),
      ],
      start: async () => {
        startCount += 1
        if (startCount === 2) {
          throw new Error("second account connection failed")
        }
        return {
          stop: async () => { stopCalls.push("first"); return { ok: true } },
        }
      },
      appConfig,
      env: { TRADING_MODE: "testnet" },
    }),
    /second account connection failed/,
  )
  assert.deepEqual(stopCalls, ["first"])
})

test("reports startup and account cleanup failures without hiding the original error", async () => {
  const startupError = new Error("second account failed")
  const cleanupError = new Error("first account cleanup failed")
  let startCount = 0
  await assert.rejects(
    startProviderAccounts({
      providers: [
        createProvider("first", "binance", "account-one"),
        createProvider("second", "binance", "account-two"),
      ],
      start: async () => {
        startCount += 1
        if (startCount === 2) {
          throw startupError
        }
        return { stop: async () => { throw cleanupError } }
      },
      appConfig,
      env: { TRADING_MODE: "testnet" },
    }),
    (error) => {
      assert.ok(error instanceof AggregateError)
      assert.equal(error.errors[0], startupError)
      assert.equal(error.errors[1], cleanupError)
      return true
    },
  )
})
