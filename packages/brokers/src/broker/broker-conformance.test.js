import assert from "node:assert/strict"
import test from "node:test"

import { Balance } from "@coinzilla/entities"
import { BrokerCapabilities } from "./broker-capabilities.js"
import { BrokerUnsupportedOperationError } from "./errors/broker-unsupported-operation-error.js"
import { assertBrokerContract } from "./broker-contract.js"
import { Broker } from "../index.js"

const PRICE = "123.45000000"
const FREE_BALANCE = "0.00000001"
const LOCKED_BALANCE = "0.00000002"
const ORDER_RESPONSE = {
  symbol: "BTCUSDT",
  orderId: 123,
  clientOrderId: "client-123",
  side: "BUY",
  type: "LIMIT",
  status: "PARTIALLY_FILLED",
  price: "100.00000000",
  origQty: "1.00000000",
  executedQty: "0.25000000",
  time: 1_700_000_000_000,
  updateTime: 1_700_000_001_000,
}

function createBinanceApiClient({ calls }) {
  return {
    async request(...args) {
      const [method, params] = args
      calls.push({
        method,
        params,
      })
      if (method === "ticker.price") {
        return {
          data: {
            symbol: params.symbol,
            price: PRICE,
          },
        }
      }
      if (method === "account.status") {
        return {
          data: {
            balances: [{
              asset: "BTC",
              free: FREE_BALANCE,
              locked: LOCKED_BALANCE,
            }],
          },
        }
      }
      if (method === "order.status") {
        return { data: ORDER_RESPONSE }
      }
      if (method === "exchangeInfo") {
        return {
          data: {
            symbols: [{
              symbol: "BTCUSDT",
              baseAsset: "BTC",
              quoteAsset: "USDT",
            }],
          },
        }
      }
      throw new Error(`Unexpected offline Binance RPC: ${method}`)
    },
    async connect() {},
    async disconnect() {},
  }
}

function createBinanceBroker() {
  const calls = []
  const subscriptionCalls = []
  const broker = new Broker({
    provider: "binance",
    apiKey: "offline-contract-key",
    apiSecret: "offline-contract-secret",
    tradingMode: "testnet",
    providerOptions: {
      dependencies: {
        apiClientFactory: () => createBinanceApiClient({ calls }),
        marketClientFactory: () => ({
          async disconnect() {},
          async subscribe(...args) {
            subscriptionCalls.push({
              action: "subscribe",
              args,
            })
          },
          async unsubscribe(...args) {
            subscriptionCalls.push({
              action: "unsubscribe",
              args,
            })
          },
        }),
        logger: {
          error() {},
          warn() {},
          info() {},
        },
        setTimeoutFn: () => 1,
        clearTimeoutFn: () => {},
      },
    },
  })
  return {
    broker,
    calls,
    subscriptionCalls,
  }
}

function createBitunixBroker() {
  const calls = []
  const broker = new Broker({
    provider: "bitunix",
    apiKey: "offline-contract-key",
    apiSecret: "offline-contract-secret",
    tradingMode: "live",
    providerOptions: {
      dependencies: {
        restClientFactory: () => ({
          async request(input) {
            calls.push(input)
            if (input.queryParams?.symbol) {
              return { data: PRICE }
            }
            return {
              data: [{
                coin: "BTC",
                balance: FREE_BALANCE,
                balanceLocked: LOCKED_BALANCE,
              }],
            }
          },
        }),
      },
    },
  })
  return {
    broker,
    calls,
  }
}

async function assertPriceContract({ broker }) {
  const prices = await broker.getPrices({ symbol: "BTCUSDT" })
  assert.equal(prices.ok, true)
  assert.deepEqual(prices.data, {
    symbol: "BTCUSDT",
    price: PRICE,
  })

  const legacyPrice = await broker.getPrice({ symbol: "BTCUSDT" })
  assert.equal(legacyPrice.ok, true)
  assert.deepEqual(legacyPrice.data, prices.data)
}

async function assertCanonicalOrderContract({ broker, supported }) {
  const result = await broker.getCanonicalOrder({
    symbol: "BTCUSDT",
    orderId: 123,
  })

  if (!supported) {
    assert.equal(result.ok, false)
    assert.ok(result.errors[0] instanceof BrokerUnsupportedOperationError)
    assert.equal(result.errors[0].code, "BROKER_OPERATION_UNSUPPORTED")
    return
  }

  assert.equal(result.ok, true)
  assert.equal(result.data.clientOrderId, "client-123")
  assert.equal(result.data.brokerOrderId, "123")
  assert.equal(result.data.createdAt, 1700000000000)
  assert.equal(result.data.updatedAt, 1700000001000)
  assert.equal(result.data.originalQuantity.amount, "1")
  assert.equal(result.data.limitPrice.amount, "100")
}

async function assertSubscriptionContract({
  broker,
  provider,
  supported,
  subscriptionCalls = [],
}) {
  const result = await broker.subscribeForPrices({
    symbol: "BTCUSDT",
    onPrice() {},
  })

  if (!supported) {
    assert.equal(result.ok, false)
    assert.ok(result.errors[0] instanceof BrokerUnsupportedOperationError)
    assert.equal(subscriptionCalls.length, 0)
    return
  }

  assert.equal(result.ok, true)
  assert.equal(typeof result.data.unsubscribe, "function")
  assert.equal(
    subscriptionCalls.filter(({ action }) => action === "subscribe").length,
    2,
  )

  await result.data.unsubscribe()
  await result.data.unsubscribe()
  assert.equal(
    subscriptionCalls.filter(({ action }) => action === "unsubscribe").length,
    2,
    `${provider} subscription cleanup must be idempotent`,
  )
}

async function assertBalanceContract({ broker }) {
  const balances = await broker.getBalances()
  assert.equal(balances.ok, true)
  assert.equal(balances.data.length, 1)
  assert.ok(balances.data[0] instanceof Balance)
  assert.equal(balances.data[0].free.amount, FREE_BALANCE)
  assert.equal(balances.data[0].locked.amount, LOCKED_BALANCE)
  assert.equal(balances.data[0].total.amount, "0.00000003")
}

async function assertUnsupportedOperations({ broker, calls, provider, operations }) {
  const requestCountBeforeUnsupported = calls.length
  for (const operation of operations) {
    const result = await broker[operation.method](...operation.args)

    assert.equal(result.ok, false, `${provider} ${operation.method} must not report unsupported work as success`)
    assert.ok(
      result.errors[0] instanceof BrokerUnsupportedOperationError,
      `${provider} ${operation.method} must return BrokerUnsupportedOperationError`,
    )
    assert.equal(result.errors[0].code, "BROKER_OPERATION_UNSUPPORTED")
    assert.equal(result.errors[0].context.provider, provider)
    assert.equal(result.errors[0].context.operation, operation.method)
    if (operation.mutation) {
      assert.equal(result.mutationOutcome, "NOT_SENT")
    }
  }
  assert.equal(calls.length, requestCountBeforeUnsupported)
}

function runBrokerConformanceSuite({
  provider,
  createBroker,
  unsupportedOperations,
  canonicalOrderSupported,
  subscriptionSupport,
}) {
  test(`${provider} satisfies the shared offline Broker contract`, async () => {
    const {
      broker,
      calls,
      subscriptionCalls,
    } = createBroker()

    assert.equal(assertBrokerContract({ broker }), broker)
    assert.ok(broker.capabilities instanceof BrokerCapabilities)
    assert.equal(broker.capabilities.provider, provider)
    assert.equal(Object.isFrozen(broker.capabilities), true)

    await assertPriceContract({ broker })
    await assertBalanceContract({ broker })
    await assertCanonicalOrderContract({
      broker,
      supported: canonicalOrderSupported,
    })
    await assertSubscriptionContract({
      broker,
      provider,
      supported: subscriptionSupport,
      subscriptionCalls,
    })
    await assertUnsupportedOperations({
      broker,
      calls,
      provider,
      operations: unsupportedOperations,
    })

    await broker.disconnect()
    await broker.disconnect()
  })
}

runBrokerConformanceSuite({
  provider: "binance",
  createBroker: createBinanceBroker,
  canonicalOrderSupported: true,
  subscriptionSupport: true,
  unsupportedOperations: [],
})

runBrokerConformanceSuite({
  provider: "bitunix",
  createBroker: createBitunixBroker,
  subscriptionSupport: false,
  unsupportedOperations: [
    {
      method: "getAccountSnapshot",
      args: [],
    },
    {
      method: "getServerTime",
      args: [],
    },
    {
      method: "getCanonicalOrderHistory",
      args: [{
        symbol: "BTCUSDT",
      }],
    },
    {
      method: "getFills",
      args: [{
        symbol: "BTCUSDT",
      }],
    },
    {
      method: "getCandles",
      args: [{
        symbol: "BTCUSDT",
        interval: "1m",
      }],
    },
    {
      method: "getMyTrades",
      args: [{
        symbol: "BTCUSDT",
      }],
    },
    {
      method: "getOrder",
      args: [{
        symbol: "BTCUSDT",
        clientOrderId: "client-1",
      }],
    },
    {
      method: "createCanonicalOrder",
      args: [],
      mutation: true,
    },
    {
      method: "subscribeForPrices",
      args: [{
        symbol: "BTCUSDT",
        callback() {},
      }],
    },
    {
      method: "subscribeForCandles",
      args: [{
        symbol: "BTCUSDT",
        interval: "1m",
        callback() {},
      }],
    },
    {
      method: "subscribeForBookTicker",
      args: [{
        symbol: "BTCUSDT",
        callback() {},
      }],
    },
    {
      method: "subscribeForUserData",
      args: [],
    },
  ],
})
