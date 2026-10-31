import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { Asset } from "../assets/asset.js"
import { Market } from "../markets/market.js"
import { Money } from "../money/money.js"
import { Quantity } from "../quantity/quantity.js"
import { Fill, fillErrMsgs } from "./fill.js"

describe(Fill.name, () => {
  const baseAsset = new Asset({ id: "dogecoin", code: "DOGE" })
  const quoteAsset = new Asset({ id: "fdusd", code: "FDUSD" })
  const otherQuoteAsset = new Asset({ id: "usdt", code: "USDT" })
  const market = new Market({
    venue: "binance",
    symbol: "DOGEFDUSD",
    baseAsset,
    quoteAsset,
  })
  const createFill = (overrides = {}) =>
    new Fill({
      tradeId: "trade-1001",
      brokerOrderId: "order-42",
      clientOrderId: "client-42",
      market,
      side: "BUY",
      price: new Money({ amount: "0.1", asset: quoteAsset }),
      quantity: new Quantity({ amount: "100", asset: baseAsset }),
      quoteQuantity: new Money({ amount: "10", asset: quoteAsset }),
      liquidityRole: "MAKER",
      executedAt: 1_800_000_000_000,
      ...overrides,
    })

  it("stores exact execution facts with explicit asset identity", () => {
    const fill = createFill()

    assert.equal(fill.id, "binance:DOGEFDUSD:trade-1001")
    assert.equal(fill.tradeId, "trade-1001")
    assert.equal(fill.brokerOrderId, "order-42")
    assert.equal(fill.clientOrderId, "client-42")
    assert.equal(fill.price.amount, "0.1")
    assert.equal(fill.quantity.amount, "100")
    assert.equal(fill.quoteQuantity.amount, "10")
    assert.equal(fill.liquidityRole, "MAKER")
    assert.deepEqual(fill.value, {
      id: "binance:DOGEFDUSD:trade-1001",
      tradeId: "trade-1001",
      brokerOrderId: "order-42",
      clientOrderId: "client-42",
      market: market.value,
      side: "BUY",
      price: { amount: "0.1", asset: quoteAsset.value },
      quantity: { amount: "100", asset: baseAsset.value },
      quoteQuantity: { amount: "10", asset: quoteAsset.value },
      liquidityRole: "MAKER",
      executedAt: 1_800_000_000_000,
    })
  })

  it("defaults missing liquidity role to UNKNOWN and leaves missing time absent", () => {
    const fill = createFill({
      liquidityRole: undefined,
      executedAt: undefined,
      clientOrderId: undefined,
    })

    assert.equal(fill.liquidityRole, "UNKNOWN")
    assert.equal(fill.executedAt, undefined)
    assert.equal(fill.clientOrderId, undefined)
    assert.equal("executedAt" in fill.value, false)
    assert.equal("clientOrderId" in fill.value, false)
  })

  it("scopes stable trade identity by market", () => {
    const otherMarket = new Market({
      venue: "binance",
      symbol: "DOGEUSDT",
      baseAsset,
      quoteAsset: otherQuoteAsset,
    })
    const otherFill = createFill({ market: otherMarket })

    assert.notEqual(otherFill.id, createFill().id)
    assert.equal(otherFill.tradeId, createFill().tradeId)
  })

  it("rejects missing or invalid identifiers", () => {
    assert.throws(() => createFill({ tradeId: " " }), { message: fillErrMsgs.tradeId })
    assert.throws(() => createFill({ brokerOrderId: "" }), { message: fillErrMsgs.brokerOrderId })
    assert.throws(() => createFill({ clientOrderId: " " }), { message: fillErrMsgs.clientOrderId })
  })

  it("rejects invalid market, side, and value types", () => {
    assert.throws(() => createFill({ market: {} }), { message: fillErrMsgs.market })
    assert.throws(() => createFill({ side: "buy" }), { message: fillErrMsgs.side })
    assert.throws(() => createFill({ price: "0.1" }), { message: fillErrMsgs.price })
    assert.throws(() => createFill({ quantity: "1" }), { message: fillErrMsgs.quantity })
    assert.throws(() => createFill({ quoteQuantity: "1" }), { message: fillErrMsgs.quoteQuantity })
  })

  it("rejects amounts denominated in the wrong assets", () => {
    assert.throws(
      () => createFill({
        price: new Money({ amount: "0.1", asset: baseAsset }),
      }),
      { message: fillErrMsgs.priceAsset },
    )
    assert.throws(
      () => createFill({
        quantity: new Quantity({ amount: "100", asset: quoteAsset }),
      }),
      { message: fillErrMsgs.quantityAsset },
    )
    assert.throws(
      () => createFill({
        quoteQuantity: new Money({ amount: "10", asset: otherQuoteAsset }),
      }),
      { message: fillErrMsgs.quoteQuantityAsset },
    )
  })

  it("requires positive price and quantities", () => {
    assert.throws(
      () => createFill({ price: new Money({ amount: "0", asset: quoteAsset }) }),
      { message: fillErrMsgs.positivePrice },
    )
    assert.throws(
      () => createFill({ price: new Money({ amount: "-0.1", asset: quoteAsset }) }),
      { message: fillErrMsgs.positivePrice },
    )
    assert.throws(
      () => createFill({ quantity: new Quantity({ amount: "0", asset: baseAsset }) }),
      { message: fillErrMsgs.positiveQuantity },
    )
    assert.throws(
      () => createFill({ quoteQuantity: new Money({ amount: "0", asset: quoteAsset }) }),
      { message: fillErrMsgs.positiveQuoteQuantity },
    )
  })

  it("rejects unsupported liquidity roles and invalid timestamps", () => {
    assert.throws(
      () => createFill({ liquidityRole: "UNKNOWN_ROLE" }),
      { message: fillErrMsgs.liquidityRole },
    )
    assert.throws(
      () => createFill({ executedAt: -1 }),
      { message: fillErrMsgs.executedAt },
    )
    assert.throws(
      () => createFill({ executedAt: 1.5 }),
      { message: fillErrMsgs.executedAt },
    )
  })

  it("returns independent snapshots and is immutable", () => {
    const fill = createFill()
    const snapshot = fill.value

    snapshot.tradeId = "other"
    snapshot.market.symbol = "OTHER"
    snapshot.price.amount = "99"
    snapshot.quantity.amount = "999"

    assert.equal(fill.tradeId, "trade-1001")
    assert.equal(fill.market.symbol, "DOGEFDUSD")
    assert.equal(fill.price.amount, "0.1")
    assert.equal(fill.quantity.amount, "100")
    assert.notStrictEqual(fill.value, snapshot)
    assert.throws(() => {
      fill.side = "SELL"
    }, TypeError)
  })
})
