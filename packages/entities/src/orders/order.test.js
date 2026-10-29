import assert from "node:assert"
import { describe, it } from "node:test"
import { generateUUID } from "@coinzilla/utils"
import { Order } from "./order.js"
import { errMsgs } from "./err-msgs.js"

describe(`${Order.name}`, () => {
  const symbol = "btcusdt"
  const quantity = 0.1
  const type = "LIMIT"
  const side = "BUY"
  const price = 23_456
  const id = generateUUID()

  const validOrder = (overrides = {}) =>
    new Order({ symbol, type, side, quantity, price, id, ...overrides })

  it("should normalize and expose all order fields", () => {
    const o = validOrder({ symbol: "  btcusdt  " })

    assert.strictEqual(o.symbol, "BTCUSDT")
    assert.strictEqual(o.type, type)
    assert.strictEqual(o.side, side)
    assert.strictEqual(o.quantity, quantity)
    assert.strictEqual(o.price, price)
    assert.strictEqual(o.id, id)
    assert.deepStrictEqual(o.value, {
      id,
      symbol: "BTCUSDT",
      type,
      side,
      quantity,
      price,
    })
  })

  it("should support every declared order type", () => {
    for (const supportedType of ["LIMIT", "MARKET"]) {
      assert.strictEqual(validOrder({ type: supportedType }).type, supportedType)
    }
  })

  it("should reject missing, non-string, or blank symbols", () => {
    for (const invalidSymbol of [undefined, null, "", "   ", 123]) {
      assert.throws(
        () => validOrder({ symbol: invalidSymbol }),
        { message: errMsgs.symbol },
      )
    }
  })

  it("should reject unsupported order types", () => {
    for (const invalidType of [undefined, null, "", "limit", "STOP", 1]) {
      assert.throws(
        () => validOrder({ type: invalidType }),
        { message: errMsgs.type },
      )
    }
  })

  it("should reject unsupported order sides", () => {
    for (const invalidSide of [undefined, null, "", "buy", "SELL ", 1]) {
      assert.throws(
        () => validOrder({ side: invalidSide }),
        { message: errMsgs.side },
      )
    }
  })

  it("should reject invalid quantities", () => {
    for (const invalidQuantity of [
      undefined,
      null,
      "23",
      NaN,
      Infinity,
      -Infinity,
      0,
      -1,
    ]) {
      assert.throws(
        () => validOrder({ quantity: invalidQuantity }),
        { message: errMsgs.quantity },
      )
    }
  })

  it("should reject invalid prices", () => {
    for (const invalidPrice of [
      undefined,
      null,
      "43",
      NaN,
      Infinity,
      -Infinity,
      0,
      -1,
    ]) {
      assert.throws(
        () => validOrder({ price: invalidPrice }),
        { message: errMsgs.price },
      )
    }
  })

  it("should reject missing, non-string, or blank IDs", () => {
    for (const invalidId of [undefined, null, "", "    ", 123]) {
      assert.throws(
        () => validOrder({ id: invalidId }),
        { message: errMsgs.id },
      )
    }
  })
})

  it("rejects zero quantity and zero price independently", () => {
    const input = { symbol: "BTCUSDT", type: "LIMIT", side: "BUY", quantity: 1, price: 10, id: "test-id" }
    assert.throws(() => new Order({ ...input, quantity: 0 }), { message: errMsgs.quantity })
    assert.throws(() => new Order({ ...input, price: 0 }), { message: errMsgs.price })
  })
