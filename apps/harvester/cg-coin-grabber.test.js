import assert from "node:assert/strict"
import test from "node:test"
import { tradingPairs } from "./cg-coin-grabber.js"
import { TRADING_ENVIRONMENTS } from "./src/domain/trading-environment.js"

const livePairFeeRates = {
  ADAFDUSD: {
    makerPercent: 0,
    takerPercent: 0.075,
  },
  LINKFDUSD: {
    makerPercent: 0,
    takerPercent: 0.075,
  },
  WLDFDUSD: {
    makerPercent: 0,
    takerPercent: 0.075,
  },
  ZROFDUSD: {
    makerPercent: 0,
    takerPercent: 0.1,
  },
}

test("every configured TESTNET pair uses 0.1% maker and taker commission", () => {
  const testnetPairs = Object.entries(tradingPairs).filter(([, pair]) =>
    pair.tradingEnvironment === TRADING_ENVIRONMENTS.TESTNET)

  assert.ok(testnetPairs.length > 0, "The configuration must contain TESTNET pairs.")
  for (const [symbol, pair] of testnetPairs) {
    assert.equal(pair.makerPercent, 0.1, `${symbol} TESTNET maker commission must be 0.1%.`)
    assert.equal(pair.takerPercent, 0.1, `${symbol} TESTNET taker commission must be 0.1%.`)
  }
})

test("TESTNET fee alignment does not change configured LIVE pair rates", () => {
  const livePairs = Object.fromEntries(
    Object.entries(tradingPairs)
      .filter(([, pair]) => pair.tradingEnvironment === TRADING_ENVIRONMENTS.LIVE)
      .map(([symbol, pair]) => [symbol, {
        makerPercent: pair.makerPercent,
        takerPercent: pair.takerPercent,
      }]),
  )

  assert.deepEqual(livePairs, livePairFeeRates)
})
