import { StrategyId } from "../../domain/strategies/strategy-ids.js"
import { ReadonlyMap } from "./readonly-map.js"

const EXECUTABLE_STRATEGY_IDS = new Set([StrategyId.COIN_GRABBER, StrategyId.RECOVERY_SELLER])
const TRADING_ENVIRONMENTS = new Set(["testnet", "live"])

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function assertProviderInstances(providers) {
  if (!Array.isArray(providers) || providers.length === 0) {
    throw new TypeError("Execution routing requires at least one configured provider instance")
  }
  const providerById = new Map()
  for (const provider of providers) {
    const id = provider?.providerInstanceId
    if (
      typeof id !== "string" ||
      !id.trim() ||
      providerById.has(id) ||
      !TRADING_ENVIRONMENTS.has(provider.environment)
    ) {
      throw new TypeError("Execution routing requires unique configured provider instance IDs and explicit environments")
    }
    providerById.set(id, provider)
  }
  return providerById
}

function getStrategyPairs({
  appConfig,
  strategyId = StrategyId.COIN_GRABBER,
  allowMissing = false,
} = {}) {
  const pairs = appConfig?.strategies?.[strategyId]?.pairs
  if (allowMissing && pairs === undefined) {
    return {}
  }
  if (!isRecord(pairs)) {
    throw new TypeError(`Execution routing requires the configured ${strategyId} pair map`)
  }
  return pairs
}

function isStrategyEnabled({
      appConfig,
      strategyId,
    }) {
  const strategy = appConfig?.strategies?.[strategyId]
  if (!isRecord(strategy)) {
    return false
  }
  if (strategyId === StrategyId.RECOVERY_SELLER) {
    return strategy.enabled === true
  }
  return strategy.enabled !== false
}

function getEnabledStrategyPairs({ appConfig, allowMissingLegacyCg = false } = {}) {
  const pairsByStrategy = new Map()
  for (const strategyId of EXECUTABLE_STRATEGY_IDS) {
    if (!isStrategyEnabled({
      appConfig,
      strategyId,
    })) {
      continue
    }
    pairsByStrategy.set(strategyId, getStrategyPairs({
      appConfig,
      strategyId,
      allowMissing: allowMissingLegacyCg && strategyId === StrategyId.COIN_GRABBER,
    }))
  }
  return pairsByStrategy
}

function assertRouteShape({ route,
  index }) {
  const allowedKeys = new Set(["strategyId", "symbol", "providerInstanceId"])
  if (
    !isRecord(route) ||
    Object.keys(route).some((key) => !allowedKeys.has(key)) ||
    typeof route.strategyId !== "string" ||
    !route.strategyId.trim() ||
    typeof route.symbol !== "string" ||
    !route.symbol.trim() ||
    typeof route.providerInstanceId !== "string" ||
    !route.providerInstanceId.trim()
  ) {
    throw new TypeError(
      `executionRouting.routes[${index}] must contain only strategyId, symbol, and providerInstanceId`,
    )
  }
}

function createRouteKey({ strategyId,
  symbol }) {
  return JSON.stringify([strategyId, symbol])
}

function addConfiguredRoute({
  route,
  index,
  pairsByStrategy,
  appConfig,
  providerById,
  routeByStrategyMarket,
}) {
  assertRouteShape({ route,
  index })
  if (!EXECUTABLE_STRATEGY_IDS.has(route.strategyId)) {
    throw new TypeError(
      `Execution routing contains unsupported strategy ${route.strategyId}`,
    )
  }
  if (!isStrategyEnabled({
    appConfig,
    strategyId: route.strategyId,
  })) {
    throw new TypeError(`Execution route references disabled strategy ${route.strategyId}`)
  }
  const pairs = pairsByStrategy.get(route.strategyId)
  if (!pairs || !Object.hasOwn(pairs, route.symbol)) {
    throw new TypeError(`Execution route references unconfigured symbol ${route.symbol} for ${route.strategyId}`)
  }
  if (pairs[route.symbol]?.enabled !== true) {
    throw new TypeError(`Execution route references disabled market ${route.symbol}`)
  }
  const key = createRouteKey(route)
  if (routeByStrategyMarket.has(key)) {
    throw new TypeError(
      `Execution routing contains a duplicate route for ${route.strategyId}/${route.symbol}`,
    )
  }
  const provider = providerById.get(route.providerInstanceId)
  if (!provider) {
    throw new TypeError(
      `Execution route for ${route.strategyId}/${route.symbol} references unknown provider instance ${route.providerInstanceId}`,
    )
  }
  const pairEnvironment = pairs[route.symbol].tradingEnvironment
  if (
    pairEnvironment &&
    pairEnvironment !== "both" &&
    pairEnvironment !== provider.environment
  ) {
    throw new TypeError(
      `Execution route for ${route.symbol} uses ${provider.environment}, but the market is configured for ${pairEnvironment}`,
    )
  }
  routeByStrategyMarket.set(key, route.providerInstanceId)
}

function resolveConfiguredRoutes({ configuredRouting,
  pairsByStrategy,
  appConfig,
  providerById }) {
  if (
    !isRecord(configuredRouting) ||
    Object.keys(configuredRouting).some((key) => key !== "routes") ||
    !Array.isArray(configuredRouting.routes)
  ) {
    throw new TypeError("executionRouting must contain only a routes array")
  }
  const routeByStrategyMarket = new Map()
  for (const [index, route] of configuredRouting.routes.entries()) {
    addConfiguredRoute({
      route,
      index,
      pairsByStrategy,
      appConfig,
      providerById,
      routeByStrategyMarket,
    })
  }
  return routeByStrategyMarket
}

function assertEnabledMarketsAreRouted({
  pairsByStrategy,
  routeByStrategyMarket,
}) {
  const missingMarkets = []
  for (const [strategyId, pairs] of pairsByStrategy) {
    for (const [symbol, pair] of Object.entries(pairs)) {
      if (pair?.enabled === true && !routeByStrategyMarket.has(createRouteKey({
        strategyId,
        symbol,
      }))) {
        missingMarkets.push(`${strategyId}/${symbol}`)
      }
    }
  }
  if (missingMarkets.length > 0) {
    throw new TypeError(
      `Execution routing is missing enabled strategy-market routes: ${missingMarkets.join(", ")}`,
    )
  }
}


function groupRoutesByProvider({ providers, routeByStrategyMarket }) {
  const routesByProvider = new Map(
    providers.map(({ providerInstanceId }) => [providerInstanceId, []]),
  )
  for (const [key, providerInstanceId] of routeByStrategyMarket) {
    const [strategyId, symbol] = JSON.parse(key)
    routesByProvider.get(providerInstanceId).push(Object.freeze({
      strategyId,
      symbol,
    }))
  }
  return routesByProvider
}

function createLegacyRouteAssignments({ provider, pairs }) {
  const assignments = new Map()
  for (const [symbol, pair] of Object.entries(pairs)) {
    if (pair?.enabled !== true) {
      continue
    }
    if (pair.tradingEnvironment &&
        pair.tradingEnvironment !== "both" &&
        pair.tradingEnvironment !== provider.environment) {
      continue
    }
    assignments.set(createRouteKey({
      strategyId: StrategyId.COIN_GRABBER,
      symbol,
    }), provider.providerInstanceId)
  }
  return assignments
}

function resolveRouteAssignments({ appConfig, providers, pairsByStrategy, providerById }) {
  if (appConfig.executionRouting !== undefined) {
    const routeByStrategyMarket = resolveConfiguredRoutes({
      configuredRouting: appConfig.executionRouting,
      pairsByStrategy,
      appConfig,
      providerById,
    })
    assertEnabledMarketsAreRouted({
      pairsByStrategy,
      routeByStrategyMarket,
    })
    return routeByStrategyMarket
  }
  if (providers.length !== 1) {
    throw new TypeError(
      "Multi-provider Harvester configuration requires explicit executionRouting.routes",
    )
  }
  if (pairsByStrategy.has(StrategyId.RECOVERY_SELLER)) {
    throw new TypeError("Recovery Seller requires explicit executionRouting.routes")
  }
  const [provider] = providers
  return createLegacyRouteAssignments({
    provider,
    pairs: pairsByStrategy.get(StrategyId.COIN_GRABBER) ?? {},
  })
}

function assertEveryProviderHasExecutionRoutes({ providers, routesByProvider }) {
  for (const provider of providers) {
    if (routesByProvider.get(provider.providerInstanceId)?.length === 0) {
      throw new TypeError(
        `Provider instance ${provider.providerInstanceId} has no execution routes; data-only provider instances are not supported`,
      )
    }
  }
}

/**
 * Resolve each enabled executable strategy/market pair to one provider account.
 *
 * Route records retain strategy identity even when multiple strategies share
 * one symbol on the same provider. Market-data subscriptions are deduplicated
 * separately by resolveExecutionSymbolsByProvider().
 *
 * @param {{appConfig: object, providers: object[]}} input
 * @returns {ReadonlyMap<string, ReadonlyArray<{strategyId: string, symbol: string}>>}
 */
export function resolveExecutionRoutesByProvider({ appConfig, providers } = {}) {
  const providerById = assertProviderInstances(providers)
  const isLegacySingleProvider = appConfig.executionRouting === undefined && providers.length === 1
  const pairsByStrategy = getEnabledStrategyPairs({
    appConfig,
    allowMissingLegacyCg: isLegacySingleProvider,
  })
  const routeByStrategyMarket = resolveRouteAssignments({
    appConfig,
    providers,
    pairsByStrategy,
    providerById,
  })
  const routesByProvider = groupRoutesByProvider({
    providers,
    routeByStrategyMarket,
  })
  assertEveryProviderHasExecutionRoutes({
    providers,
    routesByProvider,
  })
  return new ReadonlyMap([...routesByProvider].map(([providerInstanceId, routes]) => [
    providerInstanceId,
    Object.freeze(routes),
  ]))
}

/**
 * Resolve the deduplicated market symbols required by each provider.
 *
 * @param {{appConfig: object, providers: object[]}} input
 * @returns {ReadonlyMap<string, ReadonlyArray<string>>}
 */
export function resolveExecutionSymbolsByProvider({ appConfig, providers } = {}) {
  const routesByProvider = resolveExecutionRoutesByProvider({
    appConfig,
    providers,
  })
  return new ReadonlyMap([...routesByProvider].map(([providerInstanceId, routes]) => [
    providerInstanceId,
    Object.freeze([...new Set(routes.map(({ symbol }) => symbol))]),
  ]))
}

