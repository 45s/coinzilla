import { validateMarketTradingReadiness } from "../../domain/market/validate-market-trading-readiness.js"
import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { publishLifecycleEvent } from "../../application/events/publish-lifecycle-event.js"
import { mapMarketTradingRulesCapturedData } from "../../application/events/lifecycle-event-dtos.js"

function logSystem({ logger, ...data }) {
  if (typeof logger?.system === "function") {
    logger.system(data)
    return
  }
  logger?.info?.(data)
}

function readMetadataCaptureTimestamp({ now } = {}) {
  if (typeof now !== "function") {
    throw new TypeError("Market metadata capture clock must be a function")
  }
  const timestamp = now()
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new TypeError("Market metadata capture clock must return a non-negative safe integer timestamp")
  }
  return timestamp
}

async function loadConfiguredMarketMetadata({
  broker,
  symbol,
  pairConfig,
  marketMetadata,
  eventPublisher,
  logger,
  now,
} = {}) {
  const filtersResult = await broker.getSymbolFilters({ symbol })
  if (!filtersResult?.ok || !filtersResult.data) {
    const details = filtersResult?.errors?.map((error) => error?.message ?? String(error)).join("; ")
    const message = [
      "Unable to load exchange market metadata for configured pair ",
      symbol,
      details ? ": " : "",
      details ?? "",
    ].join("")
    throw new Error(message)
  }
  const metadataCapturedAt = readMetadataCaptureTimestamp({ now })
  const metadataVersion = filtersResult.data.metadataVersion ?? null
  const receivedMetadata = Object.freeze({
    ...filtersResult.data,
    metadataCapturedAt,
    metadataVersion,
  })
  const { market } = receivedMetadata
  logger?.trace?.({
    message: "Exchange market metadata received",
    component: "market-metadata-bootstrap",
    operation: "validate-market-trading-readiness",
    symbol,
    enabled: pairConfig.enabled === true,
    supportedOrderTypes: receivedMetadata.supportedOrderTypes,
    unvalidatedConstraintCount: receivedMetadata.unvalidatedConstraints?.length,
    unvalidatedConstraints: receivedMetadata.unvalidatedConstraints,
  })
  if (
    !market ||
    market.symbol !== symbol ||
    !market.baseAsset?.code ||
    !market.quoteAsset?.code
  ) {
    throw new Error([
      "Configured pair ",
      symbol,
      " does not expose canonical base/quote asset metadata",
    ].join(""))
  }
  if (!pairConfig.enabled) {
    marketMetadata.set(symbol, receivedMetadata)
    logSystem({
      logger,
      message: "Configured disabled market asset metadata loaded",
      symbol,
      baseAsset: market.baseAsset.code,
      quoteAsset: market.quoteAsset.code,
    })
    return
  }

  const validatedMetadata = validateMarketTradingReadiness({
    symbol,
    pairConfig,
    marketMetadata: receivedMetadata,
  })
  const metadataSnapshot = Object.freeze({
    ...validatedMetadata,
    metadataCapturedAt,
    metadataVersion,
  })
  marketMetadata.set(symbol, metadataSnapshot)
  publishLifecycleEvent({
    eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.MARKET_TRADING_RULES_CAPTURED,
    dataResult: mapMarketTradingRulesCapturedData({ metadata: metadataSnapshot }),
  })
  logSystem({
    logger,
    message: "Supported exchange trading rules validated",
    symbol,
    unvalidatedConstraintCount: metadataSnapshot.unvalidatedConstraints.length,
  })
}

/**
 * Load exchange metadata for every configured market and validate enabled pairs.
 * Disabled markets retain canonical asset metadata for account-audit coverage but
 * do not undergo order-readiness validation or emit trading-rule capture events.
 */
export async function loadMarketMetadata({
  broker,
  pairs,
  marketMetadata,
  eventPublisher,
  logger,
  now = Date.now,
} = {}) {
  for (const [symbol, pairConfig] of Object.entries(pairs)) {
    await loadConfiguredMarketMetadata({
      broker,
      symbol,
      pairConfig,
      marketMetadata,
      eventPublisher,
      logger,
      now,
    })
  }
  return marketMetadata
}
