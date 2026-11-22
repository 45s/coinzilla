import assert from "node:assert/strict"
import test from "node:test"
import {
  createExchangeAccountReaders,
  createExchangeAccountUpdateSubscription,
} from "./create-exchange-account-readers.js"

test("creates immutable readers for a single active provider runtime", async () => {
  const accountSnapshot = {
    ok: true,
    data: {
      balances: [],
    },
  }
  const openOrders = {
    ok: true,
    data: [],
  }
  const runtime = {
    providerInstanceId: "binance-spot",
    providerType: "binance",
    accountId: "primary",
    tradingMode: "testnet",
    environment: "ignored",
    connected: true,
    getExchangeAccountSnapshot: async () => accountSnapshot,
    getExchangeOpenOrders: async () => openOrders,
  }

  const [reader] = createExchangeAccountReaders({ runtime })

  assert.equal(Object.isFrozen(reader), true)
  assert.equal(reader.providerInstanceId, "binance-spot")
  assert.equal(reader.environment, "testnet")
  assert.equal(reader.connected, true)
  assert.equal(await reader.readAccountSnapshot(), accountSnapshot)
  assert.equal(await reader.readOpenOrders(), openOrders)
})

test("filters multi-provider runtimes without both account read capabilities", () => {
  const complete = {
    providerInstanceId: "provider-complete",
    providerType: "binance",
    accountId: "account-1",
    environment: "live",
    connected: false,
    getExchangeAccountSnapshot: () => ({
      ok: true,
      data: {},
    }),
    getExchangeOpenOrders: () => ({
      ok: true,
      data: [],
    }),
  }
  const missingSnapshot = {
    getExchangeOpenOrders: () => ({
      ok: true,
      data: [],
    }),
  }
  const missingOrders = {
    getExchangeAccountSnapshot: () => ({
      ok: true,
      data: {},
    }),
  }

  const readers = createExchangeAccountReaders({
    runtime: {
      accountRuntimes: [complete, missingSnapshot, missingOrders, undefined],
    },
  })

  assert.equal(readers.length, 1)
  assert.equal(readers[0].environment, "live")
  assert.equal(readers[0].connected, false)
  assert.equal(Object.isFrozen(readers), true)
})

test("returns no readers when no provider runtime is supplied", () => {
  assert.deepEqual(createExchangeAccountReaders(), [])
})

test("subscribes and unsubscribes a single provider runtime", () => {
  const calls = []
  const listener = () => calls.push("event")
  const runtime = {
    subscribeExchangeAccountUpdates: (handler) => {
      calls.push("subscribe")
      handler()
      return () => calls.push("unsubscribe")
    },
  }

  const subscribe = createExchangeAccountUpdateSubscription({ runtime })
  const dispose = subscribe(listener)
  dispose()

  assert.deepEqual(calls, ["subscribe", "event", "unsubscribe"])
})

test("aggregates multi-provider subscriptions and disposes them in reverse order", () => {
  const calls = []
  const runtime = {
    accountRuntimes: [
      {
        subscribeExchangeAccountUpdates: () => {
          calls.push("first-subscribe")
          return () => calls.push("first-unsubscribe")
        },
      },
      {},
      {
        subscribeExchangeAccountUpdates: () => {
          calls.push("last-subscribe")
          return () => calls.push("last-unsubscribe")
        },
      },
    ],
  }

  const dispose = createExchangeAccountUpdateSubscription({ runtime })(() => undefined)
  dispose()

  assert.deepEqual(calls, [
    "first-subscribe",
    "last-subscribe",
    "last-unsubscribe",
    "first-unsubscribe",
  ])
})

test("rolls back earlier subscriptions when a later provider subscription throws", () => {
  const calls = []
  const runtime = {
    accountRuntimes: [
      {
        subscribeExchangeAccountUpdates: () => {
          calls.push("first-subscribe")
          return () => calls.push("first-unsubscribe")
        },
      },
      {
        subscribeExchangeAccountUpdates: () => {
          throw new Error("subscription failed")
        },
      },
    ],
  }

  const subscribe = createExchangeAccountUpdateSubscription({ runtime })

  const listener = () => undefined
  assert.throws(() => subscribe(listener), /subscription failed/)
  assert.deepEqual(calls, ["first-subscribe", "first-unsubscribe"])
})

test("ignores providers without a subscription and non-function disposers", () => {
  const runtime = {
    accountRuntimes: [
      {},
      {
        subscribeExchangeAccountUpdates: () => undefined,
      },
    ],
  }
  const dispose = createExchangeAccountUpdateSubscription({ runtime })(() => undefined)

  assert.doesNotThrow(() => dispose())
})
