import assert from "node:assert/strict"
import test from "node:test"
import { Asset, Market, Money, Quantity, TradingRules } from "@coinzilla/entities"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { RecoveryLedger } from "../domain/strategies/conservative/recovery-ledger.js"
import { conservativeStrategyPolicy } from "../domain/strategies/conservative/strategy-policy.js"
import { makeConservativeTradingEngine } from "./conservative-trading-engine.js"
import { createHarnessBroker } from "./conservative-trading-engine-harness.js"

const baseAsset = new Asset({
  id: "doge",
  code: "DOGE",
})
const quoteAsset = new Asset({
  id: "usdt",
  code: "USDT",
})
const market = new Market({
  venue: "binance",
  symbol: "DOGEUSDT",
  baseAsset,
  quoteAsset,
})
const marketMetadata = {
  market,
  orderType: "LIMIT_MAKER",
  supportedOrderTypes: ["LIMIT_MAKER", "LIMIT"],
  unvalidatedConstraints: [],
  tradingRules: new TradingRules({
    market,
    constraints: [
      {
        type: "PRICE_INCREMENT",
        status: "SUPPORTED",
        value: new Money({
          amount: "0.01",
          asset: quoteAsset,
        }),
      },
      {
        type: "QUANTITY_INCREMENT",
        status: "SUPPORTED",
        value: new Quantity({
          amount: "0.1",
          asset: baseAsset,
        }),
      },
      {
        type: "MIN_QUANTITY",
        status: "SUPPORTED",
        value: new Quantity({
          amount: "0.1",
          asset: baseAsset,
        }),
      },
      {
        type: "MIN_NOTIONAL",
        status: "SUPPORTED",
        value: new Money({
          amount: "5",
          asset: quoteAsset,
        }),
      },
    ],
  }),
}
const appConfig = {
  strategies: {
    CG_coinGrabber: {
      enabled: true,
      settings: {
        conservative: { enabled: true },
        aggressive: { enabled: false },
      },
      pairs: {
        DOGEUSDT: {
          enabled: true,
          investment: 1000,
          orderQuantity: 1,
          keepQuantity: 0.1,
          minProfit: 0.01,
          priceStepPercent: 0.05,
          makerPercent: 0,
          takerPercent: 0.075,
        },
      },
    },
  },
}

function createBrokerState({ calls }) {
  return createHarnessBroker({
    market,
    baseAsset,
    quoteAsset,
    marketMetadata,
    baseFreeBalance: "0",
    quoteFreeBalance: "1000",
    quoteCashFlowBaseline: "0",
    portfolioBaseQuantityBaseline: "0",
    additionalTrackedBaseQuantityBaseline: "0",
    committedQuoteBalanceBaseline: "0",
    committedBaseBalanceBaseline: "0",
    onPlaceOrder: () => calls.push("broker"),
  })
}

function createSubmissionCallbacks({ calls, intentResult, outcomeResult }) {
  return {
    onOperationalStateSubmissionIntent: async () => {
      calls.push("intent")
      return intentResult
    },
    onOperationalStateSubmissionOutcome: async () => {
      calls.push("outcome")
      return outcomeResult
    },
  }
}

function createEngineDependencies({ broker, brokerState, calls, intentResult, outcomeResult, includeCallbacks }) {
  const dependencies = {
    broker,
    strategyPolicy: conservativeStrategyPolicy,
    appConfig,
    getPortfolio: () => new Portfolio(),
    getRecoveryLedger: () => RecoveryLedger.empty({ market }),
    getMarketMetadata: () => marketMetadata,
    getAccountSnapshot: () => brokerState.accountSnapshot,
    updateTradingAccounting: async () => ({
      ok: true,
      data: { applied: true },
    }),
    completeRecoveryCycle: async () => ({
      ok: true,
      data: {
        eligible: true,
        freeQuantity: "0.1",
      },
    }),
    canTrade: () => true,
    onPause: async () => ({ ok: true }),
    isStopping: () => false,
    isMarketPriceFresh: () => true,
    isMarketBookFresh: () => true,
    hasUnownedOpenOrdersForSymbol: () => false,
    now: () => 1,
    initialState: {},
    requireOperationalStateSubmissionDurability: true,
  }
  if (!includeCallbacks) {
    return dependencies
  }
  return {
    ...dependencies,
    ...createSubmissionCallbacks({
      calls,
      intentResult,
      outcomeResult,
    }),
  }
}

function createEngine({ calls, intentResult, outcomeResult, includeCallbacks = true }) {
  const brokerState = createBrokerState({ calls })
  const broker = {
    ...brokerState.broker,
    providerInstanceId: "binanceTestnet",
    providerType: "binance",
    accountId: "binance-primary",
  }
  const dependencies = createEngineDependencies({
    broker,
    brokerState,
    calls,
    intentResult: intentResult ?? {
      ok: true,
      data: { durable: true },
    },
    outcomeResult: outcomeResult ?? {
      ok: true,
      data: { durable: true },
    },
    includeCallbacks,
  })
  const engine = makeConservativeTradingEngine(dependencies)
  return {
    engine,
    brokerState,
  }
}

async function submitFirstMarketDecision({ engine }) {
  await engine.processBookTicker({
    symbol: "DOGEUSDT",
    bookTicker: {
      symbol: "DOGEUSDT",
      bestBidPrice: "0.01",
      bestBidQuantity: "1",
      bestAskPrice: "1000",
      bestAskQuantity: "1",
      timestamp: 1,
    },
  })
  return engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1,
    },
  })
}

test("commits the operational-state submission intent and outcome around Conservative broker placement", async () => {
  const calls = []
  const { engine, brokerState } = createEngine({ calls })
  const result = await submitFirstMarketDecision({ engine })

  assert.equal(
    result.ok,
    true,
    result.errors?.[0]?.message ?? "A successfully committed operational-state lifecycle must allow the valid Conservative order.",
  )
  assert.equal(brokerState.orders.length, 1, "The Conservative decision must reach the broker exactly once.")
  assert.deepEqual(calls, ["intent", "broker", "outcome"], "The durable intent must precede broker I/O and the durable outcome must follow the broker response.")
})

test("fails closed before Conservative broker placement when the operational-state intent cannot commit", async () => {
  const calls = []
  const { engine, brokerState } = createEngine({
    calls,
    intentResult: {
      ok: false,
      errors: [new Error("operational-state store unavailable")],
    },
  })
  const result = await submitFirstMarketDecision({ engine })

  assert.equal(result.ok, false, "An uncommitted operational-state intent must fail the Conservative submission.")
  assert.equal(brokerState.orders.length, 0, "The broker must not receive an order without a durable submission intent.")
  assert.deepEqual(calls, ["intent"], "A failed intent barrier must stop before broker placement and must not write a submission outcome.")
})

test("does not report success when Conservative outcome persistence fails after broker placement", async () => {
  const calls = []
  const { engine, brokerState } = createEngine({
    calls,
    outcomeResult: {
      ok: false,
      errors: [new Error("operational-state outcome write failed")],
    },
  })
  const result = await submitFirstMarketDecision({ engine })

  assert.equal(result.ok, false, "An uncommitted outcome must not be reported as a successful local acknowledgement.")
  assert.equal(brokerState.orders.length, 1, "The already-attempted broker request cannot be undone after an outcome-write failure.")
  assert.deepEqual(calls, ["intent", "broker", "outcome"], "The intent and broker request must precede the failed outcome append.")
})

test("rejects a missing operational-state submission callback before creating a tradable Conservative engine", () => {
  const calls = []

  assert.throws(
    () => createEngine({
      calls,
      includeCallbacks: false,
    }),
    /onOperationalStateSubmissionIntent and onOperationalStateSubmissionOutcome/,
  )
  assert.deepEqual(calls, [], "A missing durable callback must be rejected before any broker operation.")
})
