import test from "node:test"
import assert from "node:assert/strict"
import { Asset, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { RecoveryLedger } from "../domain/strategies/conservative/recovery-ledger.js"
import { evaluateConservativeStrategy } from "../domain/strategies/conservative/strategy.js"
import { updateTradingAccounting } from "./update-trading-accounting.js"

const baseAsset = new Asset({
  id: "doge",
  code: "DOGE",
})
const quoteAsset = new Asset({
  id: "usdt",
  code: "USDT",
})
const thirdAsset = new Asset({
  id: "bnb",
  code: "BNB",
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
  tradingRules: {
    constraints: [
      {
        type: "PRICE_INCREMENT",
        status: "SUPPORTED",
        value: { amount: "0.001" },
      },
      {
        type: "QUANTITY_INCREMENT",
        status: "SUPPORTED",
        value: { amount: "0.1" },
      },
      {
        type: "MIN_QUANTITY",
        status: "SUPPORTED",
        value: { amount: "0.1" },
      },
      {
        type: "MIN_NOTIONAL",
        status: "SUPPORTED",
        value: { amount: "5" },
      },
    ],
  },
}
const pairConfig = {
  priceStepPercent: 0.05,
  orderQuantity: 100,
  keepQuantity: 0.1,
  minProfit: 0.01,
  makerPercent: 0,
  takerPercent: 0.075,
}
const settings = {}
const marketPrice = {
  symbol: "DOGEUSDT",
  price: "0.1",
  timestamp: 100,
}

function makeCommission({ amount, asset, quoteValue } = {}) {
  return new Commission({
    amount: new Money({
      amount,
      asset,
    }),
    ...(quoteValue === undefined
      ? {}
      : {
        quoteValue: new Money({
          amount: quoteValue,
          asset: quoteAsset,
        }),
      }),
  })
}

function createBuyFill() {
  return new Fill({
    tradeId: "initial-buy-fill",
    brokerOrderId: "initial-buy-order",
    market,
    side: "BUY",
    price: new Money({
      amount: "0.1",
      asset: quoteAsset,
    }),
    quantity: new Quantity({
      amount: "100",
      asset: baseAsset,
    }),
    quoteQuantity: new Money({
      amount: "10",
      asset: quoteAsset,
    }),
    commissions: [
      makeCommission({
        amount: "0.1",
        asset: baseAsset,
      }),
      makeCommission({
        amount: "0.01",
        asset: quoteAsset,
      }),
      makeCommission({
        amount: "0.001",
        asset: thirdAsset,
        quoteValue: "0.02",
      }),
    ],
    commissionStatus: "COMPLETE",
  })
}

function evaluateConservativeScenario({ portfolio, recoveryLedger, lastBuyPrice } = {}) {
  return evaluateConservativeStrategy({
    marketPrice,
    pairConfig,
    settings,
    portfolio,
    recoveryLedger,
    marketMetadata,
    activeOrders: [],
    ...(lastBuyPrice === undefined ? {} : { lastBuyPrice }),
  })
}

test("composes the initial BUY, canonical fill accounting and exact recovery/standing intents", () => {
  let portfolio = new Portfolio()
  let recoveryLedger = RecoveryLedger.empty({ market })

  const initialDecision = evaluateConservativeScenario({
    portfolio,
    recoveryLedger,
  })
  assert.deepEqual(initialDecision.actions, [
    {
      side: "BUY",
      type: "LIMIT_MAKER",
      price: "0.099",
      quantity: "100",
      reason: "INITIAL_BUY",
    },
  ], "An empty valid Conservative position must produce exactly the configured initial BUY intent.")

  const fill = createBuyFill()
  const accounting = updateTradingAccounting({
    portfolio,
    recoveryLedger,
    fill,
  })
  assert.equal(accounting.ok, true, "The canonical initial BUY fill must commit through the production accounting use case.")
  assert.equal(accounting.data.applied, true, "The first BUY fill must be applied exactly once.")
  const {
    portfolio: accountedPortfolio,
    recoveryLedger: accountedRecoveryLedger,
  } = accounting.data
  portfolio = accountedPortfolio
  recoveryLedger = accountedRecoveryLedger

  const position = portfolio.getPosition({ marketId: market.id })
  assert.equal(position.baseQuantity.amount, "99.9", "The base commission must reduce active DOGE inventory.")
  assert.equal(position.spent.amount, "10.03", "Position basis must include quote and valued third-asset BUY commissions.")
  assert.equal(recoveryLedger.buyCost, "10.03", "RecoveryLedger must mirror the full commission-adjusted BUY basis.")
  assert.equal(recoveryLedger.netSellProceeds, "0", "No SELL proceeds exist before the first recovery SELL.")

  const nextDecision = evaluateConservativeScenario({
    portfolio,
    recoveryLedger,
    lastBuyPrice: "0.1",
  })
  assert.equal(nextDecision.action, "PLACE_ORDERS", "The reconciled BUY position must produce executable recovery and standing intents.")
  assert.deepEqual(nextDecision.actions, [
    {
      side: "SELL",
      purpose: "RECOVERY_SELL",
      type: "LIMIT_MAKER",
      price: "0.101",
      quantity: "99.8",
      reason: "RECOVER_INVESTED_CAPITAL_AND_MIN_PROFIT",
      requiredNetProceeds: "10.04",
    },
    {
      side: "BUY",
      type: "LIMIT_MAKER",
      price: "0.099",
      quantity: "100",
      reason: "NEXT_STANDING_BUY",
    },
  ], "The real policy must place recovery coverage first, then the next standing BUY at the exact tick-rounded prices and quantities.")
})
