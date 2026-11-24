import assert from "node:assert/strict"
import test from "node:test"

import { Broker } from "../../../index.js"

const credentials = {
  apiKey: "bitunix-futures-balance-test-key",
  apiSecret: "bitunix-futures-balance-test-secret",
}

function createBroker({ rows = [] } = {}) {
  const requests = []
  const broker = new Broker({
    provider: "bitunix-futures",
    ...credentials,
    tradingMode: "live",
    providerOptions: {
      dependencies: {
        fetchFn: async (...args) => {
          const [url, options] = args
          requests.push({
            url: String(url),
            options,
          })
          return {
            ok: true,
            status: 200,
            json: async () => ({
              code: 0,
              data: rows,
            }),
          }
        },
      },
    },
  })
  return {
    broker,
    requests,
  }
}

const balanceRow = {
  marginCoin: "USDT",
  available: "1.000000000000000001",
  frozen: "0.200000000000000002",
  margin: "0.300000000000000003",
  bonus: "999.999999",
}

test("Bitunix Futures getBalances maps available and locked USDT without including bonus", async () => {
  const { broker, requests } = createBroker({
    rows: [balanceRow],
  })
  const result = await broker.getBalances()

  assert.equal(result.ok, true)
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].free.amount, "1.000000000000000001")
  assert.equal(result.data[0].locked.amount, "0.500000000000000005")
  assert.equal(new URL(requests[0].url).pathname, "/api/v1/futures/account")
  assert.equal(new URL(requests[0].url).searchParams.get("marginCoin"), "USDT")
})

test("Bitunix Futures getBalances rejects unsupported margin coins before I/O", async () => {
  const { broker, requests } = createBroker({
    rows: [balanceRow],
  })
  const result = await broker.getBalances({
    marginCoin: "BTC",
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /USDT/i)
  assert.equal(requests.length, 0)
})

test("Bitunix Futures balance adapter rejects duplicate margin accounts", async () => {
  const { broker } = createBroker({
    rows: [balanceRow, balanceRow],
  })
  const result = await broker.getBalances()

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /duplicate USDT/i)
})

test("Bitunix Futures account snapshot and server time remain explicitly unsupported", async () => {
  const { broker, requests } = createBroker()
  const snapshot = await broker.getAccountSnapshot()
  const serverTime = await broker.getServerTime()

  assert.equal(snapshot.ok, false)
  assert.match(snapshot.errors[0].message, /not supported safely/i)
  assert.equal(serverTime.ok, false)
  assert.match(serverTime.errors[0].message, /not supported safely/i)
  assert.equal(requests.length, 0)
})
