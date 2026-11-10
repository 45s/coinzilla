import test from "node:test"
import assert from "node:assert/strict"
import { Asset, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { Portfolio } from "./portfolio.js"

const baseAsset = new Asset({ id: "asset:ETH", code: "ETH" })
const quoteAsset = new Asset({ id: "asset:USDT", code: "USDT" })
const market = new Market({ venue: "binance", symbol: "ETHUSDT", baseAsset, quoteAsset })
const makeFill = ({ tradeId = "trade-1", quantity = "1", commissions = [] } = {}) => new Fill({
  tradeId,
  brokerOrderId: "order-1",
  market,
  side: "BUY",
  price: new Money({ amount: "100", asset: quoteAsset }),
  quantity: new Quantity({ amount: quantity, asset: baseAsset }),
  quoteQuantity: new Money({ amount: "100", asset: quoteAsset }),
  commissions,
  commissionStatus: "COMPLETE",
})

test("creates a Position from a fill without mutating the original Portfolio", () => {
  const original = new Portfolio()
  const result = original.applyFill({ fill: makeFill() })
  assert.equal(result.applied, true)
  assert.equal(original.positions.length, 0)
  assert.equal(result.portfolio.positions.length, 1)
  assert.equal(result.portfolio.getPosition({ symbol: "ETHUSDT" }).baseQuantity.amount, "1")
})

test("deduplicates a fill by canonical market-scoped identity", () => {
  const portfolio = new Portfolio().applyFill({ fill: makeFill() }).portfolio
  const duplicate = portfolio.applyFill({ fill: makeFill() })
  assert.equal(duplicate.duplicate, true)
  assert.equal(duplicate.applied, false)
  assert.equal(duplicate.portfolio, portfolio)
  assert.equal(duplicate.portfolio.getPosition({ symbol: "ETHUSDT" }).baseQuantity.amount, "1")
})

test("keeps exact fill accounting isolated when different markets reuse the same trade ID", () => {
  const ethFill = makeFill({ tradeId: "shared-trade-id", quantity: "1" })
  const solBaseAsset = new Asset({ id: "asset:SOL", code: "SOL" })
  const solMarket = new Market({
    venue: "binance",
    symbol: "SOLUSDT",
    baseAsset: solBaseAsset,
    quoteAsset,
  })
  const solFill = new Fill({
    tradeId: "shared-trade-id",
    brokerOrderId: "sol-order",
    market: solMarket,
    side: "BUY",
    price: new Money({ amount: "100", asset: quoteAsset }),
    quantity: new Quantity({ amount: "2", asset: solBaseAsset }),
    quoteQuantity: new Money({ amount: "200", asset: quoteAsset }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
  const portfolio = new Portfolio()
    .applyFill({ fill: ethFill }).portfolio
    .applyFill({ fill: solFill }).portfolio
  const ethPosition = portfolio.getPosition({ symbol: "ETHUSDT" })
  const solPosition = portfolio.getPosition({ symbol: "SOLUSDT" })

  assert.equal(
    portfolio.positions.length,
    2,
    "The same broker trade ID in two markets must create two independent market Positions.",
  )
  assert.notEqual(
    ethFill.id,
    solFill.id,
    "Canonical fill identity must include market identity so equal trade IDs from ETHUSDT and SOLUSDT cannot collide.",
  )
  assert.equal(
    ethPosition.baseQuantity.amount,
    "1",
    "The ETHUSDT Position must contain only the one ETH executed by its own fill.",
  )
  assert.equal(
    ethPosition.spent.amount,
    "100",
    "The ETHUSDT recovery basis must include only its 100 USDT BUY execution.",
  )
  assert.equal(
    ethPosition.quoteNetCashFlow.amount,
    "-100",
    "The ETHUSDT quote cash flow must exclude the independent SOLUSDT execution.",
  )
  assert.equal(
    solPosition.baseQuantity.amount,
    "2",
    "The SOLUSDT Position must contain only the two SOL executed by its own fill.",
  )
  assert.equal(
    solPosition.spent.amount,
    "200",
    "The SOLUSDT recovery basis must include only its 200 USDT BUY execution.",
  )
  assert.equal(
    solPosition.quoteNetCashFlow.amount,
    "-200",
    "The SOLUSDT quote cash flow must exclude the independent ETHUSDT execution.",
  )
  assert.deepEqual(
    portfolio.appliedFillIds,
    [ethFill.id, solFill.id],
    "Portfolio must retain both market-scoped execution identities in the order they were applied.",
  )
})

test("allocates free inventory through the matching shared Position only", () => {
  const initial = new Portfolio().applyFill({
    fill: makeFill({ quantity: "100" }),
  }).portfolio
  const allocated = initial.allocateFreeQuantity({
    marketId: market.id,
    quantity: "1",
  })
  const position = allocated.getPosition({ marketId: market.id })

  assert.equal(position.baseQuantity.amount, "99")
  assert.equal(position.freeBaseQuantity.amount, "1")
  assert.equal(position.totalBaseQuantity.amount, "100")
  assert.equal(initial.getPosition({ marketId: market.id }).baseQuantity.amount, "100")
})

test("does not permit free allocation for an unknown market", () => {
  assert.throws(
    () => new Portfolio().allocateFreeQuantity({
      marketId: "missing-market",
      quantity: "1",
    }),
    /no Position/,
  )
})

test("rejects a reused Fill ID when execution facts differ without mutating Portfolio accounting", () => {
  const originalFill = makeFill({ tradeId: "reused-trade", quantity: "1" })
  const portfolio = new Portfolio().applyFill({ fill: originalFill }).portfolio

  assert.throws(
    () => portfolio.applyFill({
      fill: makeFill({ tradeId: "reused-trade", quantity: "2" }),
    }),
    /Conflicting execution facts reused Fill ID/,
    "Reusing one canonical fill identity with different execution facts must be rejected.",
  )

  const unchangedPosition = portfolio.getPosition({ symbol: "ETHUSDT" })
  assert.equal(unchangedPosition.baseQuantity.amount, "1", "A conflicting replay must not alter active inventory.")
  assert.equal(unchangedPosition.spent.amount, "100", "A conflicting replay must not alter the quote recovery basis.")
  assert.equal(unchangedPosition.quoteNetCashFlow.amount, "-100", "A conflicting replay must not alter quote cash flow.")
  assert.deepEqual(
    portfolio.appliedFillIds,
    [originalFill.id],
    "A rejected conflicting replay must not append another applied fill identity.",
  )
})


test("rejects a reused Fill ID when commission amount differs without mutating Portfolio", () => {
  const acceptedFill = makeFill({
    tradeId: "commission-conflict",
    commissions: [
      new Commission({ amount: new Money({ amount: "0.01", asset: quoteAsset }) }),
    ],
  })
  const portfolio = new Portfolio().applyFill({ fill: acceptedFill }).portfolio
  const originalState = portfolio.value
  const conflictingFill = makeFill({
    tradeId: "commission-conflict",
    commissions: [
      new Commission({ amount: new Money({ amount: "0.02", asset: quoteAsset }) }),
    ],
  })

  assert.throws(
    () => portfolio.applyFill({ fill: conflictingFill }),
    /Conflicting execution facts reused Fill ID/,
    "A reused execution identity with a different actual quote commission must be rejected.",
  )
  assert.deepEqual(
    portfolio.value,
    originalState,
    "Rejecting conflicting commission facts must leave the complete accepted Portfolio projection unchanged.",
  )
})

test("deduplicates equivalent history-response and user-data stream fills in either delivery order", () => {
  const historyResponseDelivery = makeFill({ tradeId: "binance-trade-10259", quantity: "4.995" })
  const userDataStreamDelivery = makeFill({ tradeId: "binance-trade-10259", quantity: "4.995" })

  const historyThenStream = new Portfolio().applyFill({ fill: historyResponseDelivery }).portfolio
  const duplicateStream = historyThenStream.applyFill({ fill: userDataStreamDelivery })
  assert.equal(duplicateStream.applied, false)
  assert.equal(duplicateStream.duplicate, true)
  assert.equal(duplicateStream.portfolio.getPosition({ symbol: "ETHUSDT" }).baseQuantity.amount, "4.995")

  const streamThenHistory = new Portfolio().applyFill({ fill: userDataStreamDelivery }).portfolio
  const duplicateHistory = streamThenHistory.applyFill({ fill: historyResponseDelivery })
  assert.equal(duplicateHistory.applied, false)
  assert.equal(duplicateHistory.duplicate, true)
  assert.equal(duplicateHistory.portfolio.getPosition({ symbol: "ETHUSDT" }).baseQuantity.amount, "4.995")
})
