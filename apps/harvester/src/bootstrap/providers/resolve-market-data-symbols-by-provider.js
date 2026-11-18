/**
 * Resolve the single configured market-data source for every strategy market.
 * Legacy one-provider deployments retain their existing behavior. Multi-provider
 * deployments must declare an explicit route for every enabled market.
 *
 * @param {{appConfig: object, providers: object[]}} input
 * @returns {ReadonlyMap<string, ReadonlyArray<string>>} Provider instance to symbols.
 */
export function resolveMarketDataSymbolsByProvider({ appConfig, providers } = {}) {
  if (!Array.isArray(providers) || providers.length === 0) {
    throw new TypeError("Market-data routing requires at least one configured provider instance")
  }
  const pairs = appConfig?.strategies?.CG_coinGrabber?.pairs
  if (pairs === null || typeof pairs !== "object" || Array.isArray(pairs)) {
    throw new TypeError("Market-data routing requires the configured CG_coinGrabber pair map")
  }
  const providerIds = new Set()
  for (const provider of providers) {
    const id = provider?.providerInstanceId
    if (typeof id !== "string" || !id.trim() || providerIds.has(id)) {
      throw new TypeError("Market-data routing requires unique configured provider instance IDs")
    }
    providerIds.add(id)
  }

  const configuredRouting = appConfig.marketDataRouting
  if (configuredRouting === undefined && providers.length === 1) {
    return new Map([[providers[0].providerInstanceId, Object.freeze(Object.keys(pairs))]])
  }
  if (configuredRouting === undefined) {
    throw new TypeError("Multi-provider Harvester configuration requires explicit marketDataRouting.routes")
  }
  if (configuredRouting === null || typeof configuredRouting !== "object" ||
      Array.isArray(configuredRouting) || Object.keys(configuredRouting).some((key) => key !== "routes") ||
      !Array.isArray(configuredRouting.routes)) {
    throw new TypeError("marketDataRouting must contain only a routes array")
  }

  const routeBySymbol = new Map()
  for (const [index, route] of configuredRouting.routes.entries()) {
    if (route === null || typeof route !== "object" || Array.isArray(route) ||
        Object.keys(route).some((key) => key !== "symbol" && key !== "providerInstanceId") ||
        typeof route.symbol !== "string" || !route.symbol.trim() ||
        typeof route.providerInstanceId !== "string" || !route.providerInstanceId.trim()) {
      throw new TypeError(`marketDataRouting.routes[${index}] must contain a symbol and providerInstanceId`)
    }
    if (!Object.hasOwn(pairs, route.symbol)) {
      throw new TypeError(`Market-data route references unconfigured symbol ${route.symbol}`)
    }
    if (!providerIds.has(route.providerInstanceId)) {
      throw new TypeError(`Market-data route for ${route.symbol} references unknown provider instance ${route.providerInstanceId}`)
    }
    if (routeBySymbol.has(route.symbol)) {
      throw new TypeError(`Market-data routing contains duplicate route for ${route.symbol}`)
    }
    routeBySymbol.set(route.symbol, route.providerInstanceId)
  }

  const enabledSymbols = Object.entries(pairs)
    .filter(([, pair]) => pair?.enabled === true)
    .map(([symbol]) => symbol)
  const missingSymbols = enabledSymbols.filter((symbol) => !routeBySymbol.has(symbol))
  if (missingSymbols.length > 0) {
    throw new TypeError(`Market-data routing is missing enabled market routes: ${missingSymbols.join(", ")}`)
  }

  const symbolsByProvider = new Map(providers.map(({ providerInstanceId }) => [providerInstanceId, []]))
  for (const [symbol, providerInstanceId] of routeBySymbol) {
    symbolsByProvider.get(providerInstanceId).push(symbol)
  }
  return new Map([...symbolsByProvider].map(([providerInstanceId, symbols]) => [
    providerInstanceId,
    Object.freeze(symbols),
  ]))
}
