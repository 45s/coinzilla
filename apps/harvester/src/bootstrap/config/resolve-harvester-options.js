import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { publishLifecycleEvent } from "../../application/events/publish-lifecycle-event.js"
import { mapConfigValidatedData } from "../../application/events/lifecycle-event-dtos.js"
import { resolveRuntimeConfig, selectPairsForTradingMode } from "../../domain/app-config.js"
import { StrategyId } from "../../domain/strategies/strategy-ids.js"
import { TRADING_ENVIRONMENTS } from "../../domain/trading-environment.js"
import {
  createEffectiveHarvesterConfigurationFingerprint,
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

function getDisabledRecoveryOnlySymbols({
  configuredAppConfig,
  executionRoutes,
} = {}) {
  const recoverySellerSymbols = Object.keys(configuredAppConfig.strategies?.RS_recoverySeller?.pairs ?? {})
  const conservativeSymbols = new Set(Object.keys(configuredAppConfig.strategies?.CG_coinGrabber?.pairs ?? {}))
  const disabledRecoveryOnlySymbols = new Set(
    recoverySellerSymbols.filter((symbol) => !conservativeSymbols.has(symbol)),
  )
  if (!Array.isArray(executionRoutes)) {
    return disabledRecoveryOnlySymbols
  }

  const routedConservativeSymbols = new Set()
  for (const route of executionRoutes) {
    if (route?.strategyId === StrategyId.COIN_GRABBER) {
      routedConservativeSymbols.add(route.symbol)
    }
  }
  for (const route of executionRoutes) {
    if (route?.strategyId === StrategyId.RECOVERY_SELLER &&
        !routedConservativeSymbols.has(route.symbol)) {
      disabledRecoveryOnlySymbols.add(route.symbol)
    }
  }
  return disabledRecoveryOnlySymbols
}

function resolveEffectiveExecutionInputs({
  configuredAppConfig,
  executionSymbols,
  executionRoutes,
} = {}) {
  if (configuredAppConfig.components?.recovery?.enabled !== false) {
    return { executionSymbols, executionRoutes }
  }

  const disabledRecoveryOnlySymbols = getDisabledRecoveryOnlySymbols({
    configuredAppConfig,
    executionRoutes,
  })
  return {
    executionRoutes: Array.isArray(executionRoutes)
      ? executionRoutes.filter((route) => route?.strategyId !== StrategyId.RECOVERY_SELLER)
      : executionRoutes,
    executionSymbols: executionSymbols === undefined || !Array.isArray(executionSymbols)
      ? executionSymbols
      : executionSymbols.filter((symbol) => !disabledRecoveryOnlySymbols.has(symbol)),
  }
}

function resolveExecutionRouteSymbols({ executionRoutes, executionSymbols } = {}) {
  if (executionRoutes === undefined) {
    return {
      conservativeExecutionSymbols: executionSymbols,
      recoverySellerExecutionSymbols: undefined,
      executionSymbols,
      executionRoutes: undefined,
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
  if (conservativeExecutionSymbols.length === 0 && recoverySellerExecutionSymbols.length === 0) {
    throw new Error("This provider account has no enabled strategy execution routes")
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
    executionRoutes,
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
  if (!Array.isArray(executionSymbols)) {
    throw new TypeError("executionSymbols must be an array when supplied")
  }
  if (executionSymbols.length === 0) {
    return {}
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
  if (executionSymbols === undefined && Object.keys(strategyConfig.pairs ?? {}).length === 0) {
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
  if (Object.keys(pairs).length === 0 && executionSymbols === undefined) {
    throw new Error(`No CG_coinGrabber pairs configured for TRADING_MODE=${tradingMode}`)
  }
  return pairs
}

function hasMarketVolatilityConfigurationConflict({ conservativePair, recoverySellerPair } = {}) {
  return conservativePair?.enabled === true &&
    recoverySellerPair?.enabled === true &&
    typeof conservativePair.enableVolatilityProtection === "boolean" &&
    typeof recoverySellerPair.enableVolatilityProtection === "boolean" &&
    conservativePair.enableVolatilityProtection !== recoverySellerPair.enableVolatilityProtection
}

function assertConsistentMarketVolatilityConfiguration({
  strategyConfig,
  recoverySellerStrategyConfig,
} = {}) {
  const conservativePairs = strategyConfig?.pairs ?? {}
  const recoverySellerPairs = recoverySellerStrategyConfig?.pairs ?? {}
  for (const [symbol, conservativePair] of Object.entries(conservativePairs)) {
    if (hasMarketVolatilityConfigurationConflict({
      conservativePair,
      recoverySellerPair: recoverySellerPairs[symbol],
    })) {
      throw new TypeError(`Market ${symbol} has conflicting volatility protection settings for CG and RS`)
    }
  }
}

function resolveConservativeRuntimePairs({
  strategyConfig,
  recoverySellerStrategyConfig,
  tradingMode,
  executionSymbols,
  executionRoutes,
} = {}) {
  assertConsistentMarketVolatilityConfiguration({
    strategyConfig,
    recoverySellerStrategyConfig,
  })
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
    executionRoutes: routes.executionRoutes,
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
  const effectiveConfiguration = createEffectiveHarvesterConfigurationFingerprint({
    strategies: appConfig.strategies,
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

function createResolvedHarvesterRuntime({
  configuredAppConfig,
  env,
  executionSymbols,
  executionRoutes,
} = {}) {
  const strategyConfig = configuredAppConfig.strategies?.CG_coinGrabber
  assertSupportedStrategyConfig(strategyConfig)
  const runtime = resolveRuntimeConfig({
    tradingMode: env.TRADING_MODE,
    environment: env.NODE_ENV,
  })
  const recoveryComponentEnabled = configuredAppConfig.components?.recovery?.enabled !== false
  const configuredRecoverySellerStrategyConfig = configuredAppConfig.strategies?.RS_recoverySeller
  let recoverySellerStrategyConfig = configuredRecoverySellerStrategyConfig
  if (!recoveryComponentEnabled && configuredRecoverySellerStrategyConfig) {
    recoverySellerStrategyConfig = {
      ...configuredRecoverySellerStrategyConfig,
      enabled: false,
      pairs: {},
    }
  }
  if (recoveryComponentEnabled && recoverySellerStrategyConfig?.enabled === true && executionRoutes === undefined) {
    throw new Error("Enabled RS markets require explicit strategy/market execution routes")
  }
  const effectiveExecutionInputs = resolveEffectiveExecutionInputs({
    configuredAppConfig,
    executionSymbols,
    executionRoutes,
  })
  const resolvedPairs = resolveConservativeRuntimePairs({
    strategyConfig,
    recoverySellerStrategyConfig,
    tradingMode: runtime.tradingMode,
    executionSymbols: effectiveExecutionInputs.executionSymbols,
    executionRoutes: effectiveExecutionInputs.executionRoutes,
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
  return {
    appConfig,
    strategyConfig,
    runtime,
    resolvedPairs,
    evidence,
  }
}

function resolveMarketPriceStrategyIds({ marketPairs, conservativePairs, recoverySellerPairs } = {}) {
  const strategyIdsBySymbol = {}
  for (const symbol of Object.keys(marketPairs ?? {})) {
    const isConservativeOwner = Object.hasOwn(conservativePairs ?? {}, symbol)
    const isRecoverySellerOwner = Object.hasOwn(recoverySellerPairs ?? {}, symbol)
    if (isConservativeOwner === isRecoverySellerOwner) {
      strategyIdsBySymbol[symbol] = null
      continue
    }
    strategyIdsBySymbol[symbol] = isConservativeOwner
      ? StrategyId.COIN_GRABBER
      : StrategyId.RECOVERY_SELLER
  }
  return Object.freeze(strategyIdsBySymbol)
}

function createResolvedHarvesterOptions({ resolved, eventPublisher, logger, executionRoutes } = {}) {
  publishConfigurationEvidence({
    eventPublisher,
    logger,
    runtime: resolved.runtime,
    evidence: resolved.evidence,
  })
  return Object.freeze({
    appConfig: resolved.appConfig,
    settings: resolved.strategyConfig.settings,
    pairs: Object.freeze(resolved.resolvedPairs.marketPairs),
    conservativePairs: Object.freeze(resolved.resolvedPairs.conservativePairs),
    recoverySellerPairs: Object.freeze(resolved.resolvedPairs.recoverySellerPairs),
    enabledSymbols: Object.freeze(resolved.evidence.enabledSymbols),
    marketSymbols: Object.freeze(Object.keys(resolved.resolvedPairs.marketPairs)),
    executionSymbols: Object.freeze(resolved.resolvedPairs.executionSymbols),
    configurationFingerprint: resolved.evidence.effectiveConfiguration.fingerprint,
    environment: resolved.runtime.environment,
    brokerName: resolved.runtime.brokerName,
    tradingMode: resolved.runtime.tradingMode,
    tradingEnabled: resolved.runtime.tradingEnabled && resolved.evidence.enabledSymbols.length > 0,
    executionRoutes: Object.freeze([...(resolved.resolvedPairs.executionRoutes ?? executionRoutes ?? [])]),
    marketPriceStrategyIds: resolveMarketPriceStrategyIds({
      marketPairs: resolved.resolvedPairs.marketPairs,
      conservativePairs: resolved.resolvedPairs.conservativePairs,
      recoverySellerPairs: resolved.resolvedPairs.recoverySellerPairs,
    }),
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
  const resolved = createResolvedHarvesterRuntime({
    configuredAppConfig,
    env,
    executionSymbols,
    executionRoutes,
  })
  return createResolvedHarvesterOptions({
    resolved,
    eventPublisher,
    logger,
    executionRoutes: resolved.resolvedPairs.executionRoutes,
  })
}
