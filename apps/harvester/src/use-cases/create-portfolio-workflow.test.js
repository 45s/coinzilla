import { StrategyId } from "../domain/strategies/strategy-ids.js"
import nodeTest from "node:test"
import assert from "node:assert/strict"
import { Asset, CanonicalOrder, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { RecoveryLedger } from "../domain/strategies/conservative/recovery-ledger.js"
import { createPortfolioWorkflow } from "./create-portfolio-workflow.js"

const createMarket = () => {
  const baseAsset = new Asset({ id: "asset:BTC", code: "BTC" })
  const quoteAsset = new Asset({ id: "asset:USDT", code: "USDT" })
  return new Market({
    venue: "binance",
    symbol: "BTCUSDT",
    baseAsset,
    quoteAsset,
  })
}

const market = createMarket()
const feeAsset = new Asset({ id: "asset:BNB", code: "BNB" })

const createFill = ({ tradeId, quantity, quoteQuantity, side = "BUY", price = "65000", commissions = [] }) => new Fill({
  tradeId,
  brokerOrderId: "broker-order-" + tradeId,
  market,
  side,
  price: new Money({ amount: price, asset: market.quoteAsset }),
  quantity: new Quantity({ amount: quantity, asset: market.baseAsset }),
  quoteQuantity: new Money({ amount: quoteQuantity, asset: market.quoteAsset }),
  commissions,
  commissionStatus: "COMPLETE",
})

const createWorkflow = () => createPortfolioWorkflow({
  evaluateStrategy: () => ({ action: "NO_ACTION" }),
  logger: {},
})

const createFilledSellOrder = ({
  clientOrderId = "completed-recovery-sell",
  brokerOrderId = "broker-completed-recovery-sell",
} = {}) => new CanonicalOrder({
  clientOrderId,
  brokerOrderId,
  market,
  side: "SELL",
  type: "LIMIT",
  limitPrice: new Money({ amount: "130005", asset: market.quoteAsset }),
  originalQuantity: new Quantity({ amount: "1", asset: market.baseAsset }),
  executedQuantity: new Quantity({ amount: "1", asset: market.baseAsset }),
  status: "FILLED",
  createdAt: 1,
  acknowledgedAt: 1,
  updatedAt: 2,
  completedAt: 2,
})

const test = (name, ...args) => nodeTest("[create-portfolio-workflow.test.js] " + name, ...args)

test("captures the third-asset baseline before applying the fill to Portfolio and RecoveryLedger", async () => {
  const baselineCalls = []
  const workflow = createPortfolioWorkflow({
    evaluateStrategy: () => ({ action: "NO_ACTION" }),
    logger: {},
    onCommissionAsset: async (asset) => {
      assert.equal(workflow.getPortfolio().getPosition({ marketId: market.id }), undefined)
      assert.equal(workflow.getRecoveryLedger({ marketId: market.id }), undefined)
      baselineCalls.push(asset)
      return { ok: true, data: { sourceTime: 100 } }
    },
  })
  const fill = createFill({
    tradeId: "trade-third-fee",
    quantity: "0.01",
    quoteQuantity: "650",
    commissions: [new Commission({
      amount: new Money({ amount: "0.001", asset: feeAsset }),
      quoteValue: new Money({ amount: "0.1", asset: market.quoteAsset }),
    })],
  })

  const result = await workflow.updateTradingAccounting({ fill })

  assert.equal(result.ok, true)
  assert.deepEqual(baselineCalls, [{ assetId: feeAsset.id, assetCode: feeAsset.code }])
  assert.equal(workflow.getPortfolio().getPosition({ marketId: market.id }).spent.amount, "650.1")
  assert.equal(workflow.getRecoveryLedger({ marketId: market.id }).buyCost, "650.1")
})

test("keeps live third-asset BUY and SELL multi-fill accounting in parity", async () => {
  const baselineCalls = []
  const workflow = createPortfolioWorkflow({
    evaluateStrategy: () => ({ action: "NO_ACTION" }),
    logger: {},
    onCommissionAsset: async (asset) => {
      baselineCalls.push(asset)
      return { ok: true, data: { sourceTime: 100 } }
    },
  })
  const fills = [
    createFill({
      tradeId: "live-third-fee-buy-1",
      quantity: "100",
      quoteQuantity: "10",
      commissions: [
        new Commission({ amount: new Money({ amount: "0.001", asset: feeAsset }), quoteValue: new Money({ amount: "0.02", asset: market.quoteAsset }) }),
        new Commission({ amount: new Money({ amount: "0.002", asset: feeAsset }), quoteValue: new Money({ amount: "0.01", asset: market.quoteAsset }) }),
      ],
    }),
    createFill({
      tradeId: "live-third-fee-buy-2",
      quantity: "50",
      quoteQuantity: "5",
      commissions: [
        new Commission({ amount: new Money({ amount: "0.002", asset: feeAsset }), quoteValue: new Money({ amount: "0.03", asset: market.quoteAsset }) }),
      ],
    }),
    createFill({
      tradeId: "live-third-fee-sell-1",
      side: "SELL",
      quantity: "40",
      quoteQuantity: "4.4",
      commissions: [
        new Commission({ amount: new Money({ amount: "0.001", asset: feeAsset }), quoteValue: new Money({ amount: "0.02", asset: market.quoteAsset }) }),
      ],
    }),
    createFill({
      tradeId: "live-third-fee-sell-2",
      side: "SELL",
      quantity: "50",
      quoteQuantity: "5.5",
      commissions: [
        new Commission({ amount: new Money({ amount: "0.001", asset: feeAsset }), quoteValue: new Money({ amount: "0.01", asset: market.quoteAsset }) }),
      ],
    }),
  ]

  for (const fill of fills) {
    const result = await workflow.updateTradingAccounting({ fill })
    assert.equal(result.ok, true, result.errors?.[0]?.message)
    assert.equal(result.data.applied, true)
  }

  const position = workflow.getPortfolio().getPosition({ marketId: market.id })
  const ledger = workflow.getRecoveryLedger({ marketId: market.id })
  assert.equal(position.baseQuantity.amount, "60")
  assert.equal(position.spent.amount, "15.06")
  assert.equal(position.quoteNetCashFlow.amount, "-5.19")
  assert.equal(ledger.buyCost, "15.06")
  assert.equal(ledger.netSellProceeds, "9.87")
  assert.equal(ledger.outstandingRecoveryAmount, "5.19")
  assert.equal(position.quoteNetCashFlow.amount, "-" + ledger.outstandingRecoveryAmount)
  assert.deepEqual(baselineCalls, Array(4).fill({ assetId: feeAsset.id, assetCode: feeAsset.code }))
})

test("does not persist a commission baseline or mutate live accounting for contradictory fee identity", async () => {
  const contradictoryFeeAsset = new Asset({ id: feeAsset.id, code: "BNB2" })
  const baselineCalls = []
  const workflow = createPortfolioWorkflow({
    evaluateStrategy: () => ({ action: "NO_ACTION" }),
    logger: {},
    onCommissionAsset: async (asset) => {
      baselineCalls.push(asset)
      return { ok: true, data: { sourceTime: 100 } }
    },
  })
  const originalPortfolio = workflow.getPortfolio().value
  const result = await workflow.updateTradingAccounting({
    fill: createFill({
      tradeId: "live-contradictory-third-fee",
      quantity: "0.01",
      quoteQuantity: "650",
      commissions: [
        new Commission({
          amount: new Money({ amount: "0.001", asset: feeAsset }),
          quoteValue: new Money({ amount: "0.1", asset: market.quoteAsset }),
        }),
        new Commission({
          amount: new Money({ amount: "0.001", asset: contradictoryFeeAsset }),
          quoteValue: new Money({ amount: "0.1", asset: market.quoteAsset }),
        }),
      ],
    }),
  })

  assert.equal(result.ok, false)
  assert.deepEqual(baselineCalls, [])
  assert.deepEqual(workflow.getPortfolio().value, originalPortfolio)
  assert.equal(workflow.getRecoveryLedger({ marketId: market.id }), undefined)
})

test("accounts a valid fill when optional third-asset baseline persistence fails and warns that audit will fail closed", async () => {
  const warnings = []
  const workflow = createPortfolioWorkflow({
    evaluateStrategy: () => ({ action: "NO_ACTION" }),
    logger: { warning: (entry) => warnings.push(entry) },
    onCommissionAsset: async () => {
      throw new Error("PREFLIGHT fee-asset baseline is unavailable")
    },
  })
  const fill = createFill({
    tradeId: "trade-third-fee-baseline-failure",
    quantity: "0.01",
    quoteQuantity: "650",
    commissions: [new Commission({
      amount: new Money({ amount: "0.001", asset: feeAsset }),
      quoteValue: new Money({ amount: "0.1", asset: market.quoteAsset }),
    })],
  })

  const result = await workflow.updateTradingAccounting({ fill })

  assert.equal(result.ok, true)
  assert.equal(workflow.getPortfolio().getPosition({ marketId: market.id }).spent.amount, "650.1")
  assert.equal(workflow.getRecoveryLedger({ marketId: market.id }).buyCost, "650.1")
  assert.equal(warnings.length, 1)
  assert.match(warnings[0].message, /account reconciliation will fail closed/)
})

test("serializes concurrent canonical fills and commits both accounting projections", async () => {
  const workflow = createWorkflow()
  const firstFill = createFill({ tradeId: "trade-1", quantity: "0.01", quoteQuantity: "650" })
  const secondFill = createFill({ tradeId: "trade-2", quantity: "0.02", quoteQuantity: "1300" })

  const [firstResult, secondResult] = await Promise.all([
    workflow.updateTradingAccounting({ fill: firstFill }),
    workflow.updateTradingAccounting({ fill: secondFill }),
  ])

  assert.equal(firstResult.ok, true, "The first canonical fill must commit successfully.")
  assert.equal(secondResult.ok, true, "The concurrent second canonical fill must commit after the first.")
  assert.equal(
    workflow.getPortfolio().getPosition({ marketId: market.id }).baseQuantity.amount,
    "0.03",
    "Both serialized BUY fills must be reflected in the active BTC position.",
  )
  assert.equal(
    workflow.getPortfolio().getPosition({ marketId: market.id }).spent.amount,
    "1950",
    "Portfolio cost basis must include the exact quote value of both canonical fills.",
  )
})

test("does not account the same canonical fill twice when deliveries overlap", async () => {
  const workflow = createWorkflow()
  const canonicalFill = createFill({ tradeId: "duplicate-trade", quantity: "0.01", quoteQuantity: "650" })

  const [firstResult, duplicateResult] = await Promise.all([
    workflow.updateTradingAccounting({ fill: canonicalFill }),
    workflow.updateTradingAccounting({ fill: canonicalFill }),
  ])

  assert.equal(firstResult.ok, true, "The first delivery of a canonical fill must be accepted.")
  assert.equal(duplicateResult.ok, true, "An identical replay must be reported as a successful idempotent result.")
  assert.equal(duplicateResult.data.duplicate, true, "The replay result must explicitly identify duplicate delivery.")
  assert.equal(
    workflow.getPortfolio().getPosition({ marketId: market.id }).baseQuantity.amount,
    "0.01",
    "An identical duplicate delivery must not increase the active BTC quantity a second time.",
  )
})

test("rejects non-canonical fill input without mutating Portfolio state", async () => {
  const workflow = createWorkflow()

  const result = await workflow.updateTradingAccounting({ fill: { tradeId: "untrusted-event" } })

  assert.equal(result.ok, false, "Accounting must reject a plain event object instead of treating it as a canonical Fill.")
  assert.ok(result.errors?.[0] instanceof TypeError, "The rejected input must expose the canonical-Fill contract violation in the normalized errors array.")
  assert.equal(
    workflow.getPortfolio().positions.length,
    0,
    "Rejecting a non-canonical event must leave the Portfolio unchanged.",
  )
})



test("leaves both accounting projections unchanged when recovery ledger reset fails", async () => {
  const buyFill = createFill({
    tradeId: "recovery-reset-buy",
    quantity: "2",
    quoteQuantity: "130000",
  })
  const sellFill = createFill({
    tradeId: "recovery-reset-sell",
    quantity: "1",
    quoteQuantity: "130005",
    side: "SELL",
    price: "130005",
  })

  const initialPortfolio = new Portfolio()
    .applyFill({ fill: buyFill, strategyId: StrategyId.COIN_GRABBER }).portfolio
    .applyFill({ fill: sellFill, strategyId: StrategyId.COIN_GRABBER }).portfolio
  const baseLedger = RecoveryLedger.empty({ market })
    .applyFill({ fill: buyFill, strategyId: StrategyId.COIN_GRABBER }).ledger
    .applyFill({ fill: sellFill, strategyId: StrategyId.COIN_GRABBER }).ledger

  class FailingResetRecoveryLedger extends RecoveryLedger {
    resetCycle() {
      throw new Error("recovery ledger reset failed")
    }
  }

  const failingLedger = new FailingResetRecoveryLedger({
    market,
    buyCost: baseLedger.buyCost,
    netSellProceeds: baseLedger.netSellProceeds,
    appliedFillIds: baseLedger.appliedFillIds,
    appliedFillFingerprints: baseLedger.appliedFillFingerprints,
  })
  const workflow = createPortfolioWorkflow({
    evaluateStrategy: () => ({ action: "NO_ACTION" }),
    logger: {},
    initialPortfolio,
    initialRecoveryLedgers: new Map([[market.id, failingLedger]]),
  })
  const initialPortfolioValue = initialPortfolio.value
  const initialLedgerValue = failingLedger.value

  const result = await workflow.completeRecoveryCycle({
    marketId: market.id,
    keepQuantity: "1",
    minProfit: "5",
    sellOrder: createFilledSellOrder({ clientOrderId: "reset-failure-sell" }),
  })

  assert.equal(result.ok, false, "A failed RecoveryLedger reset must reject recovery-cycle completion.")
  assert.match(result.errors[0].message, /recovery ledger reset failed/, "The result must preserve the actual failed transition.")
  assert.equal(workflow.getPortfolio(), initialPortfolio, "A failed ledger reset must not commit the staged free-inventory allocation or cost-basis reset.")
  assert.deepEqual(workflow.getPortfolio().value, initialPortfolioValue, "The complete Portfolio projection must remain unchanged after failed cycle completion.")
  assert.equal(workflow.getRecoveryLedger({ marketId: market.id }), failingLedger, "A failed cycle reset must preserve the original RecoveryLedger projection.")
  assert.deepEqual(workflow.getRecoveryLedger({ marketId: market.id }).value, initialLedgerValue, "The complete RecoveryLedger projection must remain unchanged after failed cycle completion.")

  const unchangedPosition = workflow.getPortfolio().getPosition({ marketId: market.id })
  assert.equal(unchangedPosition.baseQuantity.amount, "1", "The active base inventory must remain available after a failed cycle reset.")
  assert.equal(unchangedPosition.freeBaseQuantity.amount, "0", "Retained inventory must not be allocated when the paired ledger reset fails.")
  assert.equal(unchangedPosition.spent.amount, "130000", "The original recovery cost basis must not be cleared when the paired ledger reset fails.")
})

test("logs Portfolio Stats for each applied BUY or SELL fill that changes inventory quantity", async () => {
  const infoLogs = []
  const workflow = createPortfolioWorkflow({
    evaluateStrategy: () => ({ action: "NO_ACTION" }),
    logger: { info: (entry) => { infoLogs.push(entry) } },
  })

  const firstPartialBuyFill = createFill({ tradeId: "stats-buy-1", quantity: "0.004", quoteQuantity: "260" })
  const secondPartialBuyFill = createFill({ tradeId: "stats-buy-2", quantity: "0.006", quoteQuantity: "390" })
  const firstBuyResult = await workflow.updateTradingAccounting({ fill: firstPartialBuyFill })
  const secondBuyResult = await workflow.updateTradingAccounting({ fill: secondPartialBuyFill })

  assert.equal(firstBuyResult.ok, true, "The first confirmed partial BUY fill must update the portfolio before its stats are logged.")
  assert.equal(secondBuyResult.ok, true, "The second confirmed partial BUY fill must update the portfolio before its stats are logged.")
  assert.equal(infoLogs.length, 2, "Each distinct applied partial BUY fill that changes inventory must produce one Portfolio Stats snapshot.")
  assert.equal(infoLogs[0].message, "Portfolio Stats", "The first inventory snapshot must use the concise Portfolio Stats heading.")
  assert.equal(infoLogs[0].symbol, "BTCUSDT", "The Portfolio Stats snapshot must identify the market whose fill changed inventory.")
  assert.deepEqual(infoLogs[0].inventory, {
    activeBaseQuantity: "0.004 BTC",
    freeBaseQuantity: "0 BTC",
    totalBaseQuantity: "0.004 BTC",
  }, "The first partial BUY snapshot must distinguish active, free, and total BTC inventory.")
  assert.deepEqual(infoLogs[1].inventory, {
    activeBaseQuantity: "0.01 BTC",
    freeBaseQuantity: "0 BTC",
    totalBaseQuantity: "0.01 BTC",
  }, "The second partial BUY snapshot must show the cumulative active and total BTC inventory.")
  assert.deepEqual(infoLogs[1].accounting, {
    spent: "650 USDT",
    quoteNetCashFlow: "-650 USDT",
  }, "The BUY snapshot must report only quote-currency accounting values exposed by Portfolio.")

  const duplicateBuyResult = await workflow.updateTradingAccounting({ fill: secondPartialBuyFill })
  assert.equal(duplicateBuyResult.data.duplicate, true, "An identical replay of the latest BUY fill must be recognized as a duplicate.")
  assert.equal(infoLogs.length, 2, "A duplicate BUY fill must not emit another Portfolio Stats snapshot.")

  const partialSellFill = createFill({
    tradeId: "stats-sell-1",
    quantity: "0.004",
    quoteQuantity: "300",
    side: "SELL",
  })
  const sellResult = await workflow.updateTradingAccounting({ fill: partialSellFill })

  assert.equal(sellResult.ok, true, "A confirmed partial SELL fill must update the portfolio before its stats are logged.")
  assert.equal(infoLogs.length, 3, "A distinct applied partial SELL fill that changes inventory must produce one Portfolio Stats snapshot.")
  assert.deepEqual(infoLogs[2].inventory, {
    activeBaseQuantity: "0.006 BTC",
    freeBaseQuantity: "0 BTC",
    totalBaseQuantity: "0.006 BTC",
  }, "The SELL snapshot must show the reduced active and total BTC inventory.")
  assert.deepEqual(infoLogs[2].accounting, {
    spent: "650 USDT",
    quoteNetCashFlow: "-350 USDT",
  }, "The SELL snapshot must show only the updated Portfolio accounting values.")
})


test("logs Portfolio Stats when recovery completion changes Portfolio accounting without changing total inventory", async () => {
  const infoLogs = []
  const buyFill = createFill({ tradeId: "stats-cycle-buy", quantity: "2", quoteQuantity: "130000" })
  const sellFill = createFill({
    tradeId: "stats-cycle-sell",
    quantity: "1",
    quoteQuantity: "130005",
    side: "SELL",
    price: "130005",
  })
  const initialPortfolio = new Portfolio()
    .applyFill({ fill: buyFill, strategyId: StrategyId.COIN_GRABBER }).portfolio
    .applyFill({ fill: sellFill, strategyId: StrategyId.COIN_GRABBER }).portfolio
  const initialLedger = RecoveryLedger.empty({ market })
    .applyFill({ fill: buyFill, strategyId: StrategyId.COIN_GRABBER }).ledger
    .applyFill({ fill: sellFill, strategyId: StrategyId.COIN_GRABBER }).ledger
  const workflow = createPortfolioWorkflow({
    evaluateStrategy: () => ({ action: "NO_ACTION" }),
    logger: { info: (entry) => { infoLogs.push(entry) } },
    initialPortfolio,
    initialRecoveryLedgers: new Map([[market.id, initialLedger]]),
  })

  const result = await workflow.completeRecoveryCycle({
    marketId: market.id,
    keepQuantity: "1",
    minProfit: "5",
    sellOrder: createFilledSellOrder({ clientOrderId: "stats-completion-sell" }),
  })

  assert.equal(result.ok, true, "A fully filled and profitable recovery SELL must complete its eligible recovery cycle.")
  assert.equal(result.data.eligible, true, "The completion result must confirm that the cycle is eligible for reset.")
  assert.equal(infoLogs.length, 1, "Resetting Portfolio spent must emit stats even when total inventory stays unchanged.")
  assert.deepEqual(infoLogs[0].inventory, {
    activeBaseQuantity: "0 BTC",
    freeBaseQuantity: "1 BTC",
    totalBaseQuantity: "1 BTC",
  }, "Completion stats must show the full retained inventory after active recovery quantity is cleared.")
  assert.deepEqual(infoLogs[0].accounting, {
    spent: "0 USDT",
    quoteNetCashFlow: "5 USDT",
  }, "Completion stats must show the reset cost basis and preserved realized quote cash flow.")
})


test("persists a non-completed full-SELL outcome before returning and leaves accounting projections unchanged", async () => {
  const buyFill = createFill({ tradeId: "not-completed-buy", quantity: "2", quoteQuantity: "130000" })
  const sellFill = createFill({
    tradeId: "not-completed-sell",
    quantity: "1",
    quoteQuantity: "130005",
    side: "SELL",
    price: "130005",
  })
  const initialPortfolio = new Portfolio()
    .applyFill({ fill: buyFill, strategyId: StrategyId.COIN_GRABBER }).portfolio
    .applyFill({ fill: sellFill, strategyId: StrategyId.COIN_GRABBER }).portfolio
  const initialLedger = RecoveryLedger.empty({ market })
    .applyFill({ fill: buyFill, strategyId: StrategyId.COIN_GRABBER }).ledger
    .applyFill({ fill: sellFill, strategyId: StrategyId.COIN_GRABBER }).ledger
  const sellOrder = createFilledSellOrder({
    clientOrderId: "harvester-sell-not-completed",
    brokerOrderId: "broker-sell-not-completed",
  })
  const calls = []
  const workflow = createPortfolioWorkflow({
    evaluateStrategy: () => ({ action: "NO_ACTION" }),
    logger: {},
    initialPortfolio,
    initialRecoveryLedgers: new Map([[market.id, initialLedger]]),
    onOperationalStateRecoveryCycleNotCompleted: async (input) => {
      calls.push(input)
      return { ok: true, data: { durable: true } }
    },
  })

  const result = await workflow.completeRecoveryCycle({
    marketId: market.id,
    keepQuantity: "0.5",
    minProfit: "5",
    sellOrder,
  })

  assert.equal(result.ok, true, "A terminal SELL with residual sellable inventory must return a durable non-completion result.")
  assert.equal(result.data.eligible, false, "Residual sellable inventory must keep the recovery cycle open.")
  assert.equal(result.data.reason, "RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH", "The cycle must identify the exact residual sell-through reason.")
  assert.equal(calls.length, 1, "Every fully filled SELL must durably record its explicit non-completion outcome.")
  assert.equal(calls[0].sellOrder, sellOrder, "The outcome must be tied to the exact terminal SELL order.")
  assert.equal(calls[0].recoveryLedger, initialLedger, "The durable non-completion fact must reference the unchanged RecoveryLedger.")
  assert.equal(calls[0].position, initialPortfolio.getPosition({ marketId: market.id }), "The durable non-completion fact must reference the unchanged Position.")
  assert.equal(workflow.getPortfolio(), initialPortfolio, "A non-completed cycle must not allocate free inventory or reset basis.")
  assert.equal(workflow.getRecoveryLedger({ marketId: market.id }), initialLedger, "A non-completed recovery cycle must preserve its original RecoveryLedger.")
})

test("does not return a non-completed cycle when its durable outcome was not committed", async () => {
  const buyFill = createFill({ tradeId: "not-completed-failure-buy", quantity: "2", quoteQuantity: "130000" })
  const sellFill = createFill({
    tradeId: "not-completed-failure-sell",
    quantity: "1",
    quoteQuantity: "130005",
    side: "SELL",
    price: "130005",
  })
  const initialPortfolio = new Portfolio()
    .applyFill({ fill: buyFill, strategyId: StrategyId.COIN_GRABBER }).portfolio
    .applyFill({ fill: sellFill, strategyId: StrategyId.COIN_GRABBER }).portfolio
  const initialLedger = RecoveryLedger.empty({ market })
    .applyFill({ fill: buyFill, strategyId: StrategyId.COIN_GRABBER }).ledger
    .applyFill({ fill: sellFill, strategyId: StrategyId.COIN_GRABBER }).ledger
  const workflow = createPortfolioWorkflow({
    evaluateStrategy: () => ({ action: "NO_ACTION" }),
    logger: {},
    initialPortfolio,
    initialRecoveryLedgers: new Map([[market.id, initialLedger]]),
    onOperationalStateRecoveryCycleNotCompleted: async () => ({
      ok: false,
      errors: [new Error("cycle outcome manifest was not committed")],
    }),
  })

  const result = await workflow.completeRecoveryCycle({
    marketId: market.id,
    keepQuantity: "0.5",
    minProfit: "5",
    sellOrder: createFilledSellOrder({ clientOrderId: "sell-failed", brokerOrderId: "broker-failed" }),
  })

  assert.equal(result.ok, false, "A missing durable non-completion outcome must block the next strategy action.")
  assert.match(result.errors[0].message, /manifest was not committed/, "The failure must preserve the durable manifest-commit error.")
  assert.equal(workflow.getPortfolio(), initialPortfolio, "A failed durable non-completion fact must not publish a Portfolio transition.")
  assert.equal(workflow.getRecoveryLedger({ marketId: market.id }), initialLedger, "A failed durable non-completion fact must not publish a RecoveryLedger transition.")
})

test("binds a durable completed-cycle outcome to the exact fully filled SELL order before committing the reset", async () => {
  const buyFill = createFill({ tradeId: "completed-order-buy", quantity: "2", quoteQuantity: "130000" })
  const sellFill = createFill({
    tradeId: "completed-order-sell",
    quantity: "1",
    quoteQuantity: "130005",
    side: "SELL",
    price: "130005",
  })
  const initialPortfolio = new Portfolio()
    .applyFill({ fill: buyFill, strategyId: StrategyId.COIN_GRABBER }).portfolio
    .applyFill({ fill: sellFill, strategyId: StrategyId.COIN_GRABBER }).portfolio
  const initialLedger = RecoveryLedger.empty({ market })
    .applyFill({ fill: buyFill, strategyId: StrategyId.COIN_GRABBER }).ledger
    .applyFill({ fill: sellFill, strategyId: StrategyId.COIN_GRABBER }).ledger
  const sellOrder = createFilledSellOrder({
    clientOrderId: "harvester-sell-completed",
    brokerOrderId: "broker-sell-completed",
  })
  let durableInput
  const workflow = createPortfolioWorkflow({
    evaluateStrategy: () => ({ action: "NO_ACTION" }),
    logger: {},
    initialPortfolio,
    initialRecoveryLedgers: new Map([[market.id, initialLedger]]),
    onOperationalStateRecoveryCycleCompleted: async (input) => {
      durableInput = input
      assert.equal(workflow.getPortfolio(), initialPortfolio, "The durable fact must commit before either accounting projection is reset.")
      assert.equal(workflow.getRecoveryLedger({ marketId: market.id }), initialLedger, "The RecoveryLedger reset must remain unpublished until the completed-cycle fact is durable.")
      return { ok: true, data: { durable: true } }
    },
  })

  const result = await workflow.completeRecoveryCycle({
    marketId: market.id,
    keepQuantity: "1",
    minProfit: "5",
    sellOrder,
  })

  assert.equal(result.ok, true, "A canonical terminal SELL with eligible economics must commit the recovery-cycle outcome successfully.")
  assert.equal(durableInput.sellOrder, sellOrder, "The completion fact must identify the exact terminal SELL.")
})


test("does not complete or reset a recovery cycle without a canonical fully filled terminal SELL", async () => {
  const buyFill = createFill({
    tradeId: "missing-terminal-sell-buy",
    quantity: "2",
    quoteQuantity: "130000",
  })
  const sellFill = createFill({
    tradeId: "missing-terminal-sell-accounting-fill",
    quantity: "1",
    quoteQuantity: "130005",
    side: "SELL",
    price: "130005",
  })
  const initialPortfolio = new Portfolio()
    .applyFill({ fill: buyFill, strategyId: StrategyId.COIN_GRABBER }).portfolio
    .applyFill({ fill: sellFill, strategyId: StrategyId.COIN_GRABBER }).portfolio
  const initialLedger = RecoveryLedger.empty({ market })
    .applyFill({ fill: buyFill, strategyId: StrategyId.COIN_GRABBER }).ledger
    .applyFill({ fill: sellFill, strategyId: StrategyId.COIN_GRABBER }).ledger
  const workflow = createPortfolioWorkflow({
    evaluateStrategy: () => ({ action: "NO_ACTION" }),
    logger: {},
    initialPortfolio,
    initialRecoveryLedgers: new Map([[market.id, initialLedger]]),
  })

  const result = await workflow.completeRecoveryCycle({
    marketId: market.id,
    keepQuantity: "1",
    minProfit: "5",
  })

  assert.equal(
    result.ok,
    false,
    "Economic profitability alone must not authorize a recovery-cycle reset without terminal SELL evidence.",
  )
  assert.match(
    result.errors[0].message,
    /canonical fully filled terminal SELL/,
    "The failure must identify the missing terminal-order contract.",
  )
  assert.equal(workflow.getPortfolio(), initialPortfolio, "Missing terminal SELL evidence must not reset Portfolio.")
  assert.equal(workflow.getRecoveryLedger({ marketId: market.id }), initialLedger, "Missing terminal SELL evidence must not reset RecoveryLedger.")
})


test("serializes recovery completion behind an in-flight durable fill", async () => {
  const buyFill = createFill({
    tradeId: "serialized-cycle-buy",
    quantity: "2",
    quoteQuantity: "130000",
  })
  const sellFill = createFill({
    tradeId: "serialized-cycle-sell",
    quantity: "1",
    quoteQuantity: "130005",
    side: "SELL",
    price: "130005",
  })
  const additionalBuyFill = createFill({
    tradeId: "serialized-cycle-additional-buy",
    quantity: "0.5",
    quoteQuantity: "65000",
    price: "130000",
  })
  const initialPortfolio = new Portfolio()
    .applyFill({ fill: buyFill, strategyId: StrategyId.COIN_GRABBER }).portfolio
    .applyFill({ fill: sellFill, strategyId: StrategyId.COIN_GRABBER }).portfolio
  const initialLedger = RecoveryLedger.empty({ market })
    .applyFill({ fill: buyFill, strategyId: StrategyId.COIN_GRABBER }).ledger
    .applyFill({ fill: sellFill, strategyId: StrategyId.COIN_GRABBER }).ledger
  let releaseDurableFill
  let markDurableFillStarted
  const durableFillStarted = new Promise((resolve) => { markDurableFillStarted = resolve })
  const durableFillGate = new Promise((resolve) => { releaseDurableFill = resolve })
  const completionCalls = []
  const workflow = createPortfolioWorkflow({
    evaluateStrategy: () => ({ action: "NO_ACTION" }),
    logger: {},
    initialPortfolio,
    initialRecoveryLedgers: new Map([[market.id, initialLedger]]),
    onOperationalStateExecutionFill: async ({ fill: received }) => {
      assert.equal(received, additionalBuyFill, "The serialization test must hold the durable barrier for the exact concurrent BUY fill.")
      markDurableFillStarted()
      await durableFillGate
      return { ok: true, data: { durable: true } }
    },
    onOperationalStateRecoveryCycleCompleted: async (input) => {
      completionCalls.push(input)
      return { ok: true, data: { durable: true } }
    },
  })

  const fillPromise = workflow.updateTradingAccounting({ fill: additionalBuyFill })
  await durableFillStarted
  const completionPromise = workflow.completeRecoveryCycle({
    marketId: market.id,
    keepQuantity: "1",
    minProfit: "5",
    sellOrder: createFilledSellOrder({ clientOrderId: "serialized-cycle-terminal-sell" }),
  })

  releaseDurableFill()
  const [fillResult, completionResult] = await Promise.all([fillPromise, completionPromise])

  assert.equal(fillResult.ok, true, "The concurrent BUY fill must finish its durable accounting transition successfully.")
  assert.equal(completionResult.ok, true, "Recovery completion must finish after the queued BUY fill transition.")
  assert.equal(
    completionResult.data.eligible,
    false,
    "Completion must evaluate the state after the in-flight BUY fill has committed.",
  )
  assert.equal(
    completionResult.data.reason,
    "RECOVERY_PROFIT_TARGET_NOT_MET_CONTINUE_RECOVERY",
    "The newly committed active inventory must keep the recovery cycle open.",
  )
  assert.equal(completionCalls.length, 0, "A concurrent fill must prevent an outdated completed-cycle fact from being persisted.")
  const finalPosition = workflow.getPortfolio().getPosition({ marketId: market.id })
  assert.equal(finalPosition.baseQuantity.amount, "1.5", "The concurrent BUY fill must remain in active Position quantity after completion is evaluated.")
  assert.equal(finalPosition.spent.amount, "195000", "The concurrent BUY fill must remain included in the full recovery cost basis.")
  assert.equal(finalPosition.freeBaseQuantity.amount, "0", "No retained inventory may be allocated from a cycle invalidated by the queued BUY fill.")
  assert.equal(workflow.getRecoveryLedger({ marketId: market.id }).buyCost, "195000", "The RecoveryLedger cost must stay aligned with Portfolio after the serialized BUY fill.")
})
