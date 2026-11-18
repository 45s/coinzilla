import { StrategyId } from "../../domain/strategies/strategy-ids.js"
import { ReadonlyMap } from "./readonly-map.js"

const EXECUTABLE_STRATEGY_IDS = new Set([StrategyId.COIN_GRABBER])
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

function getStrategyPairs({ appConfig, allowMissing = false } = {}) {
  const pairs = appConfig?.strategies?.[StrategyId.COIN_GRABBER]?.pairs
  if (allowMissing && pairs === undefined) {
    return {}
  }
  if (!isRecord(pairs)) {
    throw new TypeError("Execution routing requires the configured CG_coinGrabber pair map")
  }
  return pairs
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

function addConfiguredRoute({ route,
  index,
  pairs,
  providerById,
  routeByStrategyMarket }) {
  assertRouteShape({ route,
  index })
  if (!EXECUTABLE_STRATEGY_IDS.has(route.strategyId)) {
    throw new TypeError(
      `Execution routing contains unsupported strategy ${route.strategyId}; only CG_coinGrabber is executable`,
    )
  }
  if (!Object.hasOwn(pairs, route.symbol)) {
    throw new TypeError(`Execution route references unconfigured symbol ${route.symbol}`)
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
  pairs,
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
      pairs,
      providerById,
      routeByStrategyMarket,
    })
  }
  return routeByStrategyMarket
}

function assertEnabledMarketsAreRouted({ pairs,
  routeByStrategyMarket }) {
  const missingMarkets = Object.entries(pairs)
    .filter(([symbol, pair]) => pair?.enabled === true &&
      !routeByStrategyMarket.has(createRouteKey({
        strategyId: StrategyId.COIN_GRABBER,
        symbol,
      })))
    .map(([symbol]) => `${StrategyId.COIN_GRABBER}/${symbol}`)
  if (missingMarkets.length > 0) {
    throw new TypeError(
      `Execution routing is missing enabled strategy-market routes: ${missingMarkets.join(", ")}`,
    )
  }
}

function groupSymbolsByProvider({ providers,
  routeByStrategyMarket }) {
  const symbolsByProvider = new Map(
    providers.map(({ providerInstanceId }) => [providerInstanceId, []]),
  )
  for (const [key, providerInstanceId] of routeByStrategyMarket) {
    const [, symbol] = JSON.parse(key)
    symbolsByProvider.get(providerInstanceId).push(symbol)
  }
  return new ReadonlyMap([...symbolsByProvider].map(([providerInstanceId, symbols]) => [
    providerInstanceId,
    Object.freeze(symbols),
  ]))
}

/**
 * Resolve each enabled executable strategy/market pair to one provider account.
 *
 * A legacy one-provider deployment keeps its existing provider assignment.
 * Multi-provider deployments must declare every execution route explicitly.
 * Recovery Seller is deliberately excluded until its separate integration gates pass.
 *
 * @param {{appConfig: object, providers: object[]}} input
 * @returns {ReadonlyMap<string, ReadonlyArray<string>>} Provider instance to execution symbols.
 */
export function resolveExecutionSymbolsByProvider({ appConfig,
  providers } = {}) {
  const providerById = assertProviderInstances(providers)
  const isLegacySingleProvider = appConfig.executionRouting === undefined && providers.length === 1
  const pairs = getStrategyPairs({
    appConfig,
    allowMissing: isLegacySingleProvider,
  })
  if (appConfig.executionRouting === undefined) {
    if (providers.length !== 1) {
      throw new TypeError(
        "Multi-provider Harvester configuration requires explicit executionRouting.routes",
      )
    }
    const [provider] = providers
    const symbols = Object.entries(pairs)
      .filter(([, pair]) => pair?.enabled === true &&
        (!pair.tradingEnvironment ||
          pair.tradingEnvironment === "both" ||
          pair.tradingEnvironment === provider.environment))
      .map(([symbol]) => symbol)
    return new ReadonlyMap([[provider.providerInstanceId, Object.freeze(symbols)]])
  }

  const routeByStrategyMarket = resolveConfiguredRoutes({
    configuredRouting: appConfig.executionRouting,
    pairs,
    providerById,
  })
  assertEnabledMarketsAreRouted({
    pairs,
    routeByStrategyMarket,
  })
  const symbolsByProvider = groupSymbolsByProvider({
    providers,
    routeByStrategyMarket,
  })
  for (const provider of providers) {
    if (symbolsByProvider.get(provider.providerInstanceId)?.length === 0) {
      throw new TypeError(`Provider instance ${provider.providerInstanceId} has no execution routes; data-only provider instances are not supported`)
    }
  }
  return symbolsByProvider
}
