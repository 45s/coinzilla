import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { CoreBroker } from "./broker.core.js"

describe("CoreBroker unsupported methods", () => {
  it("reports an unimplemented price lookup", () => {
    const broker = new CoreBroker()
    assert.throws(() => broker.getPrice(), /implemented/i)
  })
})
