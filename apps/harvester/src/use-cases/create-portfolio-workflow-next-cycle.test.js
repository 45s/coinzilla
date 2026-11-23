import test from "node:test"
import assert from "node:assert/strict"
import { Asset, CanonicalOrder, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { StrategyId } from "../domain/strategies/strategy-ids.js"
import { RecoveryLedger } from "../domain/strategies/conservative/recovery-ledger.js"
import { evaluateConservativeStrategy } from "../domain/strategies/conservative/strategy.js"
import { createPortfolioWorkflow } from "./create-portfolio-workflow.js"

const baseAsset = new Asset({
  id: "asset:BTC",
  code: "BTC",
})
const quoteAsset = new Asset({
  id: "asset:USDT",
  code: "USDT",
})
const market = new Market({
  venue: "binance",
  symbol: "BTCUSDT",
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
        value: { amount: "0.01" },
      },
      {
        type: "QUANTITY_INCREMENT",
        status: "SUPPORTED",
        value: { amount: "0.01" },
      },
      {
        type: "MIN_QUANTITY",
        status: "SUPPORTED",
        value: { amount: "0.01" },
      },
      {
        type: "MIN_NOTIONAL",
        status: "SUPPORTED",
        value: { amount: "1" },
      },
    ],
  },
}

function createFill({ tradeId, quantity, quoteQuantity, side = "BUY", price = "10" }) {
  return new Fill({
    tradeId,
    brokerOrderId: `broker-order-${tradeId}`,
    market,
    side,
    price: new Money({
      amount: price,
      asset: quoteAsset,
    }),
    quantity: new Quantity({
      amount: quantity,
      asset: baseAsset,
    }),
    quoteQuantity: new Money({
      amount: quoteQuantity,
      asset: quoteAsset,
    }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
}

function createTerminalSellOrder() {
  return new CanonicalOrder({
    clientOrderId: "cycle-one-terminal-sell",
    brokerOrderId: "broker-order-cycle-one-sell",
    market,
    side: "SELL",
    type: "LIMIT",
    limitPrice: new Money({
      amount: "21",
      asset: quoteAsset,
    }),
    originalQuantity: new Quantity({
      amount: "1",
      asset: baseAsset,
    }),
    executedQuantity: new Quantity({
      amount: "1",
      asset: baseAsset,
    }),
    status: "FILLED",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 2,
    completedAt: 2,
  })
}

function createNextCycleWorkflow() {
  const firstCycleBuy = createFill({
    tradeId: "cycle-one-buy",
    quantity: "2",
    quoteQuantity: "20",
  })
  const firstCycleSell = createFill({
    tradeId: "cycle-one-sell",
    quantity: "1",
    quoteQuantity: "21",
    side: "SELL",
    price: "21",
  })
  const initialPortfolio = new Portfolio()
    .applyFill({
      fill: firstCycleBuy,
      strategyId: StrategyId.COIN_GRABBER,
    }).portfolio
    .applyFill({
      fill: firstCycleSell,
      strategyId: StrategyId.COIN_GRABBER,
    }).portfolio
  const initialLedger = RecoveryLedger.empty({ market })
    .applyFill({
      fill: firstCycleBuy,
      strategyId: StrategyId.COIN_GRABBER,
    }).ledger
    .applyFill({
      fill: firstCycleSell,
      strategyId: StrategyId.COIN_GRABBER,
    }).ledger
  return {
    workflow: createPortfolioWorkflow({
      evaluateStrategy: () => ({ action: "NO_ACTION" }),
      logger: {},
      initialPortfolio,
      initialRecoveryLedgers: new Map([[market.id, initialLedger]]),
    }),
    previousCycleFills: [firstCycleBuy, firstCycleSell],
  }
}

async function completeFirstRecoveryCycle({ workflow }) {
  return workflow.completeRecoveryCycle({
    marketId: market.id,
    keepQuantity: "1",
    minProfit: "1",
    sellOrder: createTerminalSellOrder(),
  })
}

function assertFirstCycleRetainedInventory({ workflow }) {
  const position = workflow.getPortfolio().getPosition({ marketId: market.id })
  const ledger = workflow.getRecoveryLedger({ marketId: market.id })
  assert.equal(position.baseQuantity.amount, "0", "The completed cycle must leave no active inventory.")
  assert.equal(position.freeBaseQuantity.amount, "1", "The first cycle's keepQuantity must remain in the permanent free-inventory bucket.")
  assert.equal(position.spent.amount, "0", "The completed cycle's active cost basis must reset.")
  assert.equal(ledger.buyCost, "0", "The completed cycle's ledger cost must reset.")
  assert.equal(ledger.netSellProceeds, "0", "The completed cycle's proceeds must reset without erasing fill identities.")
}

async function applyNextCycleBuy({ workflow }) {
  const fill = createFill({
    tradeId: "cycle-two-buy",
    quantity: "2",
    quoteQuantity: "20",
  })
  return workflow.updateTradingAccounting({ fill })
}

function assertNextCycleAccounting({ workflow }) {
  const position = workflow.getPortfolio().getPosition({ marketId: market.id })
  const ledger = workflow.getRecoveryLedger({ marketId: market.id })
  assert.equal(position.baseQuantity.amount, "2", "Only the new cycle's BUY quantity must become active inventory.")
  assert.equal(position.freeBaseQuantity.amount, "1", "The previous cycle's retained quantity must remain separate and untouched.")
  assert.equal(position.totalBaseQuantity.amount, "3", "Total inventory must include both the prior retained unit and the new active inventory.")
  assert.equal(position.spent.amount, "20", "The new recovery basis must contain only the second cycle's BUY cost.")
  assert.equal(ledger.buyCost, "20", "The RecoveryLedger must start the new cycle from the new BUY cost.")
  assert.equal(ledger.netSellProceeds, "0", "Prior-cycle SELL proceeds must not reduce the next cycle's recovery target.")
  assert.equal(ledger.appliedFillIds.length, 3, "Fill identities from the completed cycle must remain deduplicated alongside the new BUY.")
}

async function assertPreviousCycleReplayIsIgnored({ workflow, previousCycleFills }) {
  const portfolioBefore = workflow.getPortfolio().value
  const recoveryLedgerBefore = workflow.getRecoveryLedger({ marketId: market.id }).value

  for (const fill of previousCycleFills) {
    const result = await workflow.updateTradingAccounting({ fill })
    assert.equal(result.ok, true, "A replay of an already-accounted prior-cycle fill must be accepted as an idempotent duplicate.")
    assert.equal(result.data.duplicate, true, "Prior-cycle fill identities must remain registered after cycle completion.")
  }

  assert.deepEqual(workflow.getPortfolio().value, portfolioBefore, "Stale prior-cycle fills must not mutate the new Portfolio recovery basis or retained inventory.")
  assert.deepEqual(
    workflow.getRecoveryLedger({ marketId: market.id }).value,
    recoveryLedgerBefore,
    "Stale prior-cycle fills must not mutate the new RecoveryLedger cost or proceeds.",
  )
}

function evaluateNextCycleDecision({ workflow }) {
  return evaluateConservativeStrategy({
    marketPrice: {
      symbol: "BTCUSDT",
      price: "10",
      timestamp: 100,
    },
    pairConfig: {
      priceStepPercent: 1,
      orderQuantity: 2,
      keepQuantity: 1,
      minProfit: 0.01,
      makerPercent: 0,
      takerPercent: 0,
      investment: 1000,
    },
    settings: {},
    portfolio: workflow.getPortfolio(),
    recoveryLedger: workflow.getRecoveryLedger({ marketId: market.id }),
    marketMetadata,
    activeOrders: [],
    lastBuyPrice: "10",
  })
}

function assertNextCycleRecoverySell({ decision }) {
  const recoverySell = decision.actions.find(({ side }) => side === "SELL")
  assert.ok(recoverySell, "The new active inventory must produce a recovery SELL intent.")
  assert.equal(recoverySell.quantity, "1", "The next recovery SELL must exclude the previous cycle's retained unit and preserve its own keepQuantity.")
  assert.equal(recoverySell.price, "20.01", "The next recovery SELL must recover only the new 20 quote-unit basis plus 0.01 minProfit.")
}

test("starts the next recovery cycle from its new BUY basis without reusing prior retained inventory", async () => {
  const { workflow, previousCycleFills } = createNextCycleWorkflow()
  const completion = await completeFirstRecoveryCycle({ workflow })
  assert.equal(completion.ok, true, "The first recovery cycle must complete after its full cost plus the exact profit threshold is recovered.")
  assertFirstCycleRetainedInventory({ workflow })
  const nextCycleResult = await applyNextCycleBuy({ workflow })
  assert.equal(nextCycleResult.ok, true, "The next cycle's canonical BUY fill must apply successfully.")
  assertNextCycleAccounting({ workflow })
  await assertPreviousCycleReplayIsIgnored({ workflow, previousCycleFills })
  const decision = evaluateNextCycleDecision({ workflow })
  assert.equal(decision.action, "PLACE_ORDERS", "The next cycle must remain eligible for its required standing orders.")
  assertNextCycleRecoverySell({ decision })
})
