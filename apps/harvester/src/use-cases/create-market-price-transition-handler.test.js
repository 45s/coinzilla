import test from "node:test"
import assert from "node:assert/strict"
import { createMarketPriceTransitionHandler } from "./create-market-price-transition-handler.js"

const activeBuyOrder = Object.freeze({
  side: "BUY",
  value: Object.freeze({
    clientOrderId: "harvester-market-price-test-buy",
  }),
})

function createHarness({
  isFresh = true,
  canTrade = true,
  paused = false,
  operatorPaused = false,
  trailingBuyEnabled = true,
  activeOrders = [activeBuyOrder],
  initialPrice,
  initialEventId,
} = {}) {
  const trace = []
  const state = {
    prices: new Map(),
    marketPriceEventIds: new Map(),
    lastBuyPrices: new Map(),
    buyReferenceOverrides: new Map(),
    lastAdjustmentPrices: new Map(),
    paused: new Set(),
    operatorPausedMarkets: new Set(),
    trailingBuy: new Map([["DOGEUSDT", trailingBuyEnabled]]),
    registry: {
      getActiveOrders: () => activeOrders,
    },
  }

  if (initialPrice) {
    state.prices.set("DOGEUSDT", initialPrice)
  }
  if (initialEventId !== undefined) {
    state.marketPriceEventIds.set("DOGEUSDT", initialEventId)
  }
  if (paused) {
    state.paused.add("DOGEUSDT")
  }
  if (operatorPaused) {
    state.operatorPausedMarkets.add("DOGEUSDT")
  }

  const handler = createMarketPriceTransitionHandler({
    state,
    isMarketPriceFresh: () => {
      trace.push("freshness")
      return isFresh
    },
    getCurrentMarketMetadata: () => ({
      market: {
        id: "doge-market",
      },
    }),
    logger: {
      debug: ({ message } = {}) => {
        if (message === "Harvester market price event received") {
          trace.push("received")
        }
        if (message === "Harvester market price event skipped") {
          trace.push("stale")
        }
      },
    },
    getPortfolio: () => ({
      value: {
        snapshot: "portfolio",
      },
    }),
    getRecoveryLedger: () => ({
      value: {
        snapshot: "recovery-ledger",
      },
    }),
    canTrade: () => canTrade,
    maybeReplaceTrailingBuy: async () => {
      assert.equal(
        state.prices.get("DOGEUSDT")?.price,
        "100.25",
        "The accepted market price must be committed before trailing replacement is invoked.",
      )
      assert.equal(
        state.marketPriceEventIds.get("DOGEUSDT"),
        8,
        "The accepted event identity must be committed before trailing replacement is invoked.",
      )
      trace.push("trailing-buy")
      return {
        ok: true,
        data: {
          route: "trailing-buy",
        },
      }
    },
    evaluateLatestTransition: async () => {
      assert.equal(
        state.prices.get("DOGEUSDT")?.price,
        "100.25",
        "The accepted market price must be committed before normal strategy evaluation is invoked.",
      )
      assert.equal(
        state.marketPriceEventIds.get("DOGEUSDT"),
        8,
        "The accepted event identity must be committed before normal strategy evaluation is invoked.",
      )
      trace.push("evaluate")
      return {
        ok: true,
        data: {
          route: "evaluate",
        },
      }
    },
    nextMarketPriceEventId: () => {
      trace.push("event-id")
      return 8
    },
  })

  return {
    handler,
    state,
    trace,
  }
}

const validPriceEvent = Object.freeze({
  symbol: "DOGEUSDT",
  price: "100.25",
  timestamp: 123,
})

test("logs a received stale price before freshness rejection and preserves the accepted cache", async () => {
  const previousPrice = Object.freeze({
    symbol: "DOGEUSDT",
    price: "100.10",
    timestamp: 122,
  })
  const harness = createHarness({
    isFresh: false,
    initialPrice: previousPrice,
    initialEventId: 7,
  })

  const result = await harness.handler({
    symbol: "DOGEUSDT",
    priceEvent: validPriceEvent,
  })

  assert.equal(result.ok, true, "A stale market-price event must be reported as a safe skip rather than an engine failure.")
  assert.equal(result.data.skipped, true, "A stale market-price event must terminate before accepted-price processing.")
  assert.equal(result.data.reason, "STALE_MARKET_PRICE", "The stale-price skip must retain its stable diagnostic reason.")
  assert.deepEqual(
    harness.trace,
    ["event-id", "received", "freshness", "stale"],
    "The event identity and receipt diagnostic must precede the freshness decision, with stale diagnostics emitted before returning.",
  )
  assert.equal(
    harness.state.prices.get("DOGEUSDT"),
    previousPrice,
    "A stale event must not replace the previously accepted immutable market price.",
  )
  assert.equal(
    harness.state.marketPriceEventIds.get("DOGEUSDT"),
    7,
    "A stale event must not replace the identity associated with the previously accepted market price.",
  )
})

test("commits a fresh price before delegating an eligible active BUY to trailing replacement", async () => {
  const harness = createHarness()

  const result = await harness.handler({
    symbol: "DOGEUSDT",
    priceEvent: validPriceEvent,
  })

  assert.equal(result.ok, true, "A fresh market-price event with an eligible active BUY must complete through the trailing replacement workflow.")
  assert.equal(result.data.route, "trailing-buy", "An eligible active BUY must retain the existing trailing replacement dispatch.")
  assert.deepEqual(
    harness.trace,
    ["event-id", "received", "freshness", "trailing-buy"],
    "The accepted event must be logged, checked for freshness, committed, and only then dispatched to trailing replacement.",
  )
  assert.equal(
    harness.state.prices.get("DOGEUSDT").price,
    "100.25",
    "The trailing replacement workflow must observe the exact accepted decimal-string price.",
  )
  assert.equal(
    harness.state.marketPriceEventIds.get("DOGEUSDT"),
    8,
    "The accepted market-price event identity must be committed before trailing replacement begins.",
  )
})

const evaluationOnlyScenarios = [
  {
    name: "broker readiness is closed",
    canTrade: false,
  },
  {
    name: "the strategy market is paused",
    paused: true,
  },
  {
    name: "the operator has paused the market",
    operatorPaused: true,
  },
  {
    name: "trailing BUY is disabled",
    trailingBuyEnabled: false,
  },
  {
    name: "there is no active BUY order",
    activeOrders: [],
  },
]

for (const scenario of evaluationOnlyScenarios) {
  test("routes an accepted price to normal evaluation when " + scenario.name, async () => {
    const harness = createHarness(scenario)

    const result = await harness.handler({
      symbol: "DOGEUSDT",
      priceEvent: validPriceEvent,
    })

    assert.equal(result.ok, true, "A fresh price must continue through the existing evaluator when " + scenario.name + ".")
    assert.equal(result.data.route, "evaluate", "The normal latest-transition evaluator must remain the fallback when " + scenario.name + ".")
    assert.equal(
      harness.trace.includes("trailing-buy"),
      false,
      "Trailing replacement must not run when " + scenario.name + ".",
    )
    assert.equal(
      harness.trace.includes("evaluate"),
      true,
      "The accepted price must still reach normal strategy evaluation when " + scenario.name + ".",
    )
  })
}

test("returns a validation error for a subscription-symbol mismatch before allocating an event identity", async () => {
  const harness = createHarness()
  const result = await harness.handler({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "ETHUSDT",
      price: "100.25",
      timestamp: 123,
    },
  })

  assert.equal(result.ok, false, "A market-price event for a different subscription symbol must fail closed.")
  assert.match(
    result.errors[0].message,
    /symbol does not match subscription/,
    "The validation result must explain that the normalized event does not belong to the subscribed market.",
  )
  assert.deepEqual(
    harness.trace,
    [],
    "A symbol-mismatched event must not allocate an event identity, emit accepted-event diagnostics, or dispatch a strategy transition.",
  )
})
