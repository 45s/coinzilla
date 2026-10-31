import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it } from "node:test"
import { BinanceSdkBroker } from "./broker.js"

if (process.env.NODE_ENV === "production") {
  throw new Error("Refusing to run Binance user-data integration tests in production")
}

const apiKey = process.env.BINANCE_API_KEY
const apiSecret = process.env.BINANCE_API_SECRET_KEY
const hasTestnetCredentials =
  Boolean(apiKey) &&
  Boolean(apiSecret) &&
  !/replace-with|mock/i.test(apiKey) &&
  !/replace-with|mock/i.test(apiSecret)

const symbol = process.env.BINANCE_TESTNET_SYMBOL || "BTCUSDT"
const eventTimeoutMs = Number(process.env.BINANCE_TESTNET_EVENT_TIMEOUT_MS || 60_000)
if (!Number.isSafeInteger(eventTimeoutMs) || eventTimeoutMs < 1_000) {
  throw new RangeError("BINANCE_TESTNET_EVENT_TIMEOUT_MS must be an integer of at least 1000")
}

async function waitForStatus(statuses, type, startIndex = 0, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const recent = statuses.slice(startIndex)
    const status = recent.find((item) => item.type === type)
    if (status) return status
    const failure = recent.find((item) => item.type === "recoveryFailed")
    if (failure) throw new Error("Binance user-data recovery exhausted its retry budget")
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for Binance user-data status: ${type}`)
}

async function waitForEvent(events, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (events.length > 0) return events[0]
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error("Timed out waiting for a Binance TESTNET user-data event")
}

describe(
  "Binance user-data recovery integration (TESTNET only)",
  { skip: !hasTestnetCredentials && "Set non-placeholder Binance TESTNET credentials to run these tests" },
  () => {
    let broker
    let subscription

    beforeEach(async () => {
      broker = new BinanceSdkBroker({
        apiKey,
        apiSecret,
        reconnectDelay: 250,
      })

      assert.match(
        broker.config.websocketApiUrl,
        /testnet\.binance\.vision/,
        "User-data integration tests must never connect to production",
      )

      await broker.connect()
    })

    afterEach(async () => {
      try {
        await subscription?.disconnect()
      } finally {
        await broker?.disconnect()
        subscription = null
        broker = null
      }
    })

    it("re-subscribes after socket loss and stays fail-closed until snapshots are reconciled", async () => {
      const statuses = []
      const result = await broker.subscribeForUserData({
        onEvent() {},
        onStatus: (status) => statuses.push(status),
      })

      assert.equal(result.ok, true)
      subscription = result.data
      const initialSubscriptionId = subscription.subscriptionId
      assert.ok(Number.isSafeInteger(initialSubscriptionId))

      const initialSubscriptions = await broker.tradingConnection.request("session.subscriptions")
      assert.ok(Array.isArray(initialSubscriptions.data))
      assert.ok(initialSubscriptions.data.some(
        (item) => item.subscriptionId === initialSubscriptionId,
      ))

      const statusStart = statuses.length
      const recovered = waitForStatus(statuses, "recovered", statusStart)
      await broker.tradingConnection.disconnect()
      await recovered

      assert.notEqual(subscription.subscriptionId, initialSubscriptionId)
      assert.equal(broker.connected, true)
      assert.equal(broker.userDataUnavailable, true)

      const assets = await broker.getAssets()
      const openOrders = await broker.getOpenOrders()
      const orderHistory = await broker.getOrderHistory({ symbol, limit: 1000 })
      const trades = await broker.getMyTrades({ symbol, limit: 1000 })

      assert.equal(assets.ok, true, "account snapshot must succeed before reconciliation")
      assert.equal(openOrders.ok, true, "open-order snapshot must succeed before reconciliation")
      assert.equal(orderHistory.ok, true, "order history lookup must succeed before reconciliation")
      assert.equal(trades.ok, true, "trade history lookup must succeed before reconciliation")

      assert.equal(broker.userDataUnavailable, true, "resubscription alone must not enable trading")
      assert.equal(subscription.acknowledgeRecovery(), true)
      assert.equal(broker.userDataUnavailable, false)
    })

    it(
      "receives a live user-data event when testnet activity is generated externally",
      {
        skip: process.env.BINANCE_TESTNET_EXPECT_USER_DATA_EVENT !== "1" &&
          "Set BINANCE_TESTNET_EXPECT_USER_DATA_EVENT=1 and generate testnet account/order activity while this test runs",
      },
      async () => {
        const events = []
        const result = await broker.subscribeForUserData({
          onEvent: (payload) => events.push(payload),
        })
        assert.equal(result.ok, true)
        subscription = result.data

        const event = await waitForEvent(events, eventTimeoutMs)
        assert.ok(event.event && typeof event.event === "object")
        assert.notEqual(event.event.eventType, "eventStreamTerminated")
      },
    )
  },
)
