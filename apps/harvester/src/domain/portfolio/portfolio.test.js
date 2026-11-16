import { StrategyId } from "../strategies/strategy-ids.js"
import test from "node:test"
import assert from "node:assert/strict"
import { Asset, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { Portfolio } from "./portfolio.js"

const baseAsset = new Asset({ id: "asset:ETH", code: "ETH" })
const quoteAsset = new Asset({ id: "asset:USDT", code: "USDT" })
const market = new Market({ venue: "binance", symbol: "ETHUSDT", baseAsset, quoteAsset })
const makeFill = ({ tradeId = "trade-1", side = "BUY", quantity = "1", quoteQuantity = "100", commissions = [] } = {}) => new Fill({
  tradeId,
  brokerOrderId: "order-1",
  market,
  side,
  price: new Money({ amount: "100", asset: quoteAsset }),
  quantity: new Quantity({ amount: quantity, asset: baseAsset }),
  quoteQuantity: new Money({ amount: quoteQuantity, asset: quoteAsset }),
  commissions,
  commissionStatus: "COMPLETE",
})

test("creates a Position from a fill without mutating the original Portfolio", () => {
  const original = new Portfolio()
  const result = original.applyFill({ fill: makeFill(), strategyId: StrategyId.COIN_GRABBER })
  assert.equal(result.applied, true)
  assert.equal(original.positions.length, 0)
  assert.equal(result.portfolio.positions.length, 1)
  assert.equal(result.portfolio.getPosition({ symbol: "ETHUSDT" }).baseQuantity.amount, "1")
})

test("deduplicates a fill by canonical market-scoped identity", () => {
  const portfolio = new Portfolio().applyFill({ fill: makeFill(), strategyId: StrategyId.COIN_GRABBER }).portfolio
  const duplicate = portfolio.applyFill({ fill: makeFill(), strategyId: StrategyId.COIN_GRABBER })
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
    .applyFill({ fill: ethFill, strategyId: StrategyId.COIN_GRABBER }).portfolio
    .applyFill({ fill: solFill, strategyId: StrategyId.COIN_GRABBER }).portfolio
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
    fill: makeFill({ quantity: "100" }), strategyId: StrategyId.COIN_GRABBER
  }).portfolio
  const allocated = initial.allocateFreeQuantity({
    marketId: market.id,
    quantity: "1", strategyId: StrategyId.COIN_GRABBER
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
      quantity: "1", strategyId: StrategyId.COIN_GRABBER
    }),
    /no Position/,
  )
})

test("rejects a reused Fill ID when execution facts differ without mutating Portfolio accounting", () => {
  const originalFill = makeFill({ tradeId: "reused-trade", quantity: "1" })
  const portfolio = new Portfolio().applyFill({ fill: originalFill, strategyId: StrategyId.COIN_GRABBER }).portfolio

  assert.throws(
    () => portfolio.applyFill({
      fill: makeFill({ tradeId: "reused-trade", quantity: "2" }), strategyId: StrategyId.COIN_GRABBER
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
  const portfolio = new Portfolio().applyFill({ fill: acceptedFill, strategyId: StrategyId.COIN_GRABBER }).portfolio
  const originalState = portfolio.value
  const conflictingFill = makeFill({
    tradeId: "commission-conflict",
    commissions: [
      new Commission({ amount: new Money({ amount: "0.02", asset: quoteAsset }) }),
    ],
  })

  assert.throws(
    () => portfolio.applyFill({ fill: conflictingFill, strategyId: StrategyId.COIN_GRABBER }),
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

  const historyThenStream = new Portfolio().applyFill({ fill: historyResponseDelivery, strategyId: StrategyId.COIN_GRABBER }).portfolio
  const duplicateStream = historyThenStream.applyFill({ fill: userDataStreamDelivery, strategyId: StrategyId.COIN_GRABBER })
  assert.equal(duplicateStream.applied, false)
  assert.equal(duplicateStream.duplicate, true)
  assert.equal(duplicateStream.portfolio.getPosition({ symbol: "ETHUSDT" }).baseQuantity.amount, "4.995")

  const streamThenHistory = new Portfolio().applyFill({ fill: userDataStreamDelivery, strategyId: StrategyId.COIN_GRABBER }).portfolio
  const duplicateHistory = streamThenHistory.applyFill({ fill: historyResponseDelivery, strategyId: StrategyId.COIN_GRABBER })
  assert.equal(duplicateHistory.applied, false)
  assert.equal(duplicateHistory.duplicate, true)
  assert.equal(duplicateHistory.portfolio.getPosition({ symbol: "ETHUSDT" }).baseQuantity.amount, "4.995")
})


test("keeps independent strategy-owned Positions for the same market", () => {
  const coinGrabberPositionId = "position:cg:ethusdt"
  const recoverySellerPositionId = "position:rs:ethusdt"
  const coinGrabberFill = makeFill({
    tradeId: "cg-buy",
    quantity: "10",
    quoteQuantity: "1000",
  })
  const recoverySellerFill = makeFill({
    tradeId: "rs-buy",
    quantity: "3",
    quoteQuantity: "600",
  })

  const { portfolio: coinGrabberPortfolio } = new Portfolio().applyFill({
    fill: coinGrabberFill,
    positionId: coinGrabberPositionId,
    strategyId: StrategyId.COIN_GRABBER,
  })
  const { portfolio } = coinGrabberPortfolio.applyFill({
    fill: recoverySellerFill,
    positionId: recoverySellerPositionId,
    strategyId: StrategyId.RECOVERY_SELLER,
  })

  assert.equal(portfolio.positions.length, 2, "Two strategies trading ETHUSDT must create two independent Positions inside the one shared Portfolio.")
  const coinGrabberPosition = portfolio.getPosition({ positionId: coinGrabberPositionId })
  const recoverySellerPosition = portfolio.getPosition({ positionId: recoverySellerPositionId })

  assert.equal(coinGrabberPosition.strategyId, StrategyId.COIN_GRABBER, "The first Position must retain its Coin Grabber strategy owner.")
  assert.equal(coinGrabberPosition.baseQuantity.amount, "10", "Coin Grabber accounting must contain only its ten executed ETH.")
  assert.equal(coinGrabberPosition.spent.amount, "1000", "Coin Grabber recovery basis must contain only its 1,000 USDT execution cost.")
  assert.equal(recoverySellerPosition.strategyId, StrategyId.RECOVERY_SELLER, "The second Position must retain its Recovery Seller strategy owner.")
  assert.equal(recoverySellerPosition.baseQuantity.amount, "3", "Recovery Seller accounting must contain only its three executed ETH.")
  assert.equal(recoverySellerPosition.spent.amount, "600", "Recovery Seller recovery basis must contain only its 600 USDT execution cost.")
  assert.equal(portfolio.getTotalBaseQuantity({ market }).amount, "13", "Aggregate ETH custody must sum both strategy Positions without duplicating or hiding actual inventory.")
})

test("requires stable Position identity and explicit strategy ownership for each fill", () => {
  assert.throws(
    () => new Portfolio().applyFill({ fill: makeFill({ tradeId: "missing-owner" }) }),
    /positionId|strategyId/,
    "A canonical fill without its originating Position and strategy attribution must be rejected instead of being assigned implicitly.",
  )
})

test("rejects applying one canonical fill to a different strategy Position", () => {
  const fill = makeFill({ tradeId: "one-owner-only" })
  const { portfolio } = new Portfolio().applyFill({
    fill,
    positionId: "position:cg:ethusdt",
    strategyId: StrategyId.COIN_GRABBER,
  })
  const originalState = portfolio.value

  assert.throws(
    () => portfolio.applyFill({
      fill,
      positionId: "position:rs:ethusdt",
      strategyId: StrategyId.RECOVERY_SELLER,
    }),
    /Conflicting strategy attribution/,
    "A duplicate canonical execution must not be reassigned from its original strategy Position to another strategy.",
  )
  assert.deepEqual(portfolio.value, originalState, "Rejecting conflicting fill ownership must preserve every accepted Position and fill-identity fact.")
})

test("rejects ambiguous market lookup when multiple strategy Positions exist", () => {
  const { portfolio: coinGrabberPortfolio } = new Portfolio().applyFill({
    fill: makeFill({ tradeId: "ambiguous-cg", quantity: "10", quoteQuantity: "1000" }),
    positionId: "position:cg:ethusdt",
    strategyId: StrategyId.COIN_GRABBER,
  })
  const { portfolio } = coinGrabberPortfolio.applyFill({
    fill: makeFill({ tradeId: "ambiguous-rs", quantity: "3", quoteQuantity: "600" }),
    positionId: "position:rs:ethusdt",
    strategyId: StrategyId.RECOVERY_SELLER,
  })

  assert.equal(
    portfolio.getPosition({ marketId: market.id, strategyId: StrategyId.COIN_GRABBER }).id,
    "position:cg:ethusdt",
    "A strategy-scoped market lookup must return that strategy's independent Position.",
  )
  assert.throws(
    () => portfolio.getPosition({ marketId: market.id }),
    /ambiguous|positionId|strategyId/,
    "A market-only lookup must fail closed when it could select between independent strategy Positions.",
  )
})

test("allocates retained inventory only from the explicitly selected strategy Position", () => {
  const coinGrabberPositionId = "position:cg:ethusdt"
  const recoverySellerPositionId = "position:rs:ethusdt"
  const { portfolio: coinGrabberPortfolio } = new Portfolio().applyFill({
    fill: makeFill({ tradeId: "allocation-cg", quantity: "10", quoteQuantity: "1000" }),
    positionId: coinGrabberPositionId,
    strategyId: StrategyId.COIN_GRABBER,
  })
  const { portfolio } = coinGrabberPortfolio.applyFill({
    fill: makeFill({ tradeId: "allocation-rs", quantity: "3", quoteQuantity: "600" }),
    positionId: recoverySellerPositionId,
    strategyId: StrategyId.RECOVERY_SELLER,
  })

  const allocated = portfolio.allocateFreeQuantity({
    positionId: recoverySellerPositionId,
    marketId: market.id,
    strategyId: StrategyId.RECOVERY_SELLER,
    quantity: "1",
  })

  assert.equal(allocated.getPosition({ positionId: coinGrabberPositionId }).baseQuantity.amount, "10", "Allocating Recovery Seller retained inventory must not reduce Coin Grabber active inventory.")
  assert.equal(allocated.getPosition({ positionId: recoverySellerPositionId }).baseQuantity.amount, "2", "The selected Recovery Seller Position must lose exactly the allocated active quantity.")
  assert.equal(allocated.getPosition({ positionId: recoverySellerPositionId }).freeBaseQuantity.amount, "1", "The selected Recovery Seller Position must retain exactly the allocated free quantity.")
  assert.equal(allocated.getTotalBaseQuantity({ market }).amount, "13", "Moving one unit between active and free buckets must conserve aggregate exchange custody across both strategies.")
})

test("keeps legacy and recovery acquisition tranches as separate same-market Positions", () => {
  const firstPositionId = "position:rs:legacy"
  const secondPositionId = "position:rs:cycle-1"
  const { portfolio: legacyPortfolio } = new Portfolio().applyFill({
    fill: makeFill({ tradeId: "rs-legacy-buy", quantity: "50", quoteQuantity: "100" }),
    positionId: firstPositionId,
    strategyId: StrategyId.RECOVERY_SELLER,
  })
  const { portfolio } = legacyPortfolio.applyFill({
    fill: makeFill({ tradeId: "rs-cycle-buy", quantity: "10", quoteQuantity: "20" }),
    positionId: secondPositionId,
    strategyId: StrategyId.RECOVERY_SELLER,
  })

  assert.equal(portfolio.positions.length, 2, "One strategy must be able to retain distinct same-market accounting Positions when its domain needs separate legacy and cycle exposure.")
  assert.equal(portfolio.getPosition({ positionId: firstPositionId }).baseQuantity.amount, "50", "The legacy Position must preserve its own original quantity.")
  assert.equal(portfolio.getPosition({ positionId: secondPositionId }).baseQuantity.amount, "10", "The cycle Position must preserve its own independently acquired quantity.")
  assert.equal(portfolio.getPosition({ positionId: firstPositionId }).spent.amount, "100", "The legacy tranche must preserve its independent historical cost basis.")
  assert.equal(portfolio.getPosition({ positionId: secondPositionId }).spent.amount, "20", "The recovery tranche must preserve its own cost basis without merging with legacy inventory.")
  assert.equal(portfolio.getTotalBaseQuantity({ market }).amount, "60", "Aggregate market custody must include both Positions owned by the same strategy.")
})


function makeSellAllocationSide({
  grossBaseQuantity = "2",
  baseDebit = "2.01",
  quoteProceeds = "200",
  commissions = [
    {
      assetId: baseAsset.id,
      assetCode: baseAsset.code,
      amount: "0.01",
    },
    {
      assetId: quoteAsset.id,
      assetCode: quoteAsset.code,
      amount: "0.1",
    },
  ],
} = {}) {
  return {
    grossBaseQuantity,
    baseDebit,
    quoteProceeds,
    commissions,
  }
}

test("applies one allocated SELL share to its owned Position and records canonical allocation identity", () => {
  const positionId = "position:allocated-sell"
  const strategyId = StrategyId.COIN_GRABBER
  const buyFill = makeFill({
    tradeId: "allocated-buy",
    quantity: "10",
    quoteQuantity: "1000",
  })
  const sellFill = makeFill({
    tradeId: "allocated-sell",
    side: "SELL",
    quantity: "3",
    quoteQuantity: "300",
  })
  const initial = new Portfolio().applyFill({
    fill: buyFill,
    positionId,
    strategyId,
  }).portfolio
  const allocationSide = makeSellAllocationSide()
  const result = initial.applySellAllocation({
    fill: sellFill,
    allocationFingerprint: "allocation-fingerprint-1",
    allocationSide,
    positionId,
    strategyId,
  })
  const position = result.portfolio.getPosition({ positionId })
  const applied = result.portfolio.appliedFillFingerprints.find((item) => item.id === sellFill.id)
  assert.equal(result.applied, true, "A new allocation must be applied once.")
  assert.equal(result.duplicate, false, "A new allocation must not be classified as a replay.")
  assert.equal(position.baseQuantity.amount, "7.99", "Portfolio must apply only the allocated base debit.")
  assert.equal(position.quoteNetCashFlow.amount, "-800.1", "Portfolio must apply allocated quote proceeds net of allocated fees.")
  assert.equal(position.spent.amount, "1000", "Allocated SELL must preserve the Position BUY basis.")
  assert.equal(applied.allocationFingerprint, "allocation-fingerprint-1", "Portfolio must bind Fill identity to the complete allocation fingerprint.")
  assert.ok(result.portfolio.appliedFillIds.includes(sellFill.id), "The original canonical Fill ID must be recorded.")
  assert.equal(initial.getPosition({ positionId }).baseQuantity.amount, "10", "Applying an allocation must preserve the previous Portfolio snapshot.")
})

test("treats an identical allocated SELL replay as an immutable no-op", () => {
  const positionId = "position:allocated-sell-replay"
  const strategyId = StrategyId.COIN_GRABBER
  const buyFill = makeFill({
    tradeId: "allocated-buy-replay",
    quantity: "10",
    quoteQuantity: "1000",
  })
  const sellFill = makeFill({
    tradeId: "allocated-sell-replay",
    side: "SELL",
    quantity: "3",
    quoteQuantity: "300",
  })
  const initial = new Portfolio().applyFill({
    fill: buyFill,
    positionId,
    strategyId,
  }).portfolio
  const input = {
    fill: sellFill,
    allocationFingerprint: "allocation-fingerprint-replay",
    allocationSide: makeSellAllocationSide(),
    positionId,
    strategyId,
  }
  const first = initial.applySellAllocation(input)
  const replay = first.portfolio.applySellAllocation(input)
  assert.equal(replay.portfolio, first.portfolio, "An identical allocation replay must preserve the same Portfolio snapshot.")
  assert.equal(replay.applied, false, "An identical allocation replay must not apply accounting twice.")
  assert.equal(replay.duplicate, true, "An identical allocation replay must be explicitly classified.")
})

test("rejects changed allocation facts for a previously applied canonical Fill", () => {
  const positionId = "position:allocated-sell-conflict"
  const strategyId = StrategyId.COIN_GRABBER
  const buyFill = makeFill({
    tradeId: "allocated-buy-conflict",
    quantity: "10",
    quoteQuantity: "1000",
  })
  const sellFill = makeFill({
    tradeId: "allocated-sell-conflict",
    side: "SELL",
    quantity: "3",
    quoteQuantity: "300",
  })
  const initial = new Portfolio().applyFill({
    fill: buyFill,
    positionId,
    strategyId,
  }).portfolio
  const first = initial.applySellAllocation({
    fill: sellFill,
    allocationFingerprint: "allocation-fingerprint-original",
    allocationSide: makeSellAllocationSide(),
    positionId,
    strategyId,
  })
  assert.throws(
    () => first.portfolio.applySellAllocation({
      fill: sellFill,
      allocationFingerprint: "allocation-fingerprint-changed",
      allocationSide: makeSellAllocationSide(),
      positionId,
      strategyId,
    }),
    /Conflicting allocation facts reused Fill ID/,
    "One canonical Fill cannot be reallocated after its accounting attribution was recorded.",
  )
})

test("prevents a canonical full-Fill application after the Fill was applied through allocation", () => {
  const positionId = "position:allocated-sell-mode"
  const strategyId = StrategyId.COIN_GRABBER
  const buyFill = makeFill({
    tradeId: "allocated-buy-mode",
    quantity: "10",
    quoteQuantity: "1000",
  })
  const sellFill = makeFill({
    tradeId: "allocated-sell-mode",
    side: "SELL",
    quantity: "3",
    quoteQuantity: "300",
  })
  const initial = new Portfolio().applyFill({
    fill: buyFill,
    positionId,
    strategyId,
  }).portfolio
  const allocated = initial.applySellAllocation({
    fill: sellFill,
    allocationFingerprint: "allocation-fingerprint-mode",
    allocationSide: makeSellAllocationSide(),
    positionId,
    strategyId,
  })
  assert.throws(
    () => allocated.portfolio.applyFill({
      fill: sellFill,
      positionId,
      strategyId,
    }),
    /already applied with allocation metadata/,
    "The same Fill cannot later be applied as a full, unsplit execution.",
  )
})

test("rejects allocated SELL quantity greater than the canonical Fill quantity", () => {
  const positionId = "position:allocated-sell-overfill"
  const strategyId = StrategyId.COIN_GRABBER
  const buyFill = makeFill({
    tradeId: "allocated-buy-overfill",
    quantity: "10",
    quoteQuantity: "1000",
  })
  const sellFill = makeFill({
    tradeId: "allocated-sell-overfill",
    side: "SELL",
    quantity: "3",
    quoteQuantity: "300",
  })
  const initial = new Portfolio().applyFill({
    fill: buyFill,
    positionId,
    strategyId,
  }).portfolio
  assert.throws(
    () => initial.applySellAllocation({
      fill: sellFill,
      allocationFingerprint: "allocation-fingerprint-overfill",
      allocationSide: makeSellAllocationSide({
        grossBaseQuantity: "4",
        baseDebit: "4",
      }),
      positionId,
      strategyId,
    }),
    /exceeds canonical Fill quantity/,
    "An allocated Position share must not exceed the original canonical Fill quantity.",
  )
})
