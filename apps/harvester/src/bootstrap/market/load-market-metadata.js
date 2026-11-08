import { validateMarketTradingReadiness } from "../../domain/market/validate-market-trading-readiness.js"
import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { publishLifecycleEvent } from "../../application/events/publish-lifecycle-event.js"
import { mapMarketTradingRulesCapturedData } from "../../application/events/lifecycle-event-dtos.js"

function logSystem(logger, data) {
  if (typeof logger?.system === "function") {
    logger.system(data)
    return
  }
  logger?.info?.(data)
}

/**
 * Load exchange metadata for every configured market and validate enabled pairs.
 * Disabled markets retain canonical asset metadata for account-audit coverage but
 * do not undergo order-readiness validation or emit trading-rule capture events.
 */
export async function loadMarketMetadata({
  broker, pairs, marketMetadata, eventPublisher, logger,
} = {}) {
    for (const [symbol, pairConfig] of Object.entries(pairs)) {
      const filtersResult = await broker.getSymbolFilters({ symbol })
      if (!filtersResult?.ok || !filtersResult.data) {
        const details = filtersResult?.errors?.map((error) => error?.message ?? String(error)).join("; ")
        throw new Error(
          "Unable to load exchange market metadata for configured pair " + symbol +
          (details ? ": " + details : ""),
        )
      }
      const market = filtersResult.data.market
      if (
        !market ||
        market.symbol !== symbol ||
        !market.baseAsset?.code ||
        !market.quoteAsset?.code
      ) {
        throw new Error("Configured pair " + symbol + " does not expose canonical base/quote asset metadata")
      }
      if (!pairConfig.enabled) {
        marketMetadata.set(symbol, filtersResult.data)
        logSystem(logger, {
          message: "Configured disabled market asset metadata loaded",
          symbol,
          baseAsset: market.baseAsset.code,
          quoteAsset: market.quoteAsset.code,
        })
        continue
      }

      const validatedMetadata = validateMarketTradingReadiness({
        symbol,
        pairConfig,
        marketMetadata: filtersResult.data,
      })
      marketMetadata.set(symbol, validatedMetadata)
      publishLifecycleEvent({
        eventPublisher,
        eventName: HARVESTER_EVENT_NAMES.MARKET_TRADING_RULES_CAPTURED,
        dataResult: mapMarketTradingRulesCapturedData({ metadata: validatedMetadata }),
      })
      logSystem(logger, { message: "Exchange trading rules validated", symbol })
    }

  return marketMetadata
}
