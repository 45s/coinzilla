import assert from "node:assert/strict"
import test from "node:test"

import { Broker } from "../../../index.js"

function createBroker() {
  return new Broker({
    provider: "bitunix-futures",
    apiKey: "test-api-key",
    apiSecret: "test-secret-key",
    tradingMode: "live",
  })
}

test("Bitunix Futures account setting mutations are exposed behind the account safety gate", async () => {
  const broker = createBroker()

  const leverage = await broker.setFuturesLeverage({
    symbol: "BTCUSDT",
    leverage: 10,
  })
  const marginMode = await broker.setFuturesMarginMode({
    symbol: "BTCUSDT",
    marginMode: "ISOLATION",
  })
  const positionMode = await broker.setFuturesPositionMode({
    positionMode: "HEDGE",
  })

  for (const result of [leverage, marginMode, positionMode]) {
    assert.equal(result.ok, false)
    assert.equal(result.mutationOutcome, "NOT_SENT")
    assert.equal(result.configurationOutcome, "NOT_SENT")
  }
})

test("Bitunix Futures isolated margin adjustment is explicitly unsupported without a documented API operation", async () => {
  const broker = createBroker()

  const result = await broker.adjustFuturesPositionMargin({
    positionId: "position-1",
    amount: "10",
  })

  assert.equal(result.ok, false)
  assert.equal(result.mutationOutcome, "NOT_SENT")
  assert.match(result.errors[0].message, /no documented Futures API endpoint/i)
})
