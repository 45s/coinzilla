import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { CoreBroker } from "./broker.core.js"

describe("CoreBroker unsupported methods", () => {
  it("reports unimplemented price lookup and bulk cancellation", () => {
    const broker = new CoreBroker()
    assert.throws(() => broker.getPrices(), /implemented/i)
    assert.throws(() => broker.cancelAllOpenOrders(), /implemented/i)
  })
})
