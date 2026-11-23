import nodeTest from "node:test"
const test = (...args) => nodeTest(`[recovery-sell-plan-multi-fill.test.js] ${  args[0]}`, ...args.slice(1))
import assert from "node:assert/strict"
import { Asset, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { Portfolio } from "../../portfolio/portfolio.js"
import { RecoveryLedger } from "./recovery-ledger.js"
import { calculateRecoverySellPlan } from "./recovery-sell-plan.js"
import { updateTradingAccounting } from "../../../use-cases/update-trading-accounting.js"

const baseAsset = new Asset({ id: "asset:DOGE", code: "DOGE" })
const quoteAsset = new Asset({ id: "asset:USDT", code: "USDT" })
const market = new Market({
  venue: "binance",
  symbol: "DOGEUSDT",
  baseAsset,
  quoteAsset,
})

function createFill({
  tradeId,
  side,
  price,
  quantity,
  quoteQuantity,
  commissionAmount = "0",
  commissionAsset,
  executedAt,
}) {
  return new Fill({
    tradeId,
    brokerOrderId: `order-${tradeId}`,
    clientOrderId: `client-${tradeId}`,
    market,
    side,
    price: new Money({ amount: price, asset: quoteAsset }),
    quantity: new Quantity({ amount: quantity, asset: baseAsset }),
    quoteQuantity: new Money({ amount: quoteQuantity, asset: quoteAsset }),
    commissions: commissionAmount === "0"
      ? []
      : [
        new Commission({
          amount: new Money({ amount: commissionAmount, asset: commissionAsset }),
        }),
      ],
    commissionStatus: "COMPLETE",
    executedAt,
  })
}

function applyFill({ state, fill }) {
  const result = updateTradingAccounting({
    portfolio: state.portfolio,
    recoveryLedger: state.recoveryLedger,
    fill,
  })
  assert.equal(result.ok, true, `Canonical ${fill.side} fill ${fill.tradeId} must update both accounting projections.`)
  return result.data
}

test("plans recovery from cumulative multi-fill cost and confirmed partial SELL proceeds", () => {
  const emptyState = {
    portfolio: new Portfolio(),
    recoveryLedger: RecoveryLedger.empty({ market }),
  }
  const afterFirstBuy = applyFill({
    state: emptyState,
    fill: createFill({
      tradeId: "buy-base-fee",
      side: "BUY",
      price: "0.8",
      quantity: "10",
      quoteQuantity: "8",
      commissionAmount: "0.1",
      commissionAsset: baseAsset,
      executedAt: 1,
    }),
  })
  const afterSecondBuy = applyFill({
    state: afterFirstBuy,
    fill: createFill({
      tradeId: "buy-quote-fee",
      side: "BUY",
      price: "1",
      quantity: "5",
      quoteQuantity: "5",
      commissionAmount: "0.05",
      commissionAsset: quoteAsset,
      executedAt: 2,
    }),
  })
  const afterPartialSell = applyFill({
    state: afterSecondBuy,
    fill: createFill({
      tradeId: "partial-sell-quote-fee",
      side: "SELL",
      price: "1.2",
      quantity: "4",
      quoteQuantity: "4.8",
      commissionAmount: "0.048",
      commissionAsset: quoteAsset,
      executedAt: 3,
    }),
  })

  const position = afterPartialSell.portfolio.getPosition({ marketId: market.id })
  assert.equal(position.baseQuantity.amount, "10.9", "The active base quantity must include both BUY fills, subtract the base BUY fee, and subtract the partial SELL.")
  assert.equal(position.spent.amount, "13.05", "The full BUY cost must include both quote notionals and the quote-asset BUY commission.")
  assert.equal(afterPartialSell.recoveryLedger.buyCost, "13.05", "The RecoveryLedger cost mirror must preserve the complete multi-fill BUY basis.")
  assert.equal(afterPartialSell.recoveryLedger.netSellProceeds, "4.752", "Confirmed partial SELL proceeds must subtract the actual quote-asset commission.")

  const plan = calculateRecoverySellPlan({
    activeQuantity: position.baseQuantity.amount,
    keepQuantity: "1",
    positionSpent: afterPartialSell.recoveryLedger.buyCost,
    saleProceeds: afterPartialSell.recoveryLedger.netSellProceeds,
    minProfit: "0.1",
    feeRate: "0.01",
    priceTickSize: "0.001",
    quantityStepSize: "0.1",
  })

  assert.deepEqual(plan, {
    quantity: "9.8",
    price: "0.866",
    requiredNetProceeds: "8.398",
  }, "The replacement recovery SELL must use the full accumulated BUY basis, net confirmed SELL proceeds, the per-cycle keep amount, and conservative fee reserves.")

  const availableBaseInThousandths = 9900n
  const plannedBaseDebitInThousandths = (9800n * 101n) / 100n
  const nextStepBaseDebitInThousandths = (9900n * 101n) / 100n
  assert.equal(plannedBaseDebitInThousandths, 9898n, "A 9.8 SELL plus the 1% base-fee reserve must debit exactly 9.898 base.")
  assert.ok(plannedBaseDebitInThousandths < availableBaseInThousandths, "The planned fee-adjusted SELL debit must preserve at least the configured 1 base unit.")
  assert.equal(nextStepBaseDebitInThousandths, 9999n, "A 9.9 SELL plus the 1% base-fee reserve must debit exactly 9.999 base.")
  assert.ok(nextStepBaseDebitInThousandths > availableBaseInThousandths, "The next 0.1 quantity step must exceed the 9.9 base available above keepQuantity.")

  const plannedNetProceedsNumerator = 980n * 866n * 99n
  const requiredNetProceedsNumerator = 8398n * 1000000n
  assert.equal(plannedNetProceedsNumerator, 84019320n, "A 9.8 SELL at 0.866 after a 1% quote-fee reserve must yield exactly 8.401932 net quote.")
  assert.ok(plannedNetProceedsNumerator > requiredNetProceedsNumerator, "The rounded-up recovery price must cover the exact 8.398 net quote requirement.")
})
