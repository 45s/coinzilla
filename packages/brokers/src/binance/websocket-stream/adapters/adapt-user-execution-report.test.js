import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { adaptUser } from "./user.js"

describe("adaptUser.executionReport", () => {
  it("maps order, fill, commission, and trailing metadata", () => {
    assert.deepEqual(adaptUser.executionReport({
      E: 10, s: "BTCUSDT", c: "new-client", C: "old-client", S: "SELL",
      o: "LIMIT", f: "GTC", q: "2.5", p: "100", x: "TRADE", P: "95",
      d: 12, F: "0.1", X: "PARTIALLY_FILLED", r: "NONE", i: 77, T: 11,
      l: "0.5", z: "1.5", L: "99", n: "0.01", N: "BNB", t: 9, w: true,
      m: false, O: 8, Z: "148.5", g: -1, Q: "2.5", Y: "49.5", D: 7,
    }), {
      eventType: "executionReport", eventTime: 10, symbol: "BTCUSDT",
      newClientOrderId: "new-client", originalClientOrderId: "old-client",
      side: "SELL", orderType: "LIMIT", timeInForce: "GTC", quantity: "2.5",
      price: "100", executionType: "TRADE", stopPrice: "95", trailingDelta: 12,
      icebergQuantity: "0.1", orderStatus: "PARTIALLY_FILLED",
      orderRejectReason: "NONE", orderId: 77, orderTime: 11,
      lastTradeQuantity: "0.5", totalTradeQuantity: "1.5", priceLastTrade: "99",
      commission: "0.01", commissionAsset: "BNB", tradeId: 9, isOrderWorking: true,
      isMaker: false, creationTime: 8, totalQuoteTradeQuantity: "148.5",
      orderListId: -1, quoteOrderQuantity: "2.5", lastQuoteTransacted: "49.5",
      trailingTime: 7,
    })
  })
})

it("preserves zero fill and commission values", () => {
  const result = adaptUser.executionReport({
    E: 0, s: "BTCUSDT", c: "client", C: "", S: "BUY", o: "LIMIT",
    f: "GTC", q: "1", p: "100", x: "NEW", P: "0", F: "0", X: "NEW",
    r: "NONE", i: 1, T: 0, l: "0", z: "0", L: "0", n: "0", N: null,
    t: -1, w: false, m: false, O: 0, Z: "0", g: -1, Q: "1", Y: "0",
  })
  assert.equal(result.lastTradeQuantity, "0")
  assert.equal(result.totalTradeQuantity, "0")
  assert.equal(result.commission, "0")
  assert.equal(result.commissionAsset, null)
  assert.equal(result.isMaker, false)
})
