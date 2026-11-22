import { ReadonlyMap } from "./readonly-map.js"

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function assertProviderInstances(providers) {
  if (!Array.isArray(providers) || providers.length === 0) {
    throw new TypeError("Market-data routing requires at least one configured provider instance")
  }
  const providerIds = new Map()
  for (const provider of providers) {
    const id = provider?.providerInstanceId
    if (typeof id !== "string" || !id.trim() || providerIds.has(id)) {
      throw new TypeError("Market-data routing requires unique configured provider instance IDs")
    }
    providerIds.set(id, provider)
  }
  return providerIds
}

function assertRouteShape({ route, index }) {
  if (!isRecord(route) ||
      Object.keys(route).some((key) => key !== "symbol" && key !== "providerInstanceId") ||
      typeof route.symbol !== "string" || !route.symbol.trim() ||
      typeof route.providerInstanceId !== "string" || !route.providerInstanceId.trim()) {
    throw new TypeError(`marketDataRouting.routes[${index}] must contain a symbol and providerInstanceId`)
  }
}

function addConfiguredRoute({ route, index, pairs, providerIds, routeBySymbol }) {
  assertRouteShape({
    route,
    index,
  })
  if (!Object.hasOwn(pairs, route.symbol)) {
    throw new TypeError(`Market-data route references unconfigured symbol ${route.symbol}`)
  }
  if (pairs[route.symbol]?.enabled !== true) {
    throw new TypeError(`Market-data route references disabled market ${route.symbol}`)
  }
  const provider = providerIds.get(route.providerInstanceId)
  if (!provider) {
    throw new TypeError(`Market-data route for ${route.symbol} references unknown provider instance ${route.providerInstanceId}`)
  }
  const pairTradingEnvironment = pairs[route.symbol].tradingEnvironment
  if (pairTradingEnvironment && pairTradingEnvironment !== "both" && pairTradingEnvironment !== provider.environment) {
    throw new TypeError(`Market-data route for ${route.symbol} uses ${provider.environment}, but the market is configured for ${pairTradingEnvironment}`)
  }
  if (routeBySymbol.has(route.symbol)) {
    throw new TypeError(`Market-data routing contains duplicate route for ${route.symbol}`)
  }
  routeBySymbol.set(route.symbol, route.providerInstanceId)
}

function resolveConfiguredRoutes({ configuredRouting, pairs, providerIds }) {
  if (!isRecord(configuredRouting) ||
      Object.keys(configuredRouting).some((key) => key !== "routes") ||
      !Array.isArray(configuredRouting.routes)) {
    throw new TypeError("marketDataRouting must contain only a routes array")
  }
  const routeBySymbol = new Map()
  for (const [index, route] of configuredRouting.routes.entries()) {
    addConfiguredRoute({
      route,
      index,
      pairs,
      providerIds,
      routeBySymbol,
    })
  }
  return routeBySymbol
}

function assertEnabledMarketsAreRouted({ pairs, routeBySymbol }) {
  const missingSymbols = Object.entries(pairs)
    .filter(([symbol, pair]) => pair?.enabled === true && !routeBySymbol.has(symbol))
    .map(([symbol]) => symbol)
  if (missingSymbols.length > 0) {
    throw new TypeError(`Market-data routing is missing enabled market routes: ${missingSymbols.join(", ")}`)
  }
}

function groupSymbolsByProvider({ providers, routeBySymbol }) {
  const symbolsByProvider = new Map(providers.map(({ providerInstanceId }) => [providerInstanceId, []]))
  for (const [symbol, providerInstanceId] of routeBySymbol) {
    symbolsByProvider.get(providerInstanceId).push(symbol)
  }
  return new ReadonlyMap([...symbolsByProvider].map(([providerInstanceId, symbols]) => [
    providerInstanceId,
    Object.freeze(symbols),
  ]))
}

function getEnabledStrategyPairs(appConfig) {
  const strategies = [
    ["CG_coinGrabber", appConfig?.strategies?.CG_coinGrabber, (strategy) => strategy.enabled !== false],
    ["RS_recoverySeller", appConfig?.strategies?.RS_recoverySeller, (strategy) => strategy.enabled === true],
  ]
  const pairsByStrategy = []
  for (const [strategyId, strategy, isEnabled] of strategies) {
    if (!isRecord(strategy) || !isEnabled(strategy)) {
      continue
    }
    if (!isRecord(strategy.pairs)) {
      throw new TypeError(`Market-data routing requires the configured ${strategyId} pair map`)
    }
    pairsByStrategy.push([strategyId, strategy.pairs])
  }
  return pairsByStrategy
}

function resolveSharedMarketEnvironment({ existing, incoming, symbol }) {
  const existingEnvironment = existing.tradingEnvironment
  const incomingEnvironment = incoming.tradingEnvironment
  if (existingEnvironment === incomingEnvironment) {
    return existingEnvironment
  }
  if (existingEnvironment === undefined) {
    return incomingEnvironment
  }
  if (incomingEnvironment === undefined) {
    return existingEnvironment
  }
  if (existingEnvironment === "both") {
    return incomingEnvironment
  }
  if (incomingEnvironment === "both") {
    return existingEnvironment
  }
  throw new TypeError(`Enabled strategies configure conflicting trading environments for market-data symbol ${symbol}`)
}

function mergeConfiguredMarketPair({ pairs, symbol, pair }) {
  const existing = pairs[symbol]
  if (!existing || (existing.enabled !== true && pair.enabled === true)) {
    pairs[symbol] = pair
    return
  }
  if (existing.enabled !== true || pair.enabled !== true) {
    return
  }
  pairs[symbol] = {
    ...existing,
    tradingEnvironment: resolveSharedMarketEnvironment({
      existing,
      incoming: pair,
      symbol,
    }),
  }
}

function createEnabledMarketMap(pairsByStrategy) {
  const pairs = {}
  for (const [, strategyPairs] of pairsByStrategy) {
    for (const [symbol, pair] of Object.entries(strategyPairs)) {
      mergeConfiguredMarketPair({
        pairs,
        symbol,
        pair,
      })
    }
  }
  return pairs
}

/**
 * Resolve the single configured market-data source for every enabled strategy market.
 * Legacy one-provider deployments infer the union of enabled strategy markets.
 * Multi-provider deployments must declare an explicit route for every enabled market.
 *
 * @param {{appConfig: object, providers: object[]}} input
 * @returns {ReadonlyMap<string, ReadonlyArray<string>>} Provider instance to symbols.
 */
export function resolveMarketDataSymbolsByProvider({ appConfig, providers } = {}) {
  const providerIds = assertProviderInstances(providers)
  const pairsByStrategy = getEnabledStrategyPairs(appConfig)
  const pairs = createEnabledMarketMap(pairsByStrategy)
  if (appConfig?.marketDataRouting === undefined) {
    if (providers.length !== 1) {
      throw new TypeError("Multi-provider Harvester configuration requires explicit marketDataRouting.routes")
    }
    const [provider] = providers
    const enabledSymbols = Object.entries(pairs)
      .filter(([, pair]) => {
        const environment = pair.tradingEnvironment
        return environment === undefined || environment === "both" || environment === provider.environment
      })
      .map(([symbol]) => symbol)
    return new ReadonlyMap([[provider.providerInstanceId, Object.freeze(enabledSymbols)]])
  }
  const routeBySymbol = resolveConfiguredRoutes({
    configuredRouting: appConfig.marketDataRouting,
    pairs,
    providerIds,
  })
  assertEnabledMarketsAreRouted({
    pairs,
    routeBySymbol,
  })
  return groupSymbolsByProvider({
    providers,
    routeBySymbol,
  })
}
