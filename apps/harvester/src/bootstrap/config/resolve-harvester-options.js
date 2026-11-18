import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { publishLifecycleEvent } from "../../application/events/publish-lifecycle-event.js"
import { mapConfigValidatedData } from "../../application/events/lifecycle-event-dtos.js"
import { resolveRuntimeConfig, selectPairsForTradingMode } from "../../domain/app-config.js"
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

function createEffectiveAppConfig({ configuredAppConfig, strategyConfig, pairs }) {
  return {
    ...configuredAppConfig,
    strategies: {
      ...configuredAppConfig.strategies,
      CG_coinGrabber: {
        ...strategyConfig,
        pairs,
      },
    },
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

export async function resolveHarvesterOptions({
  configSource,
  appConfig: suppliedAppConfig,
  loadConfig,
  env = process.env,
  eventPublisher,
  logger,
  executionSymbols,
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
  const pairs = resolveEffectivePairs({
    strategyConfig,
    tradingMode: runtime.tradingMode,
    executionSymbols,
  })
  const appConfig = createEffectiveAppConfig({
    configuredAppConfig,
    strategyConfig,
    pairs,
  })
  const evidence = createConfigurationEvidence({
    appConfig,
    tradingMode: runtime.tradingMode,
    tradingEnabled: runtime.tradingEnabled,
  })
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

  return Object.freeze({
    appConfig,
    settings: strategyConfig.settings,
    pairs,
    enabledSymbols: Object.freeze(evidence.enabledSymbols),
    executionSymbols: Object.freeze(evidence.enabledSymbols),
    configurationFingerprint: evidence.effectiveConfiguration.fingerprint,
    environment: runtime.environment,
    brokerName: runtime.brokerName,
    tradingMode: runtime.tradingMode,
    tradingEnabled: runtime.tradingEnabled && evidence.enabledSymbols.length > 0,
  })
}
