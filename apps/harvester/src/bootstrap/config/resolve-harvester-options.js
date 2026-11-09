import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { publishLifecycleEvent } from "../../application/events/publish-lifecycle-event.js"
import { mapConfigValidatedData } from "../../application/events/lifecycle-event-dtos.js"
import { resolveHarvesterRuntimeConfig } from "../../domain/trading-config.js"

/**
 * Resolve the enabled strategy and validated environment-specific runtime profile.
 * Performs no broker I/O; the returned object is the startup configuration contract.
 */
export async function resolveHarvesterOptions({
  configSource,
  tradingConfig: suppliedTradingConfig,
  loadConfig,
  env = process.env,
  eventPublisher,
  logger,
} = {}) {
  const tradingConfig = suppliedTradingConfig ?? await loadConfig(configSource)
  const strategyConfig = tradingConfig.strategies?.CG_coinGrabber
  if (strategyConfig?.enabled !== true) {
    throw new Error("CG_coinGrabber strategy must remain enabled in trading config")
  }
  if (strategyConfig.settings?.conservative?.enabled !== true) {
    throw new Error("Conservative strategy must remain enabled in CG_coinGrabber settings")
  }
  if (strategyConfig.settings?.aggressive?.enabled === true) {
    throw new Error("Aggressive strategy is disabled and deferred; set strategies.CG_coinGrabber.settings.aggressive.enabled=false")
  }
  const { settings, pairs } = strategyConfig
  const enabledSymbols = Object.entries(pairs)
    .filter(([, pairConfig]) => pairConfig.enabled)
    .map(([symbol]) => symbol)
  const runtime = resolveHarvesterRuntimeConfig({ config: tradingConfig, environment: env.NODE_ENV })
  const {
    environment,
    brokerName,
    tradingMode,
    tradingRequested,
    tradingEnabled,
  } = runtime

  if (tradingRequested && brokerName !== "binance") {
    throw new Error("TESTNET trading requires runtime profile broker=binance")
  }
  if (tradingRequested && environment === "development" && tradingMode !== "testnet") {
    throw new Error("Development order execution requires runtime profile trading.mode=testnet")
  }
  if (tradingRequested && environment === "production" && tradingMode !== "live") {
    throw new Error("Production order execution requires runtime profile trading.mode=live")
  }
  if (tradingRequested && enabledSymbols.length === 0) {
    throw new Error("Conservative TESTNET trading requires at least one enabled pair")
  }

  publishLifecycleEvent({
    eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.CONFIG_VALIDATED,
    dataResult: mapConfigValidatedData({
      enabledMarkets: enabledSymbols,
      strategyMode: tradingEnabled ? "conservative" : "read-only",
      tradingEnabled,
    }),
  })
  const log = {
    message: "Trading configuration validated",
    environment,
    broker: brokerName ?? "none",
    tradingMode,
    enabledSymbols,
    strategyMode: tradingRequested ? "conservative-testnet" : "read-only",
  }
  if (typeof logger?.system === "function") logger.system(log)
  else logger?.info?.(log)

  return Object.freeze({
    tradingConfig,
    settings,
    pairs,
    enabledSymbols: Object.freeze(enabledSymbols),
    environment,
    brokerName,
    tradingMode,
    tradingRequested,
    tradingEnabled,
  })
}
