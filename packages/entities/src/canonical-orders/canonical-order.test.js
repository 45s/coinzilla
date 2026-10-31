import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { Asset } from "../assets/asset.js"
import { Market } from "../markets/market.js"
import { Money } from "../money/money.js"
import { Quantity } from "../quantity/quantity.js"
import {
  CanonicalOrder,
  canonicalOrderErrMsgs,
} from "./canonical-order.js"

describe(CanonicalOrder.name, () => {
  const baseAsset = new Asset({ id: "dogecoin", code: "DOGE" })
  const quoteAsset = new Asset({ id: "fdusd", code: "FDUSD" })
  const market = new Market({
    venue: "binance",
    symbol: "DOGEFDUSD",
    baseAsset,
    quoteAsset,
  })
  const createOrder = (overrides = {}) =>
    new CanonicalOrder({
      clientOrderId: "bot-order-001",
      market,
      side: "BUY",
      type: "LIMIT",
      limitPrice: new Money({ amount: "0.1", asset: quoteAsset }),
      originalQuantity: new Quantity({ amount: "100", asset: baseAsset }),
      executedQuantity: new Quantity({ amount: "0", asset: baseAsset }),
      ...overrides,
    })

  it("represents a pending order intent before broker acknowledgement", () => {
    const order = createOrder()

    assert.equal(order.clientOrderId, "bot-order-001")
    assert.equal(order.brokerOrderId, undefined)
    assert.equal(order.status, "PENDING")
    assert.equal(order.remainingQuantity.amount, "100")
    assert.deepEqual(order.value, {
      clientOrderId: "bot-order-001",
      market: market.value,
      side: "BUY",
      type: "LIMIT",
      limitPrice: { amount: "0.1", asset: quoteAsset.value },
      originalQuantity: { amount: "100", asset: baseAsset.value },
      executedQuantity: { amount: "0", asset: baseAsset.value },
      remainingQuantity: { amount: "100", asset: baseAsset.value },
      status: "PENDING",
    })
  })

  it("represents an acknowledged open order with both identities", () => {
    const order = createOrder({
      brokerOrderId: "123456",
      status: "OPEN",
      acknowledgedAt: 1_800_000_000_000,
    })

    assert.equal(order.clientOrderId, "bot-order-001")
    assert.equal(order.brokerOrderId, "123456")
    assert.equal(order.status, "OPEN")
    assert.equal(order.acknowledgedAt, 1_800_000_000_000)
  })

  it("derives exact remaining quantity for a partially filled order", () => {
    const order = createOrder({
      brokerOrderId: "123456",
      status: "PARTIALLY_FILLED",
      executedQuantity: new Quantity({
        amount: "12.3400",
        asset: baseAsset,
      }),
    })

    assert.equal(order.executedQuantity.amount, "12.34")
    assert.equal(order.remainingQuantity.amount, "87.66")
  })

  it("requires a fully executed quantity for FILLED status", () => {
    const order = createOrder({
      brokerOrderId: "123456",
      status: "FILLED",
      executedQuantity: new Quantity({ amount: "100", asset: baseAsset }),
    })

    assert.equal(order.remainingQuantity.amount, "0")
    assert.throws(
      () => createOrder({ brokerOrderId: "123456", status: "FILLED" }),
      { message: canonicalOrderErrMsgs.filledExecution },
    )
  })

  it("supports explicit UNKNOWN outcome without inventing broker acknowledgement", () => {
    const order = createOrder({ status: "UNKNOWN" })

    assert.equal(order.status, "UNKNOWN")
    assert.equal(order.brokerOrderId, undefined)
  })

  it("supports market orders without a limit price", () => {
    const order = createOrder({
      type: "MARKET",
      limitPrice: undefined,
      brokerOrderId: "123456",
      status: "OPEN",
    })

    assert.equal(order.limitPrice, undefined)
    assert.equal("limitPrice" in order.value, false)
  })

  it("rejects a market order with a limit price", () => {
    assert.throws(
      () => createOrder({ type: "MARKET" }),
      { message: canonicalOrderErrMsgs.marketPrice },
    )
  })

  it("rejects limit orders without a quote-asset Money price", () => {
    assert.throws(
      () => createOrder({ limitPrice: undefined }),
      { message: canonicalOrderErrMsgs.limitPrice },
    )
    assert.throws(
      () => createOrder({
        limitPrice: new Money({
          amount: "0.1",
          asset: baseAsset,
        }),
      }),
      { message: canonicalOrderErrMsgs.priceAsset },
    )
  })

  it("rejects mismatched markets and quantity assets", () => {
    assert.throws(
      () => createOrder({ market: {} }),
      { message: canonicalOrderErrMsgs.market },
    )
    assert.throws(
      () => createOrder({
        originalQuantity: new Quantity({
          amount: "100",
          asset: quoteAsset,
        }),
      }),
      { message: canonicalOrderErrMsgs.quantityAsset },
    )
  })

  it("rejects executed quantities greater than the original quantity", () => {
    assert.throws(
      () => createOrder({
        executedQuantity: new Quantity({
          amount: "100.0001",
          asset: baseAsset,
        }),
      }),
      { message: canonicalOrderErrMsgs.executedRange },
    )
  })

  it("validates lifecycle status against execution quantities", () => {
    assert.throws(
      () => createOrder({
        brokerOrderId: "123456",
        status: "OPEN",
        executedQuantity: new Quantity({ amount: "1", asset: baseAsset }),
      }),
      { message: canonicalOrderErrMsgs.openExecution },
    )
    assert.throws(
      () => createOrder({
        brokerOrderId: "123456",
        status: "PARTIALLY_FILLED",
      }),
      { message: canonicalOrderErrMsgs.partialExecution },
    )
    assert.throws(
      () => createOrder({
        brokerOrderId: "123456",
        status: "PENDING",
        executedQuantity: new Quantity({ amount: "1", asset: baseAsset }),
      }),
      { message: canonicalOrderErrMsgs.pendingExecution },
    )
  })

  it("requires broker identity for acknowledged lifecycle states", () => {
    for (const status of [
      "OPEN",
      "PARTIALLY_FILLED",
      "FILLED",
      "CANCELED",
      "EXPIRED",
    ]) {
      assert.throws(
        () => createOrder({ status }),
        { message: canonicalOrderErrMsgs.brokerAcknowledgement },
      )
    }
  })

  it("validates client identity, side, type, and status", () => {
    assert.throws(
      () => createOrder({ clientOrderId: " " }),
      { message: canonicalOrderErrMsgs.clientOrderId },
    )
    assert.throws(
      () => createOrder({ side: "buy" }),
      { message: canonicalOrderErrMsgs.side },
    )
    assert.throws(
      () => createOrder({ type: "STOP" }),
      { message: canonicalOrderErrMsgs.type },
    )
    assert.throws(
      () => createOrder({ status: "PARTIAL" }),
      { message: canonicalOrderErrMsgs.status },
    )
  })

  it("validates optional timestamps", () => {
    assert.throws(
      () => createOrder({ createdAt: -1 }),
      { message: canonicalOrderErrMsgs.timestamp },
    )
    assert.throws(
      () => createOrder({ updatedAt: 1.5 }),
      { message: canonicalOrderErrMsgs.timestamp },
    )
  })

  it("returns an independent value snapshot and is immutable", () => {
    const order = createOrder()
    const snapshot = order.value

    snapshot.clientOrderId = "other"
    snapshot.market.symbol = "OTHER"
    snapshot.originalQuantity.amount = "999"

    assert.equal(order.clientOrderId, "bot-order-001")
    assert.equal(order.market.symbol, "DOGEFDUSD")
    assert.equal(order.originalQuantity.amount, "100")
    assert.notStrictEqual(order.value, snapshot)
    assert.throws(() => {
      order.status = "FILLED"
    }, TypeError)
  })
})
