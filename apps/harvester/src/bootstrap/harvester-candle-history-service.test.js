import nodeTest from "node:test"
import assert from "node:assert/strict"
import { createHarvesterCandleHistoryService } from "./harvester-candle-history-service.js"

const test = (...args) => nodeTest(
  `[harvester-candle-history-service.test.js] ${args[0]}`,
  ...args.slice(1),
)

function createCandleHistoryServiceFixture() {
  const brokerCalls = []
  const snapshot = {
    ok: true,
    data: {
      candles: [],
    },
  }
  let configuredService
  const service = createHarvesterCandleHistoryService({
    createCandleHistoryService: (options) => {
      configuredService = options
      return {
        getSnapshot: () => snapshot,
      }
    },
    broker: {
      getCandles: () => {
        throw new Error("The default broker must not be used when a market broker resolver is supplied.")
      },
      subscribeForCandles: () => {},
    },
    getMarketDataBroker: ({ symbol }) => ({
      getCandles: (input) => {
        brokerCalls.push({
          symbol,
          input,
        })
        return {
          ok: true,
          data: [],
        }
      },
      subscribeForCandles: (input) => ({
        ok: true,
        data: input,
      }),
    }),
    getTradingEngine: () => null,
    marketDataProviderIdentities: {
      BTCUSDT: {
        provider: "binance",
        providerInstance: "primary",
      },
    },
    logger: {},
    now: () => 0,
  })
  return {
    brokerCalls,
    configuredService,
    service,
    snapshot,
  }
}

test("routes candle reads to the market-specific broker and attaches provider identity", () => {
  const fixture = createCandleHistoryServiceFixture()
  const candleInput = {
    symbol: "BTCUSDT",
    interval: "1m",
  }
  const routedResult = fixture.configuredService.broker.getCandles(candleInput)
  const identifiedSnapshot = fixture.service.getSnapshot({
    symbol: "BTCUSDT",
  })

  assert.deepEqual(
    routedResult,
    {
      ok: true,
      data: [],
    },
    "Candle reads must return the selected market broker's result.",
  )
  assert.deepEqual(
    fixture.brokerCalls,
    [
      {
        symbol: "BTCUSDT",
        input: candleInput,
      },
    ],
    "The market broker resolver must receive the requested symbol and original candle input.",
  )
  assert.equal(
    identifiedSnapshot.data.provider,
    "binance",
    "A successful snapshot must carry the configured provider identity.",
  )
  assert.equal(
    identifiedSnapshot.data.providerInstance,
    "primary",
    "A successful snapshot must carry the configured provider-instance identity.",
  )
  assert.notEqual(
    identifiedSnapshot.data,
    fixture.snapshot.data,
    "Provider identity must be attached to a new snapshot data object.",
  )
})
