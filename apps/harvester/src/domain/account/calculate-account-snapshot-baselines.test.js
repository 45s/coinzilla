import test from "node:test"
import assert from "node:assert/strict"
import { Asset, CanonicalOrder, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { Portfolio } from "../portfolio/portfolio.js"
import { calculateAccountSnapshotBaselines } from "./calculate-account-snapshot-baselines.js"

const usdt = new Asset({ id: "asset:USDT", code: "USDT" })
const btc = new Asset({ id: "asset:BTC", code: "BTC" })
const eth = new Asset({ id: "asset:ETH", code: "ETH" })
const btcMarket = new Market({ venue: "binance", symbol: "BTCUSDT", baseAsset: btc, quoteAsset: usdt })
const ethMarket = new Market({ venue: "binance", symbol: "ETHUSDT", baseAsset: eth, quoteAsset: usdt })

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
    .applyFill({ fill: makeBuyFill({ market: btcMarket, tradeId: "btc-buy", quantity: "10", quoteQuantity: "100" }) }).portfolio
    .applyFill({ fill: makeBuyFill({ market: ethMarket, tradeId: "eth-buy", quantity: "5", quoteQuantity: "50" }) }).portfolio
  const activeOrders = [
    makeOrder({ market: btcMarket, clientOrderId: "btc-buy-open", side: "BUY", originalQuantity: "3", executedQuantity: "1", limitPrice: "10" }),
    makeOrder({ market: ethMarket, clientOrderId: "eth-buy-open", side: "BUY", originalQuantity: "4", executedQuantity: "1", limitPrice: "20" }),
    makeOrder({ market: btcMarket, clientOrderId: "btc-sell-open", side: "SELL", originalQuantity: "5", executedQuantity: "1", limitPrice: "11" }),
    makeOrder({ market: ethMarket, clientOrderId: "eth-sell-open", side: "SELL", originalQuantity: "3", executedQuantity: "2", limitPrice: "21" }),
  ]

  const result = calculateAccountSnapshotBaselines({ portfolio, activeOrders })

  assert.equal(result.ok, true, "Canonical Portfolio and active orders must produce a complete accounting baseline.")
  assert.deepEqual(result.data.quoteCashFlowBaseline, [{ assetId: usdt.id, amount: "-150" }], "Quote cash flow from all markets sharing USDT must aggregate exactly once.")
  assert.deepEqual(result.data.activeBaseQuantityBaseline, [
    { assetId: btc.id, amount: "10" },
    { assetId: eth.id, amount: "5" },
  ], "Active base inventory must remain isolated by asset while aggregating positions across markets.")
  assert.deepEqual(result.data.committedQuoteBalanceBaseline, [{ assetId: usdt.id, amount: "80" }], "Remaining BUY commitments across BTCUSDT and ETHUSDT must aggregate against the shared USDT asset.")
  assert.deepEqual(result.data.committedBaseBalanceBaseline, [
    { assetId: btc.id, amount: "4" },
    { assetId: eth.id, amount: "1" },
  ], "Remaining SELL commitments must aggregate independently for each shared base asset.")
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
