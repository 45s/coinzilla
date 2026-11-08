import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { publishLifecycleEvent } from "../../application/events/publish-lifecycle-event.js"
import { mapConfigValidatedData } from "../../application/events/lifecycle-event-dtos.js"

/**
 * Resolve the Harvester's enabled strategy configuration and safety-gated mode.
 * Performs no broker I/O; the returned object is the startup configuration contract.
 */
export async function resolveHarvesterOptions({
  configSource,
  loadConfig,
  env,
  eventPublisher,
  logger,
} = {}) {
  const tradingConfig = await loadConfig(configSource)
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
  const brokerName = env.HARVESTER_BROKER
  if (brokerName !== undefined && brokerName !== "" && brokerName !== "binance") {
    throw new Error("Unsupported HARVESTER_BROKER value: " + brokerName)
  }
  const tradingRequested = env.HARVESTER_ENABLE_TRADING === "true"
  if (tradingRequested && enabledSymbols.length === 0) {
    throw new Error("Conservative TESTNET trading requires at least one enabled pair")
  }
  if (tradingRequested && (brokerName === undefined || brokerName === "")) {
    throw new Error("HARVESTER_BROKER=binance is required when HARVESTER_ENABLE_TRADING=true")
  }
  const tradingEnabled = brokerName === "binance" && tradingRequested
  if (tradingEnabled && (env.HARVESTER_TRADING_MODE !== "testnet" || env.NODE_ENV === "production")) {
    throw new Error("Harvester order execution requires HARVESTER_TRADING_MODE=testnet and non-production NODE_ENV")
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
  if (typeof logger?.system === "function") {
    logger.system({
      message: "Trading configuration validated",
      enabledSymbols,
      strategyMode: tradingRequested ? "conservative-testnet" : "read-only",
    })
  } else {
    logger?.info?.({
      message: "Trading configuration validated",
      enabledSymbols,
      strategyMode: tradingRequested ? "conservative-testnet" : "read-only",
    })
  }

  return Object.freeze({
    tradingConfig,
    settings,
    pairs,
    enabledSymbols: Object.freeze(enabledSymbols),
    brokerName,
    tradingRequested,
    tradingEnabled,
  })
}
