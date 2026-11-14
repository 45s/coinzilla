import { StrategyId } from "../strategies/strategy-ids.js"
import test from "node:test"
import assert from "node:assert/strict"
import { Asset, CanonicalOrder, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { Portfolio } from "../portfolio/portfolio.js"
import { calculateAccountSnapshotBaselines } from "./calculate-account-snapshot-baselines.js"

const usdt = new Asset({ id: "asset:USDT", code: "USDT" })
const btc = new Asset({ id: "asset:BTC", code: "BTC" })
const eth = new Asset({ id: "asset:ETH", code: "ETH" })
const fdusd = new Asset({ id: "asset:FDUSD", code: "FDUSD" })
const btcMarket = new Market({ venue: "binance", symbol: "BTCUSDT", baseAsset: btc, quoteAsset: usdt })
const ethMarket = new Market({ venue: "binance", symbol: "ETHUSDT", baseAsset: eth, quoteAsset: usdt })
const btcFdusdMarket = new Market({ venue: "binance", symbol: "BTCFDUSD", baseAsset: btc, quoteAsset: fdusd })

function makeBuyFill({ market, tradeId, quantity, quoteQuantity }) {
  return new Fill({
    tradeId,
    brokerOrderId: "broker-" + tradeId,
    market,
    side: "BUY",
    price: new Money({ amount: "10", asset: market.quoteAsset }),
    quantity: new Quantity({ amount: quantity, asset: market.baseAsset }),
    quoteQuantity: new Money({ amount: quoteQuantity, asset: market.quoteAsset }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
}

function makeOrder({ market, clientOrderId, side, originalQuantity, executedQuantity, limitPrice, status = "PARTIALLY_FILLED" }) {
  return new CanonicalOrder({
    clientOrderId,
    brokerOrderId: "broker-" + clientOrderId,
    market,
    side,
    type: limitPrice ? "LIMIT" : "MARKET",
    ...(limitPrice ? { limitPrice: new Money({ amount: limitPrice, asset: market.quoteAsset }) } : {}),
    originalQuantity: new Quantity({ amount: originalQuantity, asset: market.baseAsset }),
    executedQuantity: new Quantity({ amount: executedQuantity, asset: market.baseAsset }),
    status,
  })
}

test("aggregates Portfolio and active-order baselines by shared exchange asset", () => {
  const portfolio = new Portfolio()
    .applyFill({ fill: makeBuyFill({ market: btcMarket, tradeId: "btc-buy", quantity: "10", quoteQuantity: "100" }), strategyId: StrategyId.COIN_GRABBER }).portfolio
    .applyFill({ fill: makeBuyFill({ market: ethMarket, tradeId: "eth-buy", quantity: "5", quoteQuantity: "50" }), strategyId: StrategyId.COIN_GRABBER }).portfolio
    .applyFill({ fill: makeBuyFill({ market: btcFdusdMarket, tradeId: "btc-fdusd-buy", quantity: "5", quoteQuantity: "25" }), strategyId: StrategyId.COIN_GRABBER }).portfolio
  const portfolioWithRetainedFreeBase = portfolio.allocateFreeQuantity({
    marketId: btcMarket.id,
    quantity: "2", strategyId: StrategyId.COIN_GRABBER
  })
  const activeOrders = [
    makeOrder({ market: btcMarket, clientOrderId: "btc-buy-open", side: "BUY", originalQuantity: "3", executedQuantity: "1", limitPrice: "10" }),
    makeOrder({ market: ethMarket, clientOrderId: "eth-buy-open", side: "BUY", originalQuantity: "4", executedQuantity: "1", limitPrice: "20" }),
    makeOrder({ market: btcMarket, clientOrderId: "btc-sell-open", side: "SELL", originalQuantity: "5", executedQuantity: "1", limitPrice: "11" }),
    makeOrder({ market: ethMarket, clientOrderId: "eth-sell-open", side: "SELL", originalQuantity: "3", executedQuantity: "2", limitPrice: "21" }),
    makeOrder({ market: btcFdusdMarket, clientOrderId: "btc-fdusd-sell-open", side: "SELL", originalQuantity: "3", executedQuantity: "1", limitPrice: "6" }),
  ]

  const result = calculateAccountSnapshotBaselines({ portfolio: portfolioWithRetainedFreeBase, activeOrders })

  assert.equal(result.ok, true, "Canonical Portfolio and active orders must produce a complete accounting baseline.")
  assert.deepEqual(result.data.quoteCashFlowBaseline, [
    { assetId: fdusd.id, amount: "-25" },
    { assetId: usdt.id, amount: "-150" },
  ], "Quote cash flow from markets sharing USDT must aggregate exactly once while separate quote assets remain isolated.")
  assert.equal(portfolioWithRetainedFreeBase.getPosition({ marketId: btcMarket.id }).baseQuantity.amount, "8", "Free allocation must reduce only the strategy-active quantity for the selected market.")
  assert.equal(portfolioWithRetainedFreeBase.getPosition({ marketId: btcMarket.id }).freeBaseQuantity.amount, "2", "The allocated keep quantity must remain explicitly tracked as retained free inventory.")
  assert.equal(portfolioWithRetainedFreeBase.getPosition({ marketId: btcMarket.id }).totalBaseQuantity.amount, "10", "Moving quantity from active to retained free inventory must conserve total Portfolio base holdings.")
  assert.deepEqual(result.data.portfolioBaseQuantityBaseline, [
    { assetId: btc.id, amount: "15" },
    { assetId: eth.id, amount: "5" },
  ], "Total Portfolio base inventory, including retained free quantity, must remain isolated by asset while aggregating positions across markets.")
  assert.deepEqual(result.data.committedQuoteBalanceBaseline, [{ assetId: usdt.id, amount: "80" }], "Remaining BUY commitments across BTCUSDT and ETHUSDT must aggregate against the shared USDT asset.")
  assert.deepEqual(result.data.committedBaseBalanceBaseline, [
    { assetId: btc.id, amount: "6" },
    { assetId: eth.id, amount: "1" },
  ], "Remaining SELL commitments must aggregate independently for each shared base asset.")
})

test("rejects terminal orders from the active commitment baseline", () => {
  const result = calculateAccountSnapshotBaselines({
    portfolio: new Portfolio(),
    activeOrders: [
      makeOrder({
        market: btcMarket,
        clientOrderId: "canceled-buy",
        side: "BUY",
        originalQuantity: "1",
        executedQuantity: "0",
        limitPrice: "50",
        status: "CANCELED",
      }),
    ],
  })

  assert.equal(result.ok, false, "A terminal order must not be silently counted as an active account reservation.")
  assert.match(result.errors[0].message, /only active orders/, "The baseline must reject terminal order state instead of including released commitment.")
})

test("fails closed when an active MARKET BUY has no canonical quote commitment", () => {
  const result = calculateAccountSnapshotBaselines({
    portfolio: new Portfolio(),
    activeOrders: [
      makeOrder({
        market: btcMarket,
        clientOrderId: "unknown-market-buy",
        side: "BUY",
        originalQuantity: "1",
        executedQuantity: "0",
        status: "UNKNOWN",
      }),
    ],
  })

  assert.equal(result.ok, false, "An unresolved MARKET BUY without a limit price cannot be assigned a trustworthy quote reservation.")
  assert.match(result.errors[0].message, /without a canonical limit price/, "The baseline failure must explain why the account free-balance baseline cannot be trusted.")
})


test("rejects non-Portfolio and non-canonical active-order inputs", () => {
  const invalidPortfolio = calculateAccountSnapshotBaselines({
    portfolio: { positions: [] },
    activeOrders: [],
  })
  assert.equal(invalidPortfolio.ok, false, "A plain object must not be accepted as the canonical Portfolio accounting projection.")
  assert.match(invalidPortfolio.errors[0].message, /requires a Portfolio/, "The validation error must identify the required Portfolio domain value.")

  const nonArrayOrders = calculateAccountSnapshotBaselines({
    portfolio: new Portfolio(),
    activeOrders: null,
  })
  assert.equal(nonArrayOrders.ok, false, "A missing active-order collection must be rejected before account baselines are calculated.")
  assert.match(nonArrayOrders.errors[0].message, /activeOrders must contain CanonicalOrder values/, "The validation error must identify the canonical active-order collection contract.")

  const nonCanonicalOrder = calculateAccountSnapshotBaselines({
    portfolio: new Portfolio(),
    activeOrders: [{}],
  })
  assert.equal(nonCanonicalOrder.ok, false, "Plain order-shaped objects must not be trusted as canonical active exchange orders.")
  assert.match(nonCanonicalOrder.errors[0].message, /activeOrders must contain CanonicalOrder values/, "The validation error must identify the canonical active-order collection contract.")
})


test("aggregates same-market strategy Positions into one actual account custody baseline", () => {
  const { portfolio: coinGrabberPortfolio } = new Portfolio().applyFill({
    fill: makeBuyFill({ market: btcMarket, tradeId: "cg-btc-buy", quantity: "10", quoteQuantity: "100" }),
    positionId: "position:cg:btcusdt",
    strategyId: StrategyId.COIN_GRABBER,
  })
  const { portfolio } = coinGrabberPortfolio.applyFill({
    fill: makeBuyFill({ market: btcMarket, tradeId: "rs-btc-buy", quantity: "3", quoteQuantity: "60" }),
    positionId: "position:rs:btcusdt",
    strategyId: StrategyId.RECOVERY_SELLER,
  })

  const result = calculateAccountSnapshotBaselines({ portfolio, activeOrders: [] })

  assert.equal(portfolio.positions.length, 2, "The shared Portfolio must retain both strategy-owned BTCUSDT Positions instead of collapsing them by market.")
  assert.equal(result.ok, true, "Multiple strategy Positions must produce one valid aggregate exchange-account baseline.")
  assert.deepEqual(
    result.data.portfolioBaseQuantityBaseline,
    [{ assetId: btc.id, amount: "13" }],
    "The account baseline must sum the ten CG BTC and three RS BTC exactly once as thirteen units of shared custody.",
  )
  assert.deepEqual(
    result.data.quoteCashFlowBaseline,
    [{ assetId: usdt.id, amount: "-160" }],
    "The account baseline must aggregate both strategy quote cash flows without merging their independent Position cost bases.",
  )
})
