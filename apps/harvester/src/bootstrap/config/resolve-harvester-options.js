import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { publishLifecycleEvent } from "../../application/events/publish-lifecycle-event.js"
import { mapConfigValidatedData } from "../../application/events/lifecycle-event-dtos.js"
import { resolveRuntimeConfig, selectPairsForTradingMode } from "../../domain/app-config.js"
import { StrategyId } from "../../domain/strategies/strategy-ids.js"
import { TRADING_ENVIRONMENTS } from "../../domain/trading-environment.js"
import {
  createEffectiveStrategyConfigurationFingerprint,
  EffectiveConfigurationError,
} from "../../domain/configuration/create-effective-strategy-configuration-fingerprint.js"
import { resolveTelegramOperatorConfig } from "../operator-control/resolve-telegram-operator-config.js"

function assertSupportedStrategyConfig(strategyConfig) {
  if (strategyConfig?.enabled !== true) {
    throw new Error("CG_coinGrabber strategy must remain enabled in app config")
  }
  if (strategyConfig.settings?.conservative?.enabled !== true) {
    throw new Error("Conservative strategy must remain enabled in CG_coinGrabber settings")
  }
  if (strategyConfig.settings?.aggressive?.enabled === true) {
    throw new Error(
      "Aggressive strategy is disabled and deferred; set strategies.CG_coinGrabber.settings.aggressive.enabled=false",
    )
  }
}

function validateExecutionRoute({ route } = {}) {
  if (!route || typeof route !== "object" ||
      typeof route.strategyId !== "string" ||
      typeof route.symbol !== "string" ||
      !route.symbol.trim()) {
    throw new TypeError("executionRoutes must contain strategyId and non-empty symbol values")
  }
  if (![StrategyId.COIN_GRABBER, StrategyId.RECOVERY_SELLER].includes(route.strategyId)) {
    throw new TypeError(`Unsupported execution strategy route: ${route.strategyId}`)
  }
  return route
}

function validateExecutionSymbolList({ executionSymbols, routeSymbols } = {}) {
  if (executionSymbols === undefined) {
    return
  }
  if (!Array.isArray(executionSymbols)) {
    throw new TypeError("executionSymbols must be an array when executionRoutes are supplied")
  }
  const supplied = new Set(executionSymbols)
  if (supplied.size !== executionSymbols.length ||
      executionSymbols.some((symbol) => typeof symbol !== "string" || !symbol.trim()) ||
      supplied.size !== routeSymbols.length ||
      routeSymbols.some((symbol) => !supplied.has(symbol))) {
    throw new TypeError("executionSymbols must match the deduplicated symbols in executionRoutes")
  }
}

function resolveExecutionRouteSymbols({ executionRoutes, executionSymbols } = {}) {
  if (executionRoutes === undefined) {
    return {
      conservativeExecutionSymbols: executionSymbols,
      recoverySellerExecutionSymbols: undefined,
      executionSymbols,
    }
  }
  if (!Array.isArray(executionRoutes)) {
    throw new TypeError("executionRoutes must be an array when supplied")
  }
  const symbolsByStrategy = new Map([
    [StrategyId.COIN_GRABBER, []],
    [StrategyId.RECOVERY_SELLER, []],
  ])
  const seenByStrategy = new Map([
    [StrategyId.COIN_GRABBER, new Set()],
    [StrategyId.RECOVERY_SELLER, new Set()],
  ])
  for (const input of executionRoutes) {
    const route = validateExecutionRoute({ route: input })
    const symbols = symbolsByStrategy.get(route.strategyId)
    const seen = seenByStrategy.get(route.strategyId)
    if (seen.has(route.symbol)) {
      const strategyName = route.strategyId === StrategyId.COIN_GRABBER ? "CG" : "RS"
      throw new TypeError(`Execution routes contain a duplicate ${strategyName} market: ${route.symbol}`)
    }
    seen.add(route.symbol)
    symbols.push(route.symbol)
  }
  const conservativeExecutionSymbols = symbolsByStrategy.get(StrategyId.COIN_GRABBER)
  const recoverySellerExecutionSymbols = symbolsByStrategy.get(StrategyId.RECOVERY_SELLER)
  if (conservativeExecutionSymbols.length === 0) {
    throw new Error(
      "This provider account has no Conservative execution route; RS-only runtime dispatch is not integrated yet",
    )
  }
  const routeSymbols = [...new Set([
    ...conservativeExecutionSymbols,
    ...recoverySellerExecutionSymbols,
  ])]
  validateExecutionSymbolList({
    executionSymbols,
    routeSymbols,
  })
  return {
    conservativeExecutionSymbols,
    recoverySellerExecutionSymbols,
    executionSymbols: routeSymbols,
  }
}

function resolveRecoverySellerPairs({ strategyConfig, tradingMode, executionSymbols } = {}) {
  if (executionSymbols === undefined || executionSymbols.length === 0) {
    return {}
  }
  if (strategyConfig?.enabled !== true) {
    throw new Error("RS_recoverySeller strategy must be explicitly enabled before it can receive execution routes")
  }
  if (!strategyConfig.pairs || typeof strategyConfig.pairs !== "object" || Array.isArray(strategyConfig.pairs)) {
    throw new TypeError("RS_recoverySeller.pairs must be an object")
  }
  const selectedPairs = {}
  for (const symbol of executionSymbols) {
    const pair = strategyConfig.pairs[symbol]
    if (!pair || pair.enabled !== true) {
      throw new Error(`RS execution route references market ${symbol}, which is not explicitly enabled`)
    }
    if (![TRADING_ENVIRONMENTS.TESTNET, TRADING_ENVIRONMENTS.LIVE, TRADING_ENVIRONMENTS.BOTH].includes(pair.tradingEnvironment)) {
      throw new Error(`RS market ${symbol} has an unsupported tradingEnvironment`)
    }
    if (pair.tradingEnvironment !== TRADING_ENVIRONMENTS.BOTH &&
        pair.tradingEnvironment !== tradingMode) {
      throw new Error(`RS market ${symbol} is not enabled for TRADING_MODE=${tradingMode}`)
    }
    selectedPairs[symbol] = Object.fromEntries(
      Object.entries(pair).filter(([key]) => key !== "tradingEnvironment"),
    )
  }
  return selectedPairs
}

function selectExecutionPairs({ pairs, executionSymbols }) {
  if (executionSymbols === undefined) {
    return pairs
  }
  if (!Array.isArray(executionSymbols) || executionSymbols.length === 0) {
    throw new TypeError("executionSymbols must be a non-empty array when supplied")
  }
  const selectedPairs = {}
  for (const symbol of executionSymbols) {
    if (typeof symbol !== "string" || !symbol.trim()) {
      throw new TypeError("executionSymbols must contain non-empty market symbols")
    }
    if (!Object.hasOwn(pairs, symbol)) {
      throw new TypeError(
        `Execution route references market ${symbol}, which is not enabled for the selected environment`,
      )
    }
    if (Object.hasOwn(selectedPairs, symbol)) {
      throw new TypeError(`Execution symbols contain duplicate market ${symbol}`)
    }
    selectedPairs[symbol] = pairs[symbol]
  }
  return selectedPairs
}

function resolveEffectivePairs({ strategyConfig, tradingMode, executionSymbols }) {
  if (Object.keys(strategyConfig.pairs ?? {}).length === 0) {
    throw new Error("Conservative trading requires at least one enabled pair")
  }
  const environmentPairs = selectPairsForTradingMode({
    pairs: strategyConfig.pairs,
    tradingMode,
  })
  const pairs = selectExecutionPairs({
    pairs: environmentPairs,
    executionSymbols,
  })
  if (Object.keys(pairs).length === 0) {
    throw new Error(`No CG_coinGrabber pairs configured for TRADING_MODE=${tradingMode}`)
  }
  return pairs
}

function resolveConservativeRuntimePairs({
  strategyConfig,
  recoverySellerStrategyConfig,
  tradingMode,
  executionSymbols,
  executionRoutes,
} = {}) {
  const routes = resolveExecutionRouteSymbols({
    executionRoutes,
    executionSymbols,
  })
  const conservativePairs = resolveEffectivePairs({
    strategyConfig,
    tradingMode,
    executionSymbols: routes.conservativeExecutionSymbols,
  })
  const recoverySellerPairs = resolveRecoverySellerPairs({
    strategyConfig: recoverySellerStrategyConfig,
    tradingMode,
    executionSymbols: routes.recoverySellerExecutionSymbols,
  })
  const marketPairs = {
    ...conservativePairs,
  }
  for (const [symbol, pair] of Object.entries(recoverySellerPairs)) {
    if (!Object.hasOwn(marketPairs, symbol)) {
      marketPairs[symbol] = pair
    }
  }
  return {
    conservativePairs,
    recoverySellerPairs,
    marketPairs,
    executionSymbols: routes.executionSymbols ?? Object.keys(marketPairs),
  }
}

function createEffectiveAppConfig({
  configuredAppConfig,
  strategyConfig,
  conservativePairs,
  recoverySellerStrategyConfig,
  recoverySellerPairs,
}) {
  const strategies = {
    ...configuredAppConfig.strategies,
    CG_coinGrabber: {
      ...strategyConfig,
      pairs: conservativePairs,
    },
  }
  if (recoverySellerStrategyConfig) {
    strategies.RS_recoverySeller = {
      ...recoverySellerStrategyConfig,
      enabled: Object.keys(recoverySellerPairs).length > 0,
      pairs: recoverySellerPairs,
    }
  }
  return {
    ...configuredAppConfig,
    strategies,
  }
}

function createConfigurationEvidence({ appConfig, tradingMode, tradingEnabled }) {
  const effectiveConfiguration = createEffectiveStrategyConfigurationFingerprint({
    strategyName: "CG_coinGrabber",
    strategy: appConfig.strategies.CG_coinGrabber,
  })
  const enabledSymbols = [...effectiveConfiguration.enabledMarkets]
  const validatedConfigurationData = mapConfigValidatedData({
    enabledMarkets: enabledSymbols,
    strategyMode: "conservative",
    tradingMode,
    configurationFingerprint: effectiveConfiguration.fingerprint,
    tradingEnabled: tradingEnabled && enabledSymbols.length > 0,
  })
  if (validatedConfigurationData?.ok !== true) {
    throw new EffectiveConfigurationError({
      path: "config.validated",
      expected: "a complete effective-configuration evidence DTO",
    })
  }
  return {
    effectiveConfiguration,
    enabledSymbols,
    validatedConfigurationData,
  }
}

function publishValidatedConfiguration({ eventPublisher, validatedConfigurationData }) {
  publishLifecycleEvent({
    eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.CONFIG_VALIDATED,
    dataResult: validatedConfigurationData,
  })
}

function logValidatedConfiguration({ logger, environment, brokerName, tradingMode, enabledSymbols }) {
  const log = {
    message: "App configuration validated",
    environment,
    broker: brokerName,
    tradingMode,
    enabledSymbols,
    strategyMode: `conservative-${tradingMode}`,
  }
  if (typeof logger?.system === "function") {
    logger.system(log)
  } else {
    logger?.info?.(log)
  }
}

function publishConfigurationEvidence({
  eventPublisher,
  logger,
  runtime,
  evidence,
} = {}) {
  publishValidatedConfiguration({
    eventPublisher,
    validatedConfigurationData: evidence.validatedConfigurationData,
  })
  logValidatedConfiguration({
    logger,
    environment: runtime.environment,
    brokerName: runtime.brokerName,
    tradingMode: runtime.tradingMode,
    enabledSymbols: evidence.enabledSymbols,
  })
}

export async function resolveHarvesterOptions({
  configSource,
  appConfig: suppliedAppConfig,
  loadConfig,
  env = process.env,
  eventPublisher,
  logger,
  executionSymbols,
  executionRoutes,
} = {}) {
  const loadedAppConfig = suppliedAppConfig ?? await loadConfig(configSource)
  const configuredAppConfig = resolveTelegramOperatorConfig({
    appConfig: loadedAppConfig,
    env,
  })
  const strategyConfig = configuredAppConfig.strategies?.CG_coinGrabber
  assertSupportedStrategyConfig(strategyConfig)

  const runtime = resolveRuntimeConfig({
    tradingMode: env.TRADING_MODE,
    environment: env.NODE_ENV,
  })
  const recoverySellerStrategyConfig = configuredAppConfig.strategies?.RS_recoverySeller
  if (recoverySellerStrategyConfig?.enabled === true && executionRoutes === undefined) {
    throw new Error("Enabled RS markets require explicit strategy/market execution routes")
  }
  const resolvedPairs = resolveConservativeRuntimePairs({
    strategyConfig,
    recoverySellerStrategyConfig,
    tradingMode: runtime.tradingMode,
    executionSymbols,
    executionRoutes,
  })
  const appConfig = createEffectiveAppConfig({
    configuredAppConfig,
    strategyConfig,
    conservativePairs: resolvedPairs.conservativePairs,
    recoverySellerStrategyConfig,
    recoverySellerPairs: resolvedPairs.recoverySellerPairs,
  })
  const evidence = createConfigurationEvidence({
    appConfig,
    tradingMode: runtime.tradingMode,
    tradingEnabled: runtime.tradingEnabled,
  })
  publishConfigurationEvidence({
    eventPublisher,
    logger,
    runtime,
    evidence,
  })

  return Object.freeze({
    appConfig,
    settings: strategyConfig.settings,
    pairs: Object.freeze(resolvedPairs.marketPairs),
    conservativePairs: Object.freeze(resolvedPairs.conservativePairs),
    recoverySellerPairs: Object.freeze(resolvedPairs.recoverySellerPairs),
    enabledSymbols: Object.freeze(evidence.enabledSymbols),
    marketSymbols: Object.freeze(Object.keys(resolvedPairs.marketPairs)),
    executionSymbols: Object.freeze(resolvedPairs.executionSymbols),
    configurationFingerprint: evidence.effectiveConfiguration.fingerprint,
    environment: runtime.environment,
    brokerName: runtime.brokerName,
    tradingMode: runtime.tradingMode,
    tradingEnabled: runtime.tradingEnabled && evidence.enabledSymbols.length > 0,
    executionRoutes: Object.freeze([...(executionRoutes ?? [])]),
  })
}
