import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { publishLifecycleEvent } from "../../application/events/publish-lifecycle-event.js"
import { mapConfigValidatedData } from "../../application/events/lifecycle-event-dtos.js"
import { resolveRuntimeConfig, selectPairsForTradingMode } from "../../domain/app-config.js"
import {
  createEffectiveStrategyConfigurationFingerprint,
  EffectiveConfigurationError,
} from "../../domain/configuration/create-effective-strategy-configuration-fingerprint.js"
import { resolveTelegramOperatorConfig } from "../operator-control/resolve-telegram-operator-config.js"
import { resolveProviderConfiguration } from "../broker/resolve-provider-configuration.js"

function assertSupportedStrategyConfig(strategyConfig) {
  if (strategyConfig?.enabled !== true) {
    throw new Error("CG_coinGrabber strategy must remain enabled in app config")
  }
  if (strategyConfig.settings?.conservative?.enabled !== true) {
    throw new Error("Conservative strategy must remain enabled in CG_coinGrabber settings")
  }
  if (strategyConfig.settings?.aggressive?.enabled === true) {
    throw new Error("Aggressive strategy is disabled and deferred; set strategies.CG_coinGrabber.settings.aggressive.enabled=false")
  }
}

function resolveProviderRuntime({ configuredAppConfig, env }) {
  const runtime = resolveRuntimeConfig({
    tradingMode: env.TRADING_MODE,
    environment: env.NODE_ENV,
  })
  const providerConfiguration = resolveProviderConfiguration({
    brokers: configuredAppConfig.brokers,
    tradingMode: runtime.tradingMode,
  })
  const selectedProvider = providerConfiguration.instances.find(
    (instance) => instance.id === providerConfiguration.selections.execution,
  )
  return {
    runtime,
    providerConfiguration,
    selectedProvider,
  }
}

function publishValidatedConfiguration({
  eventPublisher,
  logger,
  enabledSymbols,
  effectiveConfiguration,
  environment,
  brokerName,
  tradingMode,
  tradingEnabled,
}) {
  const validatedConfigurationData = mapConfigValidatedData({
    enabledMarkets: enabledSymbols,
    strategyMode: "conservative",
    tradingMode,
    configurationFingerprint: effectiveConfiguration.fingerprint,
    tradingEnabled,
  })
  if (validatedConfigurationData?.ok !== true) {
    throw new EffectiveConfigurationError({
      path: "config.validated",
      expected: "a complete effective-configuration evidence DTO",
    })
  }
  publishLifecycleEvent({
    eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.CONFIG_VALIDATED,
    dataResult: validatedConfigurationData,
  })
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
} = {}) {
  const loadedAppConfig = suppliedAppConfig ?? await loadConfig(configSource)
  const configuredAppConfig = resolveTelegramOperatorConfig({
    appConfig: loadedAppConfig,
    env,
  })
  const strategyConfig = configuredAppConfig.strategies?.CG_coinGrabber
  assertSupportedStrategyConfig(strategyConfig)
  const {
    runtime,
    providerConfiguration,
    selectedProvider,
  } = resolveProviderRuntime({
    configuredAppConfig,
    env,
  })
  const { environment, tradingMode, tradingEnabled } = runtime
  const brokerName = selectedProvider.provider
  if (Object.keys(strategyConfig.pairs ?? {}).length === 0) {
    throw new Error("Conservative trading requires at least one enabled pair")
  }
  const pairs = selectPairsForTradingMode({
    pairs: strategyConfig.pairs,
    tradingMode,
  })
  if (Object.keys(pairs).length === 0) {
    throw new Error(`No CG_coinGrabber pairs configured for TRADING_MODE=${tradingMode}; configure a pair with tradingEnvironment="${tradingMode}" or "both"`)
  }
  const { settings } = strategyConfig
  const appConfig = {
    ...configuredAppConfig,
    strategies: {
      ...configuredAppConfig.strategies,
      CG_coinGrabber: {
        ...strategyConfig,
        pairs,
      },
    },
  }
  const effectiveConfiguration = createEffectiveStrategyConfigurationFingerprint({
    strategyName: "CG_coinGrabber",
    strategy: appConfig.strategies.CG_coinGrabber,
  })
  const enabledSymbols = [...effectiveConfiguration.enabledMarkets]
  publishValidatedConfiguration({
    eventPublisher,
    logger,
    enabledSymbols,
    effectiveConfiguration,
    environment,
    brokerName,
    tradingMode,
    tradingEnabled,
  })
  return Object.freeze({
    appConfig,
    settings,
    pairs,
    enabledSymbols: Object.freeze(enabledSymbols),
    configurationFingerprint: effectiveConfiguration.fingerprint,
    environment,
    brokerName,
    providerInstanceId: selectedProvider.id,
    providerInstances: providerConfiguration.instances,
    providerSelections: providerConfiguration.selections,
    tradingMode,
    tradingEnabled,
  })
}
