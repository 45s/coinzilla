import assert from "node:assert/strict"
import test from "node:test"
import { appConfig } from "../../../config/index.js"
import { StrategyId } from "../../domain/strategies/strategy-ids.js"
import { resolveExecutionRoutesByProvider, resolveExecutionSymbolsByProvider } from "./resolve-execution-symbols-by-provider.js"

const providers = [
  {
    providerInstanceId: "binance-testnet-primary",
    providerType: "binance",
    environment: "testnet",
  },
  {
    providerInstanceId: "binance-live-secondary",
    providerType: "binance",
    environment: "live",
  },
]

const pairs = {
  BTCUSDT: { enabled: true,
  tradingEnvironment: "testnet" },
  ETHUSDT: { enabled: true,
  tradingEnvironment: "live" },
  SOLUSDT: { enabled: false,
  tradingEnvironment: "both" },
}

function createAppConfig(overrides = {}) {
  return {
    strategies: {
      CG_coinGrabber: {
        pairs,
      },
    },
    ...overrides,
  }
}

function createRoutes() {
  return [
    {
      strategyId: StrategyId.COIN_GRABBER,
      symbol: "BTCUSDT",
      providerInstanceId: "binance-testnet-primary",
    },
    {
      strategyId: StrategyId.COIN_GRABBER,
      symbol: "ETHUSDT",
      providerInstanceId: "binance-live-secondary",
    },
  ]
}

test("preserves the legacy single-provider route for markets eligible in its environment", () => {
  const result = resolveExecutionSymbolsByProvider({
    appConfig: createAppConfig(),
    providers: [providers[0]],
  })

  assert.deepEqual([...result], [
    ["binance-testnet-primary", ["BTCUSDT"]],
  ], "Legacy single-provider startup must keep routing eligible enabled markets to its existing Binance instance")
})

test("resolves every enabled strategy-market route to exactly one configured provider instance", () => {
  const result = resolveExecutionSymbolsByProvider({
    appConfig: createAppConfig({
      executionRouting: { routes: createRoutes() },
    }),
    providers,
  })

  assert.deepEqual([...result], [
    ["binance-testnet-primary", ["BTCUSDT"]],
    ["binance-live-secondary", ["ETHUSDT"]],
  ], "Each execution account must receive only the markets explicitly assigned to it")
})

test("routes enabled RS markets through explicit provider assignments and deduplicates shared market subscriptions", () => {
  const recoverySellerPairs = {
    BTCUSDT: {
      enabled: true,
      tradingEnvironment: "testnet",
    },
    DOGEUSDT: {
      enabled: true,
      tradingEnvironment: "testnet",
    },
  }
  const routes = [
    ...createRoutes(),
    {
      strategyId: StrategyId.RECOVERY_SELLER,
      symbol: "BTCUSDT",
      providerInstanceId: "binance-testnet-primary",
    },
    {
      strategyId: StrategyId.RECOVERY_SELLER,
      symbol: "DOGEUSDT",
      providerInstanceId: "binance-testnet-primary",
    },
  ]
  const result = resolveExecutionSymbolsByProvider({
    appConfig: createAppConfig({
      strategies: {
        CG_coinGrabber: {
          pairs,
        },
        RS_recoverySeller: {
          enabled: true,
          pairs: recoverySellerPairs,
        },
      },
      executionRouting: {
        routes,
      },
    }),
    providers,
  })

  assert.deepEqual([...result], [
    ["binance-testnet-primary", ["BTCUSDT", "DOGEUSDT"]],
    ["binance-live-secondary", ["ETHUSDT"]],
  ], "A provider subscribes to each market once even when CG and RS both have explicit routes for that market")
})

test("rejects an RS route unless RS is explicitly enabled and the market is enabled", () => {
  const route = {
    strategyId: StrategyId.RECOVERY_SELLER,
    symbol: "BTCUSDT",
    providerInstanceId: "binance-testnet-primary",
  }
  assert.throws(
    () => resolveExecutionSymbolsByProvider({
      appConfig: createAppConfig({
        executionRouting: { routes: [...createRoutes(), route] },
      }),
      providers,
    }),
    /disabled|not enabled|unsupported strategy/i,
    "An RS route must never implicitly enable RS or adopt the CG pair configuration",
  )
})

test("infers the enabled RS-only route in legacy single-provider TESTNET mode", () => {
  const result = resolveExecutionRoutesByProvider({
    appConfig: {
      strategies: {
        RS_recoverySeller: {
          enabled: true,
          pairs: {
            LINEAUSDT: {
              enabled: true,
              tradingEnvironment: "testnet",
            },
          },
        },
      },
    },
    providers: [providers[0]],
  })
  assert.deepEqual([...result], [[
    "binance-testnet-primary",
    [{
      strategyId: StrategyId.RECOVERY_SELLER,
      symbol: "LINEAUSDT",
    }],
  ]], "RS-only legacy mode must infer the single configured TESTNET provider without requiring explicit routing")
})

test("rejects multi-provider configuration without an explicit execution route table", () => {
  assert.throws(
    () => resolveExecutionSymbolsByProvider({
      appConfig: createAppConfig(),
      providers,
    }),
    /explicit executionRouting\.routes/,
    "Multi-provider execution must never infer a default provider or fall back to the first account",
  )
})

test("rejects an enabled strategy-market pair without an execution route", () => {
  assert.throws(
    () => resolveExecutionSymbolsByProvider({
      appConfig: createAppConfig({
        executionRouting: {
          routes: [createRoutes()[0]],
        },
      }),
      providers,
    }),
    /missing enabled strategy-market routes.*ETHUSDT/i,
    "Every enabled market must be routed before any provider can connect or submit an order",
  )
})

test("rejects duplicate strategy-market routes", () => {
  const routes = createRoutes()
  routes.push({ ...routes[0],
  providerInstanceId: "binance-live-secondary" })

  assert.throws(
    () => resolveExecutionSymbolsByProvider({
      appConfig: createAppConfig({ executionRouting: { routes } }),
      providers,
    }),
    /duplicate route.*CG_coinGrabber.*BTCUSDT/i,
    "A strategy-market key cannot be assigned to two execution accounts",
  )
})

test("rejects unknown provider instances and environment-incompatible routes", () => {
  assert.throws(
    () => resolveExecutionSymbolsByProvider({
      appConfig: createAppConfig({
        executionRouting: {
          routes: [
            { ...createRoutes()[0],
  providerInstanceId: "missing-account" },
            createRoutes()[1],
          ],
        },
      }),
      providers,
    }),
    /unknown provider instance missing-account/i,
    "An execution route must resolve to a configured provider account",
  )

  assert.throws(
    () => resolveExecutionSymbolsByProvider({
      appConfig: createAppConfig({
        executionRouting: {
          routes: [
            { ...createRoutes()[0],
  providerInstanceId: "binance-live-secondary" },
            createRoutes()[1],
          ],
        },
      }),
      providers,
    }),
    /configured for testnet/i,
    "A TESTNET market must not execute through a LIVE provider instance",
  )
})

test("rejects routes for disabled or unconfigured markets and unknown strategy IDs", () => {
  const invalidRoutes = [
    { ...createRoutes()[0],
  symbol: "UNKNOWNUSDT" },
    { ...createRoutes()[0],
  symbol: "SOLUSDT" },
    { ...createRoutes()[0],
  strategyId: "UNSUPPORTED_STRATEGY",
  symbol: "BTCUSDT" },
  ]

  for (const route of invalidRoutes) {
    assert.throws(
      () => resolveExecutionSymbolsByProvider({
        appConfig: createAppConfig({
          executionRouting: { routes: [route, createRoutes()[1]] },
        }),
        providers,
      }),
      /unconfigured symbol|disabled market|unsupported strategy/i,
      "Execution routing must not enable an unconfigured market or deferred Recovery Seller strategy",
    )
  }
})

test("rejects malformed route tables and duplicate provider identities", () => {
  assert.throws(
    () => resolveExecutionSymbolsByProvider({
      appConfig: createAppConfig({
        executionRouting: {
          routes: [
            { ...createRoutes()[0],
  fallbackProviderInstanceId: "binance-live-secondary" },
            createRoutes()[1],
          ],
        },
      }),
      providers,
    }),
    /must contain only strategyId, symbol, and providerInstanceId/i,
    "Execution route records must not introduce implicit fallback fields",
  )

  assert.throws(
    () => resolveExecutionSymbolsByProvider({
      appConfig: createAppConfig({
        executionRouting: { routes: createRoutes() },
      }),
      providers: [providers[0], { ...providers[0] }],
    }),
    /unique configured provider instance IDs/i,
    "Provider identity must be unambiguous before route resolution",
  )
})


test("returns a mutation-protected execution route map", () => {
  const result = resolveExecutionSymbolsByProvider({
    appConfig: createAppConfig({
      executionRouting: { routes: createRoutes() },
    }),
    providers,
  })
  assert.throws(() => result.set("binance-testnet-primary", ["ETHUSDT"]), /ReadonlyMap/)
  assert.throws(() => result.delete("binance-testnet-primary"), /ReadonlyMap/)
})

test("rejects configured provider instances with no execution markets", () => {
  assert.throws(
    () => resolveExecutionSymbolsByProvider({
      appConfig: createAppConfig({
        executionRouting: { routes: createRoutes() },
      }),
      providers: [...providers, {
        providerInstanceId: "binance-unused",
        providerType: "binance",
        environment: "testnet",
      }],
    }),
    /no execution routes; data-only provider instances are not supported/,
  )
})


function createExpectedSameMarketCgAndRsRoutes() {
  return [
    ["binance-testnet-primary", [
      {
        strategyId: StrategyId.COIN_GRABBER,
        symbol: "BTCUSDT",
      },
      {
        strategyId: StrategyId.RECOVERY_SELLER,
        symbol: "BTCUSDT",
      },
      {
        strategyId: StrategyId.RECOVERY_SELLER,
        symbol: "DOGEUSDT",
      },
    ]],
    ["binance-live-secondary", [
      {
        strategyId: StrategyId.COIN_GRABBER,
        symbol: "ETHUSDT",
      },
    ]],
  ]
}

function createSameMarketCgAndRsRouteFixture() {
  const recoverySellerPairs = {
    BTCUSDT: {
      enabled: true,
      tradingEnvironment: "testnet",
    },
    DOGEUSDT: {
      enabled: true,
      tradingEnvironment: "testnet",
    },
  }
  const routes = [
    ...createRoutes(),
    {
      strategyId: StrategyId.RECOVERY_SELLER,
      symbol: "BTCUSDT",
      providerInstanceId: "binance-testnet-primary",
    },
    {
      strategyId: StrategyId.RECOVERY_SELLER,
      symbol: "DOGEUSDT",
      providerInstanceId: "binance-testnet-primary",
    },
  ]
  return {
    appConfig: createAppConfig({
      strategies: {
        CG_coinGrabber: {
          pairs,
        },
        RS_recoverySeller: {
          enabled: true,
          pairs: recoverySellerPairs,
        },
      },
      executionRouting: {
        routes,
      },
    }),
    expectedRoutes: createExpectedSameMarketCgAndRsRoutes(),
  }
}

test("preserves strategy identity for same-market CG and RS routes on one provider", () => {
  const fixture = createSameMarketCgAndRsRouteFixture()
  const result = resolveExecutionRoutesByProvider({
    appConfig: fixture.appConfig,
    providers,
  })

  assert.deepEqual(
    [...result],
    fixture.expectedRoutes,
    "The account runtime must retain strategy identity even when its market-data/execution symbol list is deduplicated",
  )
})


test("routes default LINEAUSDT Recovery Seller only to the TESTNET provider", () => {
  const configuredApp = structuredClone(appConfig)
  configuredApp.strategies.CG_coinGrabber.pairs = {
    ETHUSDT: {
      enabled: true,
      tradingEnvironment: "live",
    },
  }

  const testnetRoutes = resolveExecutionRoutesByProvider({
    appConfig: configuredApp,
    providers: [providers[0]],
  })
  assert.deepEqual(
    [...testnetRoutes.get("binance-testnet-primary")].filter(({ strategyId }) =>
      strategyId === StrategyId.RECOVERY_SELLER),
    [
      {
        strategyId: StrategyId.RECOVERY_SELLER,
        symbol: "LINEAUSDT",
      },
      {
        strategyId: StrategyId.RECOVERY_SELLER,
        symbol: "ARBUSDT",
      },
    ],
    "TESTNET must select all enabled TESTNET RS markets from the default app configuration.",
  )

  const liveRoutes = resolveExecutionRoutesByProvider({
    appConfig: configuredApp,
    providers: [providers[1]],
  })
  assert.deepEqual(
    [...liveRoutes.get("binance-live-secondary")].filter(({ strategyId }) =>
      strategyId === StrategyId.RECOVERY_SELLER),
    [],
    "LIVE must never select the TESTNET-only LINEAUSDT RS market.",
  )
})
