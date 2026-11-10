import test from "node:test"
import assert from "node:assert/strict"
import {
  normalizeTradeHistory,
  parseTradeHistoryArguments,
} from "./testnet-trade-history-utils.js"

test("normalizes BUY/SELL trade facts and orders by execution time", () => {
  const { trades } = normalizeTradeHistory({
    trades: [
      { id: 2, orderId: 20, time: 200, price: "2.5", qty: "4", quoteQty: "10", commission: "0.01", commissionAsset: "USDT", isBuyer: false, isMaker: true },
      { id: 1, orderId: 10, time: 100, price: "2.5", qty: "4", quoteQty: "10", commission: "0.02", commissionAsset: "DOGE", isBuyer: true, isMaker: false },
    ],
  })

  assert.deepEqual(trades.map(({ tradeId, side, liquidity }) => ({ tradeId, side, liquidity })), [
    { tradeId: 1, side: "BUY", liquidity: "TAKER" },
    { tradeId: 2, side: "SELL", liquidity: "MAKER" },
  ])
  assert.equal(trades[0].commission, "0.02")
  assert.equal(trades[0].commissionAsset, "DOGE")
})

test("rejects incomplete commission facts", () => {
  assert.throws(() => normalizeTradeHistory({
    trades: [{
      id: 1, orderId: 10, time: 100, price: "2", qty: "1", quoteQty: "2",
      commission: "0", commissionAsset: "", isBuyer: true, isMaker: true,
    }],
  }), /commissionAsset/)
})

test("parses the default symbol and maximum limit", () => {
  assert.deepEqual(parseTradeHistoryArguments({ args: [] }), {
    symbol: "DOGEUSDT",
    limit: 1000,
  })
  assert.deepEqual(parseTradeHistoryArguments({ args: ["DOGEUSDT", "1000", "212000"] }), {
    symbol: "DOGEUSDT",
    limit: 1000,
    fromId: 212000,
  })
})

test("rejects invalid trade-history arguments", () => {
  assert.throws(() => parseTradeHistoryArguments({ args: ["DOGEUSDT", "1001"] }), /between 1 and 1000/)
  assert.throws(() => parseTradeHistoryArguments({ args: ["DOGE/USDT"] }), /Symbol/)
  assert.throws(() => parseTradeHistoryArguments({ args: ["DOGEUSDT", "100", "-1"] }), /fromId/)
})
