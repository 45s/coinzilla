import assert from "node:assert/strict"
import test from "node:test"

import { Broker } from "../../../index.js"

const credentials = {
  apiKey: "bitunix-futures-settings-test-key",
  apiSecret: "bitunix-futures-settings-test-secret",
}

function response(data) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      code: 0,
      data,
    }),
  }
}

test("Bitunix Futures reads account-wide position mode from the documented private endpoint", async () => {
  const requests = []
  const broker = new Broker({
    provider: "bitunix-futures",
    ...credentials,
    tradingMode: "live",
    providerOptions: {
      dependencies: {
        fetchFn: async (...args) => {
          const [url, options] = args
          requests.push({ url: String(url), options })
          return response({ positionMode: "HEDGE" })
        },
      },
    },
  })

  const result = await broker.getFuturesPositionMode()

  assert.equal(result.ok, true)
  assert.deepEqual(result.data, { positionMode: "HEDGE" })
  assert.equal(new URL(requests[0].url).pathname, "/api/v1/futures/account/position_mode")
  assert.equal(new URL(requests[0].url).search, "")
  assert.equal(requests[0].options.method, "GET")
  assert.equal(Object.hasOwn(requests[0].options.headers, "api-key"), true)
})

test("Bitunix Futures reads symbol leverage and margin mode with explicit USDT margin coin", async () => {
  const requests = []
  const broker = new Broker({
    provider: "bitunix-futures",
    ...credentials,
    tradingMode: "live",
    providerOptions: {
      dependencies: {
        fetchFn: async (...args) => {
          const [url, options] = args
          requests.push({ url: String(url), options })
          return response({
            symbol: "BTCUSDT",
            marginCoin: "USDT",
            leverage: 12,
            marginMode: "ISOLATION",
          })
        },
      },
    },
  })

  const result = await broker.getFuturesLeverageAndMarginMode({
    symbol: "btcusdt",
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.data, {
    symbol: "BTCUSDT",
    marginCoin: "USDT",
    leverage: 12,
    marginMode: "ISOLATION",
  })
  const query = new URL(requests[0].url).searchParams
  assert.equal(new URL(requests[0].url).pathname, "/api/v1/futures/account/get_leverage_margin_mode")
  assert.equal(query.get("symbol"), "BTCUSDT")
  assert.equal(query.get("marginCoin"), "USDT")
})

test("Bitunix Futures rejects malformed account-setting responses and unsupported margin coins", async () => {
  const requests = []
  const broker = new Broker({
    provider: "bitunix-futures",
    ...credentials,
    tradingMode: "live",
    providerOptions: {
      dependencies: {
        fetchFn: async (url) => {
          requests.push(String(url))
          return response({
            symbol: "ETHUSDT",
            marginCoin: "USDT",
            leverage: 0,
            marginMode: "CROSS",
          })
        },
      },
    },
  })

  const malformed = await broker.getFuturesLeverageAndMarginMode({
    symbol: "BTCUSDT",
  })
  assert.equal(malformed.ok, false)

  const unsupported = await broker.getFuturesLeverageAndMarginMode({
    symbol: "BTCUSDT",
    marginCoin: "BTC",
  })
  assert.equal(unsupported.ok, false)
  assert.equal(requests.length, 1)
})
