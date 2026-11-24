import assert from "node:assert/strict"
import test from "node:test"

import { Broker } from "../index.js"

const credentials = {
  apiKey: "bitunix-futures-factory-test-key",
  apiSecret: "bitunix-futures-factory-test-secret",
}

test("Broker constructs the distinct Bitunix USDT Futures provider with mutations disabled", () => {
  const broker = new Broker({
    provider: "bitunix-futures",
    ...credentials,
    tradingMode: "live",
  })

  assert.ok(broker instanceof Broker, "the Futures implementation must satisfy the exchange-neutral Broker contract")
  assert.equal(broker.capabilities.provider, "bitunix", "the Futures provider must identify the Bitunix exchange")
  assert.equal(broker.capabilities.product, "futures", "the provider must declare Futures rather than Spot product semantics")
  assert.equal(broker.config.tradingMode, "live", "the Futures adapter must retain the explicitly selected environment")
  assert.equal(broker.config.allowLiveOrderMutations, false, "LIVE order mutations must remain disabled unless explicitly authorized")
})
