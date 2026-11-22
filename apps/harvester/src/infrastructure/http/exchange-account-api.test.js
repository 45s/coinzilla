import assert from "node:assert/strict"
import test from "node:test"
import { handleExchangeAccountRequest } from "./exchange-account-api.js"

function createResponse() {
  return {
    headers: undefined,
    status: undefined,
    body: undefined,
    writeHead(...args) {
      const [status, headers] = args
      this.status = status
      this.headers = headers
    },
    end(value) {
      this.body = JSON.parse(value)
    },
  }
}

test("exchange account list contains only active Harvester provider instances", async () => {
  const response = createResponse()
  const exchangeAccounts = [{
    providerInstanceId: "binance-live",
    providerType: "binance",
    accountId: "primary",
    environment: "live",
    connected: true,
    readAccountSnapshot: async () => ({
      ok: true,
      data: {
        sourceTime: 1,
        balances: [],
      },
    }),
    readOpenOrders: async () => ({
      ok: true,
      data: [],
    }),
  }]

  const handled = await handleExchangeAccountRequest({
    request: { method: "GET" },
    response,
    pathname: "/api/v1/exchanges/accounts",
    exchangeAccounts,
  })

  assert.equal(handled, true)
  assert.equal(response.status, 200)
  assert.deepEqual(response.body.data, [{
    providerInstanceId: "binance-live",
    providerType: "binance",
    accountId: "primary",
    environment: "live",
    connected: true,
  }])
})

test("exchange account detail reads through the existing provider runtime", async () => {
  const response = createResponse()
  const calls = []
  const exchangeAccounts = [{
    providerInstanceId: "binance-live",
    providerType: "binance",
    accountId: "primary",
    environment: "live",
    connected: true,
    readAccountSnapshot: async () => {
      calls.push("snapshot")
      return {
        ok: true,
        data: {
          sourceTime: 123,
          balances: [{
            value: {
              asset: { code: "USDT" },
              free: { amount: "10" },
            },
          }],
        },
      }
    },
    readOpenOrders: async () => {
      calls.push("orders")
      return {
        ok: true,
        data: [{
          value: {
            symbol: "BTCUSDT",
            side: "BUY",
          },
        }],
      }
    },
  }]

  await handleExchangeAccountRequest({
    request: { method: "GET" },
    response,
    pathname: "/api/v1/exchanges/accounts/binance-live",
    exchangeAccounts,
  })

  assert.equal(response.status, 200)
  assert.deepEqual(calls.sort(), ["orders", "snapshot"])
  assert.deepEqual(response.body.data.accountSnapshot, {
    sourceTime: 123,
    balances: [{
      asset: { code: "USDT" },
      free: { amount: "10" },
    }],
  })
  assert.deepEqual(response.body.data.openOrders, [{
    symbol: "BTCUSDT",
    side: "BUY",
  }])
})

test("exchange account detail rejects provider instances not active in Harvester", async () => {
  const response = createResponse()
  await handleExchangeAccountRequest({
    request: { method: "GET" },
    response,
    pathname: "/api/v1/exchanges/accounts/bitunix-live",
    exchangeAccounts: [],
  })
  assert.equal(response.status, 404)
  assert.equal(response.body.error.code, "HARVESTER_EXCHANGE_PROVIDER_NOT_FOUND")
})

test("exchange account API rejects non-read requests", async () => {
  const response = createResponse()
  await handleExchangeAccountRequest({
    request: { method: "POST" },
    response,
    pathname: "/api/v1/exchanges/accounts",
    exchangeAccounts: [],
  })
  assert.equal(response.status, 405)
  assert.equal(response.body.error.code, "HARVESTER_EXCHANGE_METHOD_NOT_ALLOWED")
})

test("unrelated routes are not handled", async () => {
  const response = createResponse()
  const handled = await handleExchangeAccountRequest({
    request: { method: "GET" },
    response,
    pathname: "/api/v1/trading/orders",
    exchangeAccounts: [],
  })
  assert.equal(handled, false)
  assert.equal(response.status, undefined)
})
