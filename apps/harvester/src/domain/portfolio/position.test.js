import { StrategyId } from "../strategies/strategy-ids.js"
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
  assert.deepEqual(result, { baseQuantity: "1.99", quoteNetCashFlow: "-200.2", spent: "200.2" }, "BUY accounting must deduct the base commission and add the quote commission to spent cost and cash flow.")
})

test("applies BUY fills and base/quote commissions exactly", () => {
  const position = Position.empty({ market, strategyId: StrategyId.COIN_GRABBER }).applyFill({
    fill: makeFill({
      commissions: [
        new Commission({ amount: new Money({ amount: "0.01", asset: baseAsset }) }),
        new Commission({ amount: new Money({ amount: "0.2", asset: quoteAsset }) }),
      ],
    }), strategyId: StrategyId.COIN_GRABBER
  })
  assert.equal(position.quantity.amount, "1.99", "The compatibility quantity must expose active inventory net of base commission.")
  assert.equal(position.baseQuantity.amount, "1.99", "Active base inventory must equal executed BUY quantity less base commission.")
  assert.equal(position.spent.amount, "200.2", "Spent recovery cost must include the quote commission.")
  assert.equal(position.quoteNetCashFlow.amount, "-200.2", "BUY quote cash flow must include gross notional and quote commission.")
  assert.equal(position.freeBaseQuantity.amount, "0", "A normal BUY must not create retained free inventory.")
})

test("applies SELL fills and base/quote commissions to net holdings", () => {
  const bought = Position.empty({ market, strategyId: StrategyId.COIN_GRABBER }).applyFill({ fill: makeFill(), strategyId: StrategyId.COIN_GRABBER })
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
    }), strategyId: StrategyId.COIN_GRABBER
  })
  assert.equal(sold.baseQuantity.amount, "0.99", "SELL quantity and base commission must both reduce active inventory.")
  assert.equal(sold.spent.amount, "200", "A SELL must preserve the accumulated BUY cost basis.")
  assert.equal(sold.quoteNetCashFlow.amount, "-80.1", "SELL proceeds must update quote cash flow net of quote commission.")
})

test("rejects incomplete commissions and unvalued third-asset fees but accepts reliable quote valuation", () => {
  assert.throws(
    () => Position.empty({ market, strategyId: StrategyId.COIN_GRABBER }).applyFill({ fill: makeFill({ commissionStatus: "UNKNOWN" }), strategyId: StrategyId.COIN_GRABBER }),
    /complete commission data/,
    "An incomplete commission report must be rejected before Position accounting is accepted.",
  )
  const thirdAsset = new Asset({ id: "asset:BNB", code: "BNB" })
  const thirdAssetFill = makeFill({
    commissions: [new Commission({ amount: new Money({ amount: "0.01", asset: thirdAsset }) })],
  })
  assert.throws(() => Position.empty({ market, strategyId: StrategyId.COIN_GRABBER }).applyFill({ fill: thirdAssetFill, strategyId: StrategyId.COIN_GRABBER }), /requires reliable quote-currency valuation/, "A third-asset fee without quote valuation must fail closed.")
  const valuedThirdAssetFill = makeFill({
    commissions: [new Commission({
      amount: new Money({ amount: "0.01", asset: thirdAsset }),
      quoteValue: new Money({ amount: "0.02", asset: quoteAsset }),
    })],
  })
  const valuedPosition = Position.empty({ market, strategyId: StrategyId.COIN_GRABBER }).applyFill({ fill: valuedThirdAssetFill, strategyId: StrategyId.COIN_GRABBER })
  assert.equal(valuedPosition.spent.amount, "200.02", "A reliably valued third-asset fee must be included in spent quote cost.")
  assert.equal(valuedPosition.quoteNetCashFlow.amount, "-200.02", "A reliably valued third-asset fee must be included in BUY quote cash flow.")
})

test("failed fill transitions preserve the complete Position snapshot", () => {
  const funded = Position.empty({ market, strategyId: StrategyId.COIN_GRABBER }).applyFill({
    fill: makeFill({
      quantity: "10",
      quoteQuantity: "1",
      price: "0.1",
      tradeId: "funding-fill",
    }), strategyId: StrategyId.COIN_GRABBER
  })
  const originalValue = funded.value
  const failureCases = [
    {
      name: "SELL overdraw",
      fill: makeFill({
        side: "SELL",
        quantity: "11",
        quoteQuantity: "1.1",
        price: "0.1",
        tradeId: "sell-overdraw",
      }),
      error: /base quantity negative/,
    },
    {
      name: "base commission overdraw",
      fill: makeFill({
        side: "SELL",
        quantity: "2",
        quoteQuantity: "0.2",
        price: "0.1",
        tradeId: "base-fee-overdraw",
        commissions: [
          new Commission({ amount: new Money({ amount: "2.1", asset: baseAsset }) }),
        ],
      }),
      error: /base commission exceeds executed base quantity/i,
    },
    {
      name: "quote commission overdraw",
      fill: makeFill({
        quantity: "1",
        quoteQuantity: "0.1",
        price: "0.1",
        tradeId: "quote-fee-overdraw",
        commissions: [
          new Commission({ amount: new Money({ amount: "0.11", asset: quoteAsset }) }),
        ],
      }),
      error: /quote commission exceeds executed quote notional/i,
    },
    {
      name: "incomplete commission data",
      fill: makeFill({
        quantity: "1",
        quoteQuantity: "0.1",
        price: "0.1",
        tradeId: "incomplete-commission",
        commissionStatus: "UNKNOWN",
      }),
      error: /complete commission data/,
    },
  ]

  for (const { name, fill, error } of failureCases) {
    assert.throws(
      () => funded.applyFill({ fill, strategyId: StrategyId.COIN_GRABBER }),
      error,
      `The ${name} failure must be rejected before changing Position state.`,
    )
    assert.deepEqual(
      funded.value,
      originalValue,
      `The ${name} failure must preserve every Position field and the accepted accounting snapshot.`,
    )
  }
})

test("allocates exactly keepQuantity into a separate permanent free-inventory bucket", () => {
  const position = Position.empty({ market, strategyId: StrategyId.COIN_GRABBER }).applyFill({
    fill: makeFill({ quantity: "100", quoteQuantity: "10" }), strategyId: StrategyId.COIN_GRABBER
  })
  const retained = position.allocateFreeQuantity({ quantity: "1" })

  assert.equal(retained.baseQuantity.amount, "99", "Free allocation must subtract exactly keepQuantity from active inventory.")
  assert.equal(retained.freeBaseQuantity.amount, "1", "Free allocation must retain exactly the configured quantity.")
  assert.equal(retained.totalBaseQuantity.amount, "100", "Free allocation must conserve total base holdings.")
})

test("future BUY fills increase active inventory without reusing free inventory", () => {
  const position = Position.empty({ market, strategyId: StrategyId.COIN_GRABBER })
    .applyFill({ fill: makeFill({ quantity: "100", quoteQuantity: "10" }), strategyId: StrategyId.COIN_GRABBER })
    .allocateFreeQuantity({ quantity: "1" })
    .applyFill({
      fill: makeFill({
        quantity: "100",
        quoteQuantity: "9.8",
        tradeId: "trade-2",
      }), strategyId: StrategyId.COIN_GRABBER
    })

  assert.equal(position.baseQuantity.amount, "199", "A later BUY must add to active inventory without subtracting retained inventory.")
  assert.equal(position.freeBaseQuantity.amount, "1", "A later BUY must preserve the previously retained free quantity.")
  assert.equal(position.totalBaseQuantity.amount, "200", "Total holdings must include both active and retained inventory.")
})

test("rejects allocating more free inventory than active inventory", () => {
  const position = Position.empty({ market, strategyId: StrategyId.COIN_GRABBER })
  assert.throws(
    () => position.allocateFreeQuantity({ quantity: "1" }),
    /exceeds active strategy inventory/,
    "Free allocation must not exceed active strategy inventory.",
  )
})

test("rejects zero or invalid free-inventory allocations", () => {
  const position = Position.empty({ market, strategyId: StrategyId.COIN_GRABBER }).applyFill({
    fill: makeFill({ quantity: "2", quoteQuantity: "200" }), strategyId: StrategyId.COIN_GRABBER
  })
  assert.throws(() => position.allocateFreeQuantity({ quantity: "0" }), /greater than zero/, "Zero free-inventory allocation must be rejected.")
  assert.throws(() => position.allocateFreeQuantity({ quantity: "nope" }), undefined, "Malformed free-inventory quantity must be rejected before a Position transition.")
})

test("SELL fills cannot consume previously allocated free inventory", () => {
  const position = Position.empty({ market, strategyId: StrategyId.COIN_GRABBER })
    .applyFill({
      fill: makeFill({ quantity: "100", quoteQuantity: "10" }), strategyId: StrategyId.COIN_GRABBER
    })
    .allocateFreeQuantity({ quantity: "1" })

  const sold = position.applyFill({
    fill: makeFill({
      side: "SELL",
      quantity: "99",
      quoteQuantity: "10.5",
      tradeId: "recovery-sell",
    }), strategyId: StrategyId.COIN_GRABBER
  })

  assert.equal(sold.baseQuantity.amount, "0", "The SELL must consume all active inventory above keepQuantity.")
  assert.equal(sold.freeBaseQuantity.amount, "1", "The SELL must not consume retained free inventory.")
  assert.equal(sold.totalBaseQuantity.amount, "1", "After selling active inventory, total holdings must equal retained free inventory.")
})


test("rejects base commission greater than SELL execution quantity", () => {
  const funded = Position.empty({ market, strategyId: StrategyId.COIN_GRABBER }).applyFill({
    fill: makeFill({ quantity: "10", quoteQuantity: "1", tradeId: "funding-fill" }), strategyId: StrategyId.COIN_GRABBER
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

  assert.throws(() => funded.applyFill({ fill: sell, strategyId: StrategyId.COIN_GRABBER }), /base commission exceeds executed base quantity/i, "Base commission greater than executed SELL quantity must be rejected.")
})

test("rejects quote commission greater than BUY quote notional", () => {
  const fill = makeFill({
    quantity: "1",
    quoteQuantity: "0.1",
    commissions: [
      new Commission({ amount: new Money({ amount: "0.11", asset: quoteAsset }) }),
    ],
  })

  assert.throws(() => Position.empty({ market, strategyId: StrategyId.COIN_GRABBER }).applyFill({ fill, strategyId: StrategyId.COIN_GRABBER }), /quote commission exceeds executed quote notional/i, "Quote commission greater than BUY notional must be rejected.")
})

test("resets only the completed recovery cost basis after exact retained allocation", () => {
  const position = Position.empty({ market, strategyId: StrategyId.COIN_GRABBER })
    .applyFill({ fill: makeFill({ quantity: "100", quoteQuantity: "10" }), strategyId: StrategyId.COIN_GRABBER })
    .allocateFreeQuantity({ quantity: "1" })
    .resetRecoveryBasis()

  assert.equal(position.quantity.amount, "99", "Recovery-basis reset must preserve active strategy quantity.")
  assert.equal(position.freeBaseQuantity.amount, "1", "Recovery-basis reset must preserve retained free inventory.")
  assert.equal(position.spent.amount, "0", "Only the completed recovery cost basis must reset to zero.")
  assert.equal(position.quoteNetCashFlow.amount, "-10", "Resetting recovery basis must preserve historical quote cash flow.")
})


test("conserves total base inventory across BUY fills, free allocation, and SELL fees", () => {
  const firstBuy = Position.empty({ market, strategyId: StrategyId.COIN_GRABBER }).applyFill({
    fill: makeFill({
      tradeId: "buy-1",
      price: "0.1",
      quantity: "100",
      quoteQuantity: "10",
      commissions: [
        new Commission({ amount: new Money({ amount: "0.25", asset: baseAsset }) }),
        new Commission({ amount: new Money({ amount: "0.02", asset: quoteAsset }) }),
      ],
    }), strategyId: StrategyId.COIN_GRABBER
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
    }), strategyId: StrategyId.COIN_GRABBER
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
    }), strategyId: StrategyId.COIN_GRABBER
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
