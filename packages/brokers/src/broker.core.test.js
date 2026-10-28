import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { CoreBroker } from "./broker.core.js"

describe("CoreBroker", () => {
  it("initializes independent state containers", () => {
    const first = new CoreBroker()
    const second = new CoreBroker()

    assert.ok(first.openOrders instanceof Map)
    assert.ok(first.prices instanceof Map)
    assert.ok(first.priceSubscriptions instanceof Map)
    assert.notEqual(first.openOrders, second.openOrders)
    assert.notEqual(first.prices, second.prices)
    assert.notEqual(first.priceSubscriptions, second.priceSubscriptions)
  })

  it("uses the supplied logger", () => {
    const logger = { info() {} }
    const broker = new CoreBroker({ logger })

    assert.equal(broker.logger, logger)
  })

  for (const methodName of [
    "getAssets",
    "createOrder",
    "cancelOrder",
    "getOpenOrders",
    "getPrice",
    "subscribeForPrices",
  ]) {
    it(`throws a clear implementation error for ${methodName}`, () => {
      const broker = new CoreBroker()

      assert.throws(() => broker[methodName](), /implemented/i)
    })
  }
})
