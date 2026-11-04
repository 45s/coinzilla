import test from "node:test"
import assert from "node:assert/strict"
import { validateTradingConfig } from "./trading-config.js"

function makeValidConfig() {
  return {
    strategies: {
      CG_coinGrabber: {
        enabled: true,
        settings: {
          minProfit: 0.01,
          conservative: { enabled: true },
          aggressive: { enabled: false },
        },
        pairs: {
          DOGEUSDT: {
            enabled: true,
            investment: 100,
            orderQuantity: 100,
            keepQuantity: 1,
            priceStepPercent: 0.05,
            pricePrecision: 3,
            quantityPrecision: 1,
            makerPercent: 0.075,
            takerPercent: 0.1,
          },
        },
      },
    },
  }
}

test("accepts maker and taker percentages from zero up to but excluding 100", () => {
  const config = makeValidConfig()
  config.strategies.CG_coinGrabber.pairs.DOGEUSDT.makerPercent = 0
  config.strategies.CG_coinGrabber.pairs.DOGEUSDT.takerPercent = 99.999

  assert.equal(validateTradingConfig(config), config)
})

test("rejects maker and taker fee percentages at or above 100 during config validation", () => {
  const makerConfig = makeValidConfig()
  makerConfig.strategies.CG_coinGrabber.pairs.DOGEUSDT.makerPercent = 100
  assert.throws(
    () => validateTradingConfig(makerConfig),
    /strategies\.CG_coinGrabber\.pairs\.DOGEUSDT\.makerPercent/,
  )

  const takerConfig = makeValidConfig()
  takerConfig.strategies.CG_coinGrabber.pairs.DOGEUSDT.takerPercent = 100
  assert.throws(
    () => validateTradingConfig(takerConfig),
    /strategies\.CG_coinGrabber\.pairs\.DOGEUSDT\.takerPercent/,
  )
})
