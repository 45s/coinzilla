import assert from "node:assert/strict"
import test from "node:test"

import { Broker } from "../../../index.js"

const credentials = {
  apiKey: "bitunix-futures-position-test-key",
  apiSecret: "bitunix-futures-position-test-secret",
}

const currentPosition = {
  positionId: "position-123",
  symbol: "BTCUSDT",
  qty: "0.250000000000000001",
  entryValue: "16250.000000000000065",
  side: "LONG",
  positionMode: "HEDGE",
  marginMode: "ISOLATION",
  leverage: 10,
  fee: "0.125",
  funding: "-0.001",
  realizedPNL: "1.25",
  margin: "1625.0000000000000065",
  unrealizedPNL: "2.50",
  liqPrice: "52000.00",
  marginRate: "0.0125",
  avgOpenPrice: "65000.00000000000001",
  ctime: 1_700_000_000_000,
  mtime: 1_700_000_001_000,
}

const historicalPosition = {
  positionId: "position-closed-123",
  symbol: "BTCUSDT",
  maxQty: "0.5",
  entryPrice: "60000.10",
  closePrice: "61000.20",
  liqQty: "0",
  side: "SHORT",
  positionMode: "ONE_WAY",
  marginMode: "CROSS",
  leverage: 5,
  fee: "0.05",
  funding: "-0.01",
  realizedPNL: "-500.05",
  liqPrice: "0",
  ctime: 1_700_000_000_000,
  mtime: 1_700_000_002_000,
}

function createResponse({ data }) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      code: 0,
      data,
    }),
  }
}

function createBroker({
  current = [currentPosition],
  history = {
    positionList: [historicalPosition],
    total: 1,
  },
} = {}) {
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
          const path = new URL(url).pathname
          if (path === "/api/v1/futures/position/get_pending_positions") {
            return createResponse({
              data: current,
            })
          }
          if (path === "/api/v1/futures/position/get_history_positions") {
            return createResponse({
              data: history,
            })
          }
          throw new Error(`Unexpected Futures request: ${path}`)
        },
      },
    },
  })
  return {
    broker,
    requests,
  }
}

test("Bitunix Futures getFuturesPositions returns exact current position facts and excludes subaccounts by default", async () => {
  const { broker, requests } = createBroker()
  const result = await broker.getFuturesPositions({
    symbol: "btcusdt",
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.length, 1)
  assert.deepEqual(result.data[0], {
    positionId: "position-123",
    symbol: "BTCUSDT",
    quantity: "0.250000000000000001",
    entryValue: "16250.000000000000065",
    side: "LONG",
    positionMode: "HEDGE",
    marginMode: "ISOLATION",
    leverage: 10,
    fee: "0.125",
    funding: "-0.001",
    realizedPNL: "1.25",
    margin: "1625.0000000000000065",
    unrealizedPNL: "2.50",
    liquidationPrice: "52000.00",
    marginRate: "0.0125",
    entryPrice: "65000.00000000000001",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_001_000,
    lifecycle: "CURRENT",
  })
  const [request] = requests
  const query = new URL(request.url).searchParams
  assert.equal(new URL(request.url).pathname, "/api/v1/futures/position/get_pending_positions")
  assert.equal(query.get("symbol"), "BTCUSDT")
  assert.equal(query.get("includeSubAccounts"), "false")
  assert.equal(request.options.method, "GET")
  assert.equal(Object.hasOwn(request.options.headers, "api-key"), true)
})

test("Bitunix Futures getFuturesPositionHistory returns one exact paginated history page", async () => {
  const { broker, requests } = createBroker()
  const result = await broker.getFuturesPositionHistory({
    symbol: "BTCUSDT",
    startTime: 1_699_999_000_000,
    endTime: 1_700_001_000_000,
    limit: 50,
    skip: 100,
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.total, 1)
  assert.equal(result.data.positions.length, 1)
  assert.deepEqual(result.data.positions[0], {
    positionId: "position-closed-123",
    symbol: "BTCUSDT",
    quantity: "0.5",
    entryPrice: "60000.10",
    closePrice: "61000.20",
    liquidatedQuantity: "0",
    side: "SHORT",
    positionMode: "ONE_WAY",
    marginMode: "CROSS",
    leverage: 5,
    fee: "0.05",
    funding: "-0.01",
    realizedPNL: "-500.05",
    liquidationPrice: "0",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_002_000,
    lifecycle: "HISTORICAL",
  })
  const [request] = requests
  const query = new URL(request.url).searchParams
  assert.equal(new URL(request.url).pathname, "/api/v1/futures/position/get_history_positions")
  assert.equal(query.get("symbol"), "BTCUSDT")
  assert.equal(query.get("startTime"), "1699999000000")
  assert.equal(query.get("endTime"), "1700001000000")
  assert.equal(query.get("limit"), "50")
  assert.equal(query.get("skip"), "100")
})

test("Bitunix Futures position reads reject malformed exchange decimals and invalid history bounds", async () => {
  const { broker, requests } = createBroker({
    current: [{
      ...currentPosition,
      unrealizedPNL: "not-a-decimal",
    }],
  })
  const current = await broker.getFuturesPositions({ symbol: "BTCUSDT" })
  assert.equal(current.ok, false)

  const history = await broker.getFuturesPositionHistory({
    symbol: "BTCUSDT",
    startTime: 20,
    endTime: 10,
  })
  assert.equal(history.ok, false)
  assert.equal(requests.length, 1)
})
