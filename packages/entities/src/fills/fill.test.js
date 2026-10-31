import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { Asset } from "../assets/asset.js"
import { Commission } from "../commissions/commission.js"
import { Market } from "../markets/market.js"
import { Money } from "../money/money.js"
import { Quantity } from "../quantity/quantity.js"
import { Fill, fillErrMsgs } from "./fill.js"

describe(Fill.name, () => {
  const baseAsset = new Asset({ id: "dogecoin", code: "DOGE" })
  const quoteAsset = new Asset({ id: "fdusd", code: "FDUSD" })
  const commissionAsset = new Asset({ id: "bnb", code: "BNB" })
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
  const commission = new Commission({
    amount: new Money({ amount: "0.01", asset: commissionAsset }),
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
      commissions: [],
      commissionStatus: "UNKNOWN",
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
    assert.equal(fill.commissionStatus, "UNKNOWN")
    assert.equal("executedAt" in fill.value, false)
    assert.equal("clientOrderId" in fill.value, false)
  })

  it("represents confirmed zero commission as COMPLETE with an empty list", () => {
    const fill = createFill({ commissionStatus: "COMPLETE" })

    assert.deepEqual(fill.commissions, [])
    assert.equal(fill.commissionStatus, "COMPLETE")
    assert.deepEqual(fill.value.commissions, [])
  })

  it("stores one or multiple commissions in different assets", () => {
    const secondCommission = new Commission({
      amount: new Money({ amount: "0.25", asset: quoteAsset }),
    })
    const commissions = [commission, secondCommission]
    const fill = createFill({
      commissions,
      commissionStatus: "COMPLETE",
    })

    assert.deepEqual(fill.commissions, commissions)
    assert.equal(fill.commissions[0].amount.amount, "0.01")
    assert.equal(fill.commissions[0].amount.asset.id, "bnb")
    assert.equal(fill.commissions[1].amount.asset.id, "fdusd")
    assert.equal(fill.commissionStatus, "COMPLETE")
    assert.equal(fill.value.commissions.length, 2)
  })

  it("represents known fees with an incomplete fee collection as PARTIAL", () => {
    const fill = createFill({
      commissions: [commission],
      commissionStatus: "PARTIAL",
    })

    assert.equal(fill.commissions.length, 1)
    assert.equal(fill.commissionStatus, "PARTIAL")
  })

  it("rejects invalid commission collections and status combinations", () => {
    assert.throws(
      () => createFill({ commissions: {} }),
      { message: fillErrMsgs.commissions },
    )
    assert.throws(
      () => createFill({ commissions: ["0.01"] }),
      { message: fillErrMsgs.commissions },
    )
    assert.throws(
      () => createFill({ commissions: new Array(1) }),
      { message: fillErrMsgs.commissions },
    )
    assert.throws(
      () => createFill({ commissionStatus: "INCOMPLETE" }),
      { message: fillErrMsgs.commissionStatus },
    )
    assert.throws(
      () => createFill({ commissionStatus: "PARTIAL" }),
      { message: fillErrMsgs.partialCommissions },
    )
    assert.throws(
      () => createFill({
        commissions: [commission],
        commissionStatus: "UNKNOWN",
      }),
      { message: fillErrMsgs.unknownCommissions },
    )
  })

  it("scopes stable trade identity by market", () => {
    const otherMarket = new Market({
      venue: "binance",
      symbol: "DOGEUSDT",
      baseAsset,
      quoteAsset: otherQuoteAsset,
    })
    const otherFill = createFill({
      market: otherMarket,
      price: new Money({ amount: "0.1", asset: otherQuoteAsset }),
      quoteQuantity: new Money({ amount: "10", asset: otherQuoteAsset }),
    })

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
    const fill = createFill({
      commissions: [commission],
      commissionStatus: "COMPLETE",
    })
    const snapshot = fill.value

    snapshot.tradeId = "other"
    snapshot.market.symbol = "OTHER"
    snapshot.price.amount = "99"
    snapshot.quantity.amount = "999"
    snapshot.commissions[0].amount.amount = "999"

    assert.equal(fill.tradeId, "trade-1001")
    assert.equal(fill.market.symbol, "DOGEFDUSD")
    assert.equal(fill.price.amount, "0.1")
    assert.equal(fill.quantity.amount, "100")
    assert.equal(fill.commissions[0].amount.amount, "0.01")
    assert.notStrictEqual(fill.value, snapshot)
    assert.throws(() => {
      fill.side = "SELL"
    }, TypeError)
  })
})
