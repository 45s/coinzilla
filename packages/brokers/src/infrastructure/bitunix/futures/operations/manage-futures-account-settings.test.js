import assert from "node:assert/strict"
import test from "node:test"

import {
  setFuturesLeverage,
  setFuturesMarginMode,
  setFuturesPositionMode,
} from "./manage-futures-account-settings.js"

const LEVERAGE_PATH = "/api/v1/futures/account/change_leverage"
const MARGIN_MODE_PATH = "/api/v1/futures/account/change_margin_mode"
const POSITION_MODE_PATH = "/api/v1/futures/account/change_position_mode"

function createRestClient({ requests, state, dispatchError }) {
  return {
    request: async (request) => {
      requests.push(request)
      if (request.path === LEVERAGE_PATH) {
        state.leverage = request.body.leverage
      } else if (request.path === MARGIN_MODE_PATH) {
        state.marginMode = request.body.marginMode
      } else if (request.path === POSITION_MODE_PATH) {
        state.positionMode = request.body.positionMode
      }
      if (dispatchError) {
        throw dispatchError
      }
      return {
        data: {},
      }
    },
  }
}

function createBrokerReadMethods({ positions, pendingOrders, pendingTpSl, maximumLeverage, state }) {
  return {
    getFuturesPositions: async () => ({
      ok: true,
      data: positions,
    }),
    getFuturesPendingOrders: async () => ({
      ok: true,
      data: {
        orders: pendingOrders,
        total: pendingOrders.length,
      },
    }),
    getFuturesPendingTpSlOrders: async () => ({
      ok: true,
      data: pendingTpSl,
    }),
    getFuturesPositionTiers: async () => ({
      ok: true,
      data: [{
        leverage: maximumLeverage,
      }],
    }),
    getFuturesLeverageAndMarginMode: async ({ symbol, marginCoin }) => ({
      ok: true,
      data: {
        symbol,
        marginCoin,
        leverage: state.leverage,
        marginMode: state.marginMode,
      },
    }),
    getFuturesPositionMode: async () => ({
      ok: true,
      data: {
        positionMode: state.positionMode,
      },
    }),
  }
}

function createBroker({
  positions = [],
  pendingOrders = [],
  pendingTpSl = [],
  leverage = 10,
  marginMode = "CROSS",
  positionMode = "ONE_WAY",
  maximumLeverage = 100,
  dispatchError,
} = {}) {
  const requests = []
  const state = {
    leverage,
    marginMode,
    positionMode,
  }
  const broker = {
    restClient: createRestClient({
      requests,
      state,
      dispatchError,
    }),
    ...createBrokerReadMethods({
      positions,
      pendingOrders,
      pendingTpSl,
      maximumLeverage,
      state,
    }),
  }
  return {
    broker,
    requests,
    state,
  }
}

test("setFuturesLeverage validates tiers, sends a guarded mutation and confirms readback", async () => {
  const { broker, requests } = createBroker()

  const result = await setFuturesLeverage({
    broker,
    input: {
      symbol: "BTCUSDT",
      leverage: 20,
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.mutationOutcome, "CONFIRMED")
  assert.equal(result.configurationOutcome, "CONFIRMED")
  assert.deepEqual(requests[0], {
    method: "POST",
    path: LEVERAGE_PATH,
    body: {
      symbol: "BTCUSDT",
      marginCoin: "USDT",
      leverage: 20,
    },
    stateChanging: true,
  })
})

test("setFuturesMarginMode does not mutate while an open position exists", async () => {
  const { broker, requests } = createBroker({
    positions: [{
      symbol: "BTCUSDT",
      positionId: "position-1",
    }],
  })

  const result = await setFuturesMarginMode({
    broker,
    input: {
      symbol: "BTCUSDT",
      marginMode: "ISOLATION",
    },
  })

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "NOT_SENT")
  assert.equal(result.configurationOutcome, "NOT_SENT")
  assert.equal(requests.length, 0)
})

test("setFuturesPositionMode does not mutate while pending orders exist", async () => {
  const { broker, requests } = createBroker({
    pendingOrders: [{
      orderId: "order-1",
    }],
  })

  const result = await setFuturesPositionMode({
    broker,
    input: {
      positionMode: "HEDGE",
    },
  })

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "NOT_SENT")
  assert.equal(requests.length, 0)
})

test("setFuturesPositionMode confirms the requested mode after REST readback", async () => {
  const { broker, requests } = createBroker()

  const result = await setFuturesPositionMode({
    broker,
    input: {
      positionMode: "HEDGE",
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.mutationOutcome, "CONFIRMED")
  assert.equal(result.configurationOutcome, "CONFIRMED")
  assert.equal(requests[0].path, POSITION_MODE_PATH)
  assert.deepEqual(requests[0].body, {
    positionMode: "HEDGE",
  })
})

test("setFuturesLeverage preserves an unknown mutation outcome when the readback confirms a lost acknowledgement", async () => {
  const dispatchError = Object.assign(new TypeError("socket closed after dispatch"), {
    outcomeUnknown: true,
  })
  const { broker, requests } = createBroker({
    dispatchError,
  })

  const result = await setFuturesLeverage({
    broker,
    input: {
      symbol: "BTCUSDT",
      leverage: 20,
    },
  })

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "OUTCOME_UNKNOWN")
  assert.equal(result.configurationOutcome, "CONFIRMED")
  assert.equal(requests.length, 1)
})

test("setFuturesLeverage rejects leverage above the highest documented tier before dispatch", async () => {
  const { broker, requests } = createBroker({
    maximumLeverage: 50,
  })

  const result = await setFuturesLeverage({
    broker,
    input: {
      symbol: "BTCUSDT",
      leverage: 51,
    },
  })

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "NOT_SENT")
  assert.equal(requests.length, 0)
})

test("setFuturesLeverage is idempotent when the requested leverage is already active", async () => {
  const { broker, requests } = createBroker({
    leverage: 20,
  })

  const result = await setFuturesLeverage({
    broker,
    input: {
      symbol: "BTCUSDT",
      leverage: 20,
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.mutationOutcome, "NOT_SENT")
  assert.equal(result.configurationOutcome, "ALREADY_SET")
  assert.equal(requests.length, 0)
})
