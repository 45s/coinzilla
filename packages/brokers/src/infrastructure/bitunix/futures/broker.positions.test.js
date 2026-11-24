import assert from "node:assert/strict"
import test from "node:test"

import { Broker } from "../../../index.js"

const credentials = {
  apiKey: "bitunix-futures-position-test-key",
  apiSecret: "bitunix-futures-position-test-secret",
}

const currentPosition = {
  positionId: "position-123",
  subAccountId: 987,
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
  subAccountId: 321,
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
  liqPrice: "-1",
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
  allowLivePositionMutations = false,
  afterClose,
  closeError,
  closeAcceptedOnError = false,
} = {}) {
  const requests = []
  let currentState = [...current]
  const applyCloseState = ({ positionId, symbol }) => {
    if (afterClose !== undefined) {
      currentState = [...afterClose]
      return
    }
    currentState = currentState.filter((position) => {
      if (positionId !== undefined) {
        return position.positionId !== positionId
      }
      return symbol !== undefined && position.symbol !== symbol
    })
  }
  const broker = new Broker({
    provider: "bitunix-futures",
    ...credentials,
    tradingMode: "live",
    providerOptions: {
      allowLivePositionMutations,
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
              data: currentState,
            })
          }
          if (path === "/api/v1/futures/trade/flash_close_position") {
            const body = JSON.parse(options.body)
            if (closeError) {
              if (closeAcceptedOnError) {
                applyCloseState({
                  positionId: body.positionId,
                })
              }
              throw closeError
            }
            applyCloseState({
              positionId: body.positionId,
            })
            return createResponse({
              data: {
                positionId: body.positionId,
              },
            })
          }
          if (path === "/api/v1/futures/trade/close_all_position") {
            const body = JSON.parse(options.body)
            if (closeError) {
              if (closeAcceptedOnError) {
                applyCloseState({
                  symbol: body.symbol,
                })
              }
              throw closeError
            }
            applyCloseState({
              symbol: body.symbol,
            })
            return createResponse({
              data: [],
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

test("Bitunix Futures closeFuturesPosition closes one exact position and verifies REST readback", async () => {
  const { broker, requests } = createBroker({
    allowLivePositionMutations: true,
    current: [currentPosition],
    afterClose: [],
  })

  const result = await broker.closeFuturesPosition({
    positionId: "position-123",
    symbol: "BTCUSDT",
  })

  assert.equal(result.ok, true)
  assert.equal(result.mutationOutcome, "CONFIRMED")
  assert.equal(result.positionOutcome, "CLOSED")
  const closeRequest = requests.find(({ url }) => new URL(url).pathname === "/api/v1/futures/trade/flash_close_position")
  assert.deepEqual(JSON.parse(closeRequest.options.body), {
    positionId: "position-123",
  })
  assert.equal(requests.filter(({ url }) => new URL(url).pathname === "/api/v1/futures/position/get_pending_positions").length, 2)
})

test("Bitunix Futures position mutations are disabled by default", async () => {
  const { broker, requests } = createBroker({
    current: [currentPosition],
  })

  const result = await broker.closeFuturesPosition({
    positionId: "position-123",
  })

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "NOT_SENT")
  assert.equal(result.positionOutcome, "NOT_SENT")
  assert.equal(requests.length, 0)
})

test("Bitunix Futures closeFuturesPosition treats an already-closed position as an idempotent no-op", async () => {
  const { broker, requests } = createBroker({
    allowLivePositionMutations: true,
    current: [],
  })

  const result = await broker.closeFuturesPosition({
    positionId: "position-123",
  })

  assert.equal(result.ok, true)
  assert.equal(result.mutationOutcome, "NOT_SENT")
  assert.equal(result.positionOutcome, "ALREADY_CLOSED")
  assert.equal(requests.some(({ options }) => options.method === "POST"), false)
})

test("Bitunix Futures closeFuturesPosition preserves a lost acknowledgement when REST readback confirms closure", async () => {
  const { broker, requests } = createBroker({
    allowLivePositionMutations: true,
    current: [currentPosition],
    afterClose: [],
    closeError: new TypeError("socket closed after dispatch"),
    closeAcceptedOnError: true,
  })

  const result = await broker.closeFuturesPosition({
    positionId: "position-123",
    symbol: "BTCUSDT",
  })

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "OUTCOME_UNKNOWN")
  assert.equal(result.positionOutcome, "CLOSED")
  assert.ok(result.errors.length > 0)
  assert.equal(requests.filter(({ options }) => options.method === "POST").length, 1)
})

test("Bitunix Futures closeFuturesPosition reports an open position when REST readback does not confirm closure", async () => {
  const { broker } = createBroker({
    allowLivePositionMutations: true,
    current: [currentPosition],
    afterClose: [currentPosition],
  })

  const result = await broker.closeFuturesPosition({
    positionId: "position-123",
  })

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "OUTCOME_UNKNOWN")
  assert.equal(result.positionOutcome, "OPEN")
})

test("Bitunix Futures closeFuturesPositionBySide resolves exactly one position side", async () => {
  const { broker, requests } = createBroker({
    allowLivePositionMutations: true,
    current: [currentPosition],
    afterClose: [],
  })

  const result = await broker.closeFuturesPositionBySide({
    symbol: "BTCUSDT",
    side: "LONG",
  })

  assert.equal(result.ok, true)
  assert.equal(result.positionOutcome, "CLOSED")
  const closeRequest = requests.find(({ url }) => new URL(url).pathname === "/api/v1/futures/trade/flash_close_position")
  assert.deepEqual(JSON.parse(closeRequest.options.body), {
    positionId: "position-123",
  })
})

test("Bitunix Futures closeFuturesPositionBySide refuses ambiguous position identities", async () => {
  const { broker, requests } = createBroker({
    allowLivePositionMutations: true,
    current: [
      currentPosition,
      {
        ...currentPosition,
        positionId: "position-456",
      },
    ],
  })

  const result = await broker.closeFuturesPositionBySide({
    symbol: "BTCUSDT",
    side: "LONG",
  })

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "NOT_SENT")
  assert.equal(requests.some(({ options }) => options.method === "POST"), false)
})

test("Bitunix Futures closeAllFuturesPositions requires explicit confirmation for account-wide scope", async () => {
  const { broker, requests } = createBroker({
    allowLivePositionMutations: true,
    current: [currentPosition],
  })

  const result = await broker.closeAllFuturesPositions()

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "NOT_SENT")
  assert.equal(requests.length, 0)
})

test("Bitunix Futures closeAllFuturesPositions closes only the requested symbol and verifies the final scope", async () => {
  const otherPosition = {
    ...currentPosition,
    positionId: "position-eth-123",
    symbol: "ETHUSDT",
  }
  const { broker, requests } = createBroker({
    allowLivePositionMutations: true,
    current: [currentPosition, otherPosition],
    afterClose: [otherPosition],
  })

  const result = await broker.closeAllFuturesPositions({
    symbol: "BTCUSDT",
  })

  assert.equal(result.ok, true)
  assert.equal(result.mutationOutcome, "CONFIRMED")
  assert.equal(result.positionOutcome, "CLOSED")
  const closeRequest = requests.find(({ url }) => new URL(url).pathname === "/api/v1/futures/trade/close_all_position")
  assert.deepEqual(JSON.parse(closeRequest.options.body), {
    symbol: "BTCUSDT",
  })
})

test("Bitunix Futures closeAllFuturesPositions requires explicit account-wide confirmation", async () => {
  const { broker, requests } = createBroker({
    allowLivePositionMutations: true,
    current: [currentPosition],
    afterClose: [],
  })

  const result = await broker.closeAllFuturesPositions({
    confirmAccountWideClose: true,
  })

  assert.equal(result.ok, true)
  assert.equal(result.positionOutcome, "CLOSED")
  const closeRequest = requests.find(({ url }) => new URL(url).pathname === "/api/v1/futures/trade/close_all_position")
  assert.deepEqual(JSON.parse(closeRequest.options.body), {})
})

test("Bitunix Futures getFuturesPositions returns exact current position facts and excludes subaccounts by default", async () => {
  const { broker, requests } = createBroker()
  const result = await broker.getFuturesPositions({
    symbol: "btcusdt",
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.length, 1)
  assert.deepEqual(result.data[0], {
    positionId: "position-123",
    subAccountId: 987,
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
    subAccountId: 321,
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
    liquidationPrice: "-1",
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
