import assert from "node:assert/strict"
import test from "node:test"
import { resolveMarketDataSymbolsByProvider } from "./resolve-market-data-symbols-by-provider.js"

const appConfig = {
  strategies: {
    CG_coinGrabber: {
      pairs: {
        BTCUSDT: {
          enabled: true,
          tradingEnvironment: "both",
        },
        ETHUSDT: {
          enabled: true,
          tradingEnvironment: "both",
        },
        XRPUSDT: {
          enabled: false,
          tradingEnvironment: "both",
        },
      },
    },
  },
}
const providers = [
  {
    providerInstanceId: "binance-one",
    environment: "testnet",
  },
  {
    providerInstanceId: "binance-two",
    environment: "live",
  },
]

test("keeps the legacy single-provider market-data ownership", () => {
  const resolved = resolveMarketDataSymbolsByProvider({
    appConfig,
    providers: [providers[0]],
  })
  assert.deepEqual([...resolved], [["binance-one", ["BTCUSDT", "ETHUSDT"]]],
    "a legacy single-provider runtime must continue receiving its configured market set")
})

test("assigns each market only to its explicitly configured source provider", () => {
  const resolved = resolveMarketDataSymbolsByProvider({
    appConfig: {
      ...appConfig,
      marketDataRouting: {
        routes: [
          {
            symbol: "BTCUSDT",
            providerInstanceId: "binance-two",
          },
          {
            symbol: "ETHUSDT",
            providerInstanceId: "binance-one",
          },
        ],
      },
    },
    providers,
  })
  assert.deepEqual([...resolved], [
    ["binance-one", ["ETHUSDT"]],
    ["binance-two", ["BTCUSDT"]],
  ], "each market must be assigned to exactly its configured provider instance")
})

test("requires explicit market-data routes for multi-provider deployments", () => {
  assert.throws(
    () => resolveMarketDataSymbolsByProvider({
      appConfig,
      providers,
    }),
    /requires explicit marketDataRouting.routes/,
    "multi-provider startup must not infer market-data ownership",
  )
})

test("rejects a missing route for an enabled market", () => {
  assert.throws(
    () => resolveMarketDataSymbolsByProvider({
      appConfig: {
        ...appConfig,
        marketDataRouting: {
          routes: [{
            symbol: "BTCUSDT",
            providerInstanceId: "binance-one",
          }],
        },
      },
      providers,
    }),
    /missing enabled market routes: ETHUSDT/,
    "every enabled market must have one explicit market-data source",
  )
})

test("rejects duplicate market-data routes", () => {
  assert.throws(
    () => resolveMarketDataSymbolsByProvider({
      appConfig: {
        ...appConfig,
        marketDataRouting: {
          routes: [
            {
              symbol: "BTCUSDT",
              providerInstanceId: "binance-one",
            },
            {
              symbol: "BTCUSDT",
              providerInstanceId: "binance-two",
            },
            {
              symbol: "ETHUSDT",
              providerInstanceId: "binance-one",
            },
          ],
        },
      },
      providers,
    }),
    /duplicate route for BTCUSDT/,
    "a market must not have multiple configured data sources",
  )
})

test("rejects routes to unknown providers and unconfigured markets", () => {
  assert.throws(
    () => resolveMarketDataSymbolsByProvider({
      appConfig: {
        ...appConfig,
        marketDataRouting: {
          routes: [
            {
            symbol: "BTCUSDT",
            providerInstanceId: "missing",
          },
            {
            symbol: "ETHUSDT",
            providerInstanceId: "binance-one",
          },
          ],
        },
      },
      providers,
    }),
    /unknown provider instance missing/,
    "a route must reference a provider instance constructed for this process",
  )
  assert.throws(
    () => resolveMarketDataSymbolsByProvider({
      appConfig: {
        ...appConfig,
        marketDataRouting: {
          routes: [
            {
            symbol: "BTCUSDT",
            providerInstanceId: "binance-one",
          },
            {
            symbol: "ETHUSDT",
            providerInstanceId: "binance-two",
          },
            {
            symbol: "DOGEUSDT",
            providerInstanceId: "binance-one",
          },
          ],
        },
      },
      providers,
    }),
    /unconfigured symbol DOGEUSDT/,
    "a route must not introduce a market outside the strategy configuration",
  )
})

test("rejects a market-data provider with an incompatible trading environment", () => {
  assert.throws(
    () => resolveMarketDataSymbolsByProvider({
      appConfig: {
        ...appConfig,
        strategies: {
          CG_coinGrabber: {
            pairs: {
              ...appConfig.strategies.CG_coinGrabber.pairs,
              BTCUSDT: {
                enabled: true,
                tradingEnvironment: "testnet",
              },
            },
          },
        },
        marketDataRouting: {
          routes: [
            {
              symbol: "BTCUSDT",
              providerInstanceId: "binance-two",
            },
            {
              symbol: "ETHUSDT",
              providerInstanceId: "binance-one",
            },
          ],
        },
      },
      providers,
    }),
    /uses live, but the market is configured for testnet/,
    "market-data source environment must be compatible with the configured market",
  )
})

test("keeps legacy single-provider bootstrap compatible with minimal test configurations", () => {
  const resolved = resolveMarketDataSymbolsByProvider({
    appConfig: {},
    providers: [providers[0]],
  })
  assert.deepEqual([...resolved], [["binance-one", []]])
})


test("rejects disabled market routes and protects resolved source maps from mutation", () => {
  assert.throws(
    () => resolveMarketDataSymbolsByProvider({
      appConfig: {
        ...appConfig,
        marketDataRouting: {
          routes: [
            { symbol: "BTCUSDT",
  providerInstanceId: "binance-one" },
            { symbol: "ETHUSDT",
  providerInstanceId: "binance-two" },
            { symbol: "XRPUSDT",
  providerInstanceId: "binance-one" },
          ],
        },
      },
      providers,
    }),
    /disabled market XRPUSDT/,
  )
  const resolved = resolveMarketDataSymbolsByProvider({
    appConfig: {
      ...appConfig,
      marketDataRouting: {
        routes: [
          { symbol: "BTCUSDT",
  providerInstanceId: "binance-one" },
          { symbol: "ETHUSDT",
  providerInstanceId: "binance-two" },
        ],
      },
    },
    providers,
  })
  assert.throws(() => resolved.set("binance-one", ["ETHUSDT"]), /ReadonlyMap/)
})
