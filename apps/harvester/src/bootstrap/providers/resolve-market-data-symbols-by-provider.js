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

/**
 * Resolve the single configured market-data source for every strategy market.
 * Legacy one-provider deployments retain their existing behavior. Multi-provider
 * deployments must declare an explicit route for every enabled market.
 *
 * @param {{appConfig: object, providers: object[]}} input
 * @returns {ReadonlyMap<string, ReadonlyArray<string>>} Provider instance to symbols.
 */
export function resolveMarketDataSymbolsByProvider({ appConfig, providers } = {}) {
  const providerIds = assertProviderInstances(providers)
  const pairs = appConfig?.strategies?.CG_coinGrabber?.pairs
  if (!isRecord(pairs) && providers.length === 1 && appConfig?.marketDataRouting === undefined) {
    return new ReadonlyMap([[providers[0].providerInstanceId, Object.freeze([])]])
  }
  if (!isRecord(pairs)) {
    throw new TypeError("Market-data routing requires the configured CG_coinGrabber pair map")
  }
  if (appConfig.marketDataRouting === undefined) {
    if (providers.length !== 1) {
      throw new TypeError("Multi-provider Harvester configuration requires explicit marketDataRouting.routes")
    }
    const enabledSymbols = Object.entries(pairs)
      .filter(([, pair]) => pair?.enabled === true)
      .map(([symbol]) => symbol)
    return new ReadonlyMap([[providers[0].providerInstanceId, Object.freeze(enabledSymbols)]])
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
