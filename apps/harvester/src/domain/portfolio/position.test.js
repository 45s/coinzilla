import test from "node:test"
import assert from "node:assert/strict"
import { Asset, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { Position } from "./position.js"
import { calculatePositionFill } from "./position-accounting.js"

const baseAsset = new Asset({ id: "asset:BTC", code: "BTC" })
const quoteAsset = new Asset({ id: "asset:USDT", code: "USDT" })
const market = new Market({ venue: "binance", symbol: "BTCUSDT", baseAsset, quoteAsset })
const makeFill = ({
  side = "BUY",
  quantity = "2",
  quoteQuantity = "200",
  commissions = [],
  commissionStatus = "COMPLETE",
  tradeId = "trade-1",
  price = "100",
} = {}) => new Fill({
  tradeId,
  brokerOrderId: "order-1",
  market,
  side,
  price: new Money({ amount: price, asset: quoteAsset }),
  quantity: new Quantity({ amount: quantity, asset: baseAsset }),
  quoteQuantity: new Money({ amount: quoteQuantity, asset: quoteAsset }),
  commissions,
  commissionStatus,
})

test("calculates BUY accounting with base and quote commissions as a pure function", () => {
  const result = calculatePositionFill({
    market,
    baseQuantity: "0",
    quoteNetCashFlow: "0",
    fill: makeFill({
      commissions: [
        new Commission({ amount: new Money({ amount: "0.01", asset: baseAsset }) }),
        new Commission({ amount: new Money({ amount: "0.2", asset: quoteAsset }) }),
      ],
    }),
  })
  assert.deepEqual(result, { baseQuantity: "1.99", quoteNetCashFlow: "-200.2", spent: "200.2" })
})

test("applies BUY fills and base/quote commissions exactly", () => {
  const position = Position.empty({ market }).applyFill({
    fill: makeFill({
      commissions: [
        new Commission({ amount: new Money({ amount: "0.01", asset: baseAsset }) }),
        new Commission({ amount: new Money({ amount: "0.2", asset: quoteAsset }) }),
      ],
    }),
  })
  assert.equal(position.quantity.amount, "1.99")
  assert.equal(position.baseQuantity.amount, "1.99")
  assert.equal(position.spent.amount, "200.2")
  assert.equal(position.quoteNetCashFlow.amount, "-200.2")
  assert.equal(position.freeBaseQuantity.amount, "0")
})

test("applies SELL fills and base/quote commissions to net holdings", () => {
  const bought = Position.empty({ market }).applyFill({ fill: makeFill() })
  const sold = bought.applyFill({
    fill: makeFill({
      side: "SELL",
      quantity: "1",
      quoteQuantity: "120",
      tradeId: "trade-2",
      commissions: [
        new Commission({ amount: new Money({ amount: "0.01", asset: baseAsset }) }),
        new Commission({ amount: new Money({ amount: "0.1", asset: quoteAsset }) }),
      ],
    }),
  })
  assert.equal(sold.baseQuantity.amount, "0.99")
  assert.equal(sold.spent.amount, "200")
  assert.equal(sold.quoteNetCashFlow.amount, "-80.1")
})

test("rejects incomplete commissions and unvalued third-asset fees but accepts reliable quote valuation", () => {
  assert.throws(
    () => Position.empty({ market }).applyFill({ fill: makeFill({ commissionStatus: "UNKNOWN" }) }),
    /complete commission data/,
  )
  const thirdAsset = new Asset({ id: "asset:BNB", code: "BNB" })
  const thirdAssetFill = makeFill({
    commissions: [new Commission({ amount: new Money({ amount: "0.01", asset: thirdAsset }) })],
  })
  assert.throws(() => Position.empty({ market }).applyFill({ fill: thirdAssetFill }), /requires reliable quote-currency valuation/)
  const valuedThirdAssetFill = makeFill({
    commissions: [new Commission({
      amount: new Money({ amount: "0.01", asset: thirdAsset }),
      quoteValue: new Money({ amount: "0.02", asset: quoteAsset }),
    })],
  })
  const valuedPosition = Position.empty({ market }).applyFill({ fill: valuedThirdAssetFill })
  assert.equal(valuedPosition.spent.amount, "200.02")
  assert.equal(valuedPosition.quoteNetCashFlow.amount, "-200.02")
})

test("rejects SELL fills that exceed available active inventory", () => {
  assert.throws(
    () => Position.empty({ market }).applyFill({
      fill: makeFill({ side: "SELL", tradeId: "sell-first" }),
    }),
    /base quantity negative/,
  )
})

test("allocates exactly keepQuantity into a separate permanent free-inventory bucket", () => {
  const position = Position.empty({ market }).applyFill({
    fill: makeFill({ quantity: "100", quoteQuantity: "10" }),
  })
  const retained = position.allocateFreeQuantity({ quantity: "1" })

  assert.equal(retained.baseQuantity.amount, "99")
  assert.equal(retained.freeBaseQuantity.amount, "1")
  assert.equal(retained.totalBaseQuantity.amount, "100")
})

test("future BUY fills increase active inventory without reusing free inventory", () => {
  const position = Position.empty({ market })
    .applyFill({ fill: makeFill({ quantity: "100", quoteQuantity: "10" }) })
    .allocateFreeQuantity({ quantity: "1" })
    .applyFill({
      fill: makeFill({
        quantity: "100",
        quoteQuantity: "9.8",
        tradeId: "trade-2",
      }),
    })

  assert.equal(position.baseQuantity.amount, "199")
  assert.equal(position.freeBaseQuantity.amount, "1")
  assert.equal(position.totalBaseQuantity.amount, "200")
})

test("rejects allocating more free inventory than active inventory", () => {
  const position = Position.empty({ market })
  assert.throws(
    () => position.allocateFreeQuantity({ quantity: "1" }),
    /exceeds active strategy inventory/,
  )
})

test("rejects zero or invalid free-inventory allocations", () => {
  const position = Position.empty({ market }).applyFill({
    fill: makeFill({ quantity: "2", quoteQuantity: "200" }),
  })
  assert.throws(() => position.allocateFreeQuantity({ quantity: "0" }), /greater than zero/)
  assert.throws(() => position.allocateFreeQuantity({ quantity: "nope" }))
})

test("SELL fills cannot consume previously allocated free inventory", () => {
  const position = Position.empty({ market })
    .applyFill({
      fill: makeFill({ quantity: "100", quoteQuantity: "10" }),
    })
    .allocateFreeQuantity({ quantity: "1" })

  const sold = position.applyFill({
    fill: makeFill({
      side: "SELL",
      quantity: "99",
      quoteQuantity: "10.5",
      tradeId: "recovery-sell",
    }),
  })

  assert.equal(sold.baseQuantity.amount, "0")
  assert.equal(sold.freeBaseQuantity.amount, "1")
  assert.equal(sold.totalBaseQuantity.amount, "1")
})


test("rejects base commission greater than SELL execution quantity", () => {
  const funded = Position.empty({ market }).applyFill({
    fill: makeFill({ quantity: "10", quoteQuantity: "1", tradeId: "funding-fill" }),
  })
  const sell = makeFill({
    side: "SELL",
    quantity: "2",
    quoteQuantity: "0.2",
    tradeId: "excessive-base-fee",
    commissions: [
      new Commission({ amount: new Money({ amount: "2.1", asset: baseAsset }) }),
    ],
  })

  assert.throws(() => funded.applyFill({ fill: sell }), /base commission exceeds executed base quantity/i)
})

test("rejects quote commission greater than BUY quote notional", () => {
  const fill = makeFill({
    quantity: "1",
    quoteQuantity: "0.1",
    commissions: [
      new Commission({ amount: new Money({ amount: "0.11", asset: quoteAsset }) }),
    ],
  })

  assert.throws(() => Position.empty({ market }).applyFill({ fill }), /quote commission exceeds executed quote notional/i)
})

test("resets only the completed recovery cost basis after exact retained allocation", () => {
  const position = Position.empty({ market })
    .applyFill({ fill: makeFill({ quantity: "100", quoteQuantity: "10" }) })
    .allocateFreeQuantity({ quantity: "1" })
    .resetRecoveryBasis()

  assert.equal(position.quantity.amount, "99")
  assert.equal(position.freeBaseQuantity.amount, "1")
  assert.equal(position.spent.amount, "0")
  assert.equal(position.quoteNetCashFlow.amount, "-10")
})


test("conserves total base inventory across BUY fills, free allocation, and SELL fees", () => {
  const firstBuy = Position.empty({ market }).applyFill({
    fill: makeFill({
      tradeId: "buy-1",
      price: "0.1",
      quantity: "100",
      quoteQuantity: "10",
      commissions: [
        new Commission({ amount: new Money({ amount: "0.25", asset: baseAsset }) }),
        new Commission({ amount: new Money({ amount: "0.02", asset: quoteAsset }) }),
      ],
    }),
  })

  const afterAllocation = firstBuy.allocateFreeQuantity({ quantity: "1.25" })
  const afterSecondBuy = afterAllocation.applyFill({
    fill: makeFill({
      tradeId: "buy-2",
      price: "0.1",
      quantity: "20",
      quoteQuantity: "2",
      commissions: [
        new Commission({ amount: new Money({ amount: "0.05", asset: baseAsset }) }),
        new Commission({ amount: new Money({ amount: "0.01", asset: quoteAsset }) }),
      ],
    }),
  })
  const afterSell = afterSecondBuy.applyFill({
    fill: makeFill({
      side: "SELL",
      tradeId: "sell-1",
      price: "0.2",
      quantity: "118.4",
      quoteQuantity: "23.68",
      commissions: [
        new Commission({ amount: new Money({ amount: "0.05", asset: baseAsset }) }),
        new Commission({ amount: new Money({ amount: "0.03", asset: quoteAsset }) }),
      ],
    }),
  })

  assert.equal(firstBuy.baseQuantity.amount, "99.75", "The first BUY must add executed base less its 0.25 base commission.")
  assert.equal(firstBuy.freeBaseQuantity.amount, "0", "A BUY must not allocate any quantity to retained inventory.")
  assert.equal(firstBuy.totalBaseQuantity.amount, "99.75", "Total holdings after the first BUY must equal its fee-adjusted executed quantity.")
  assert.equal(firstBuy.spent.amount, "10.02", "The first BUY recovery cost must include its 0.02 quote commission.")
  assert.equal(firstBuy.quoteNetCashFlow.amount, "-10.02", "The first BUY quote cash flow must include its quote commission.")

  assert.equal(afterAllocation.baseQuantity.amount, "98.5", "Free allocation must subtract exactly 1.25 from active inventory.")
  assert.equal(afterAllocation.freeBaseQuantity.amount, "1.25", "Free allocation must add exactly 1.25 to retained inventory.")
  assert.equal(afterAllocation.totalBaseQuantity.amount, "99.75", "Moving inventory to the free bucket must conserve total base holdings.")
  assert.equal(afterAllocation.spent.amount, "10.02", "Free allocation must not change the completed BUY cost basis.")
  assert.equal(afterAllocation.quoteNetCashFlow.amount, "-10.02", "Free allocation must not create quote cash flow.")

  assert.equal(afterSecondBuy.baseQuantity.amount, "118.45", "The second BUY must add 19.95 net base while preserving the previously retained inventory.")
  assert.equal(afterSecondBuy.freeBaseQuantity.amount, "1.25", "A later BUY must not consume or change previously retained free inventory.")
  assert.equal(afterSecondBuy.totalBaseQuantity.amount, "119.7", "Total holdings must include both active and retained inventory after the second BUY.")
  assert.equal(afterSecondBuy.spent.amount, "12.03", "Accumulated BUY cost must include both quote commissions exactly once.")
  assert.equal(afterSecondBuy.quoteNetCashFlow.amount, "-12.03", "Accumulated BUY quote cash flow must equal the two gross costs plus quote commissions.")

  assert.equal(afterSell.baseQuantity.amount, "0", "The SELL must consume the entire active quantity including its 0.05 base commission.")
  assert.equal(afterSell.freeBaseQuantity.amount, "1.25", "The SELL must leave all retained free inventory untouched.")
  assert.equal(afterSell.totalBaseQuantity.amount, "1.25", "After selling active inventory, total holdings must equal the retained free quantity.")
  assert.equal(afterSell.spent.amount, "12.03", "A SELL must not rewrite the accumulated BUY recovery cost basis.")
  assert.equal(afterSell.quoteNetCashFlow.amount, "11.62", "SELL quote proceeds less its 0.03 quote commission must update cumulative quote cash flow exactly.")

  assert.equal(firstBuy.totalBaseQuantity.amount, "99.75", "Later immutable Position transitions must not change the original post-BUY snapshot.")
  assert.equal(afterAllocation.totalBaseQuantity.amount, "99.75", "Later fills must not mutate the immutable post-allocation snapshot.")
})
