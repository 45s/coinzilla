import assert from "node:assert/strict"
import test from "node:test"
import { Asset, Market, Money, Quantity, TradingRules } from "@coinzilla/entities"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { RecoveryLedger } from "../domain/strategies/conservative/recovery-ledger.js"
import { conservativeStrategyPolicy } from "../domain/strategies/conservative/strategy-policy.js"
import { makeConservativeTradingEngine } from "./conservative-trading-engine.js"
import { createHarnessBroker } from "./conservative-trading-engine-harness.js"

const baseAsset = new Asset({ id: "doge", code: "DOGE" })
const quoteAsset = new Asset({ id: "usdt", code: "USDT" })
const market = new Market({ venue: "binance", symbol: "DOGEUSDT", baseAsset, quoteAsset })
const marketMetadata = {
  market,
  orderType: "LIMIT_MAKER",
  supportedOrderTypes: ["LIMIT_MAKER", "LIMIT"],
  unvalidatedConstraints: [],
  tradingRules: new TradingRules({
    market,
    constraints: [
      { type: "PRICE_INCREMENT", status: "SUPPORTED", value: new Money({ amount: "0.01", asset: quoteAsset }) },
      { type: "QUANTITY_INCREMENT", status: "SUPPORTED", value: new Quantity({ amount: "0.1", asset: baseAsset }) },
      { type: "MIN_QUANTITY", status: "SUPPORTED", value: new Quantity({ amount: "0.1", asset: baseAsset }) },
      { type: "MIN_NOTIONAL", status: "SUPPORTED", value: new Money({ amount: "5", asset: quoteAsset }) },
    ],
  }),
}
const appConfig = {
  strategies: {
    CG_coinGrabber: {
      enabled: true,
      settings: { conservative: { enabled: true }, aggressive: { enabled: false } },
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

function createEngine({ calls, intentResult = { ok: true, data: { durable: true } } }) {
  const brokerState = createHarnessBroker({
    market,
    baseAsset,
    quoteAsset,
    marketMetadata,
    onPlaceOrder: () => calls.push("broker"),
  })
  const broker = {
    ...brokerState.broker,
    providerInstanceId: "binanceTestnet",
    providerType: "binance",
    accountId: "binance-primary",
  }
  const portfolio = new Portfolio()
  const recoveryLedger = RecoveryLedger.empty({ market })
  const engine = makeConservativeTradingEngine({
    broker,
    strategyPolicy: conservativeStrategyPolicy,
    appConfig,
    getPortfolio: () => portfolio,
    getRecoveryLedger: () => recoveryLedger,
    getMarketMetadata: () => marketMetadata,
    getAccountSnapshot: () => brokerState.accountSnapshot,
    updateTradingAccounting: async () => ({ ok: true, data: { applied: true } }),
    completeRecoveryCycle: async () => ({ ok: true, data: { eligible: true, freeQuantity: "0.1" } }),
    isMarketPriceFresh: () => true,
    isMarketBookFresh: () => true,
    canTrade: () => true,
    isStopping: () => false,
    onPause: async () => {},
    onOperationalStateSubmissionIntent: async () => {
      calls.push("intent")
      return intentResult
    },
    onOperationalStateSubmissionOutcome: async () => {
      calls.push("outcome")
      return { ok: true, data: { durable: true } }
    },
  })
  return { engine, brokerState }
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
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
}

test("commits the operational-state submission intent and outcome around Conservative broker placement", async () => {
  const calls = []
  const { engine, brokerState } = createEngine({ calls })
  const result = await submitFirstMarketDecision({ engine })

  assert.equal(result.ok, true, "A successfully committed operational-state lifecycle must allow the valid Conservative order.")
  assert.equal(brokerState.orders.length, 1, "The Conservative decision must reach the broker exactly once.")
  assert.deepEqual(calls, ["intent", "broker", "outcome"], "The durable intent must precede broker I/O and the durable outcome must follow the broker response.")
})

test("fails closed before Conservative broker placement when the operational-state intent cannot commit", async () => {
  const calls = []
  const { engine, brokerState } = createEngine({
    calls,
    intentResult: { ok: false, errors: [new Error("operational-state store unavailable")] },
  })
  const result = await submitFirstMarketDecision({ engine })

  assert.equal(result.ok, false, "An uncommitted operational-state intent must fail the Conservative submission.")
  assert.equal(brokerState.orders.length, 0, "The broker must not receive an order without a durable submission intent.")
  assert.deepEqual(calls, ["intent"], "A failed intent barrier must stop before broker placement and must not write a submission outcome.")
})
