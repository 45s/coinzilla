import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { publishLifecycleEvent } from "../../application/events/publish-lifecycle-event.js"
import { mapConfigValidatedData } from "../../application/events/lifecycle-event-dtos.js"
import { resolveHarvesterRuntimeConfig } from "../../domain/trading-config.js"

export async function resolveHarvesterOptions({ configSource, tradingConfig: suppliedTradingConfig, loadConfig, env = process.env, eventPublisher, logger } = {}) {
  const tradingConfig = suppliedTradingConfig ?? await loadConfig(configSource)
  const strategyConfig = tradingConfig.strategies?.CG_coinGrabber
  if (strategyConfig?.enabled !== true) throw new Error("CG_coinGrabber strategy must remain enabled in trading config")
  if (strategyConfig.settings?.conservative?.enabled !== true) throw new Error("Conservative strategy must remain enabled in CG_coinGrabber settings")
  if (strategyConfig.settings?.aggressive?.enabled === true) throw new Error("Aggressive strategy is disabled and deferred; set strategies.CG_coinGrabber.settings.aggressive.enabled=false")
  const { settings, pairs } = strategyConfig
  const enabledSymbols = Object.entries(pairs).filter(([, pairConfig]) => pairConfig.enabled).map(([symbol]) => symbol)
  if (enabledSymbols.length === 0) throw new Error("Conservative trading requires at least one enabled pair")
  const runtime = resolveHarvesterRuntimeConfig({ tradingMode: env.TRADING_MODE, environment: env.NODE_ENV })
  const { environment, brokerName, tradingMode, tradingEnabled } = runtime
  publishLifecycleEvent({
    eventPublisher, eventName: HARVESTER_EVENT_NAMES.CONFIG_VALIDATED,
    dataResult: mapConfigValidatedData({ enabledMarkets: enabledSymbols, strategyMode: "conservative", tradingEnabled: true }),
  })
  const log = { message: "Trading configuration validated", environment, broker: brokerName, tradingMode, enabledSymbols, strategyMode: "conservative-" + tradingMode }
  if (typeof logger?.system === "function") logger.system(log)
  else logger?.info?.(log)
  return Object.freeze({ tradingConfig, settings, pairs, enabledSymbols: Object.freeze(enabledSymbols), environment, brokerName, tradingMode, tradingEnabled })
}
