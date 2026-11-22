import test from "node:test"
import assert from "node:assert/strict"
import { createMarketComponentLogger } from "./create-market-component-logger.js"

test("market component diagnostics remain strategy-neutral", () => {
  const records = []
  const logger = createMarketComponentLogger({
    logger: {
      system: (data) => records.push({
        level: "system",
        ...data,
      }),
      warn: (data) => records.push({
        level: "warn",
        ...data,
      }),
    },
    component: "market-volatility-protection",
  })

  logger.system({
    message: "volatility state changed",
    symbol: "LINEAUSDT",
  })
  logger.warn({
    message: "volatility cancellation unresolved",
    symbol: "LINEAUSDT",
  })

  assert.equal(records.length, 2)
  assert.equal(records[0].component, "market-volatility-protection")
  assert.equal(records[1].component, "market-volatility-protection")
  assert.equal(records[0].strategyId, undefined)
  assert.equal(records[1].strategyId, undefined)
})
