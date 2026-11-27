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

function logReceivedMarketMetadata({ logger, symbol, pairConfig, metadata } = {}) {
  logger?.trace?.({
    message: "Exchange market metadata received",
    component: "market-metadata-bootstrap",
    operation: "validate-market-trading-readiness",
    symbol,
    enabled: pairConfig.enabled === true,
    supportedOrderTypes: metadata.supportedOrderTypes,
    unvalidatedConstraintCount: metadata.unvalidatedConstraints?.length,
    unvalidatedConstraints: metadata.unvalidatedConstraints,
  })
}

function validateCanonicalMarketMetadata({ symbol, metadata } = {}) {
  const { market } = metadata
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
  return market
}

function publishValidatedMarketMetadata({ eventPublisher, metadata, logger, symbol } = {}) {
  publishLifecycleEvent({
    eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.MARKET_TRADING_RULES_CAPTURED,
    dataResult: mapMarketTradingRulesCapturedData({ metadata }),
  })
  logSystem({
    logger,
    message: "Supported exchange trading rules validated",
    symbol,
    unvalidatedConstraintCount: metadata.unvalidatedConstraints.length,
  })
}

function requireFetchedMarketMetadata({ symbol, filtersResult } = {}) {
  if (filtersResult?.ok && filtersResult.data) {
    return filtersResult.data
  }
  const details = filtersResult?.errors?.map((error) => error?.message ?? String(error)).join("; ")
  const message = [
    "Unable to load exchange market metadata for configured pair ",
    symbol,
    details ? ": " : "",
    details ?? "",
  ].join("")
  throw new Error(message)
}

function createCapturedMarketMetadata({ symbol, filtersResult, now } = {}) {
  const source = requireFetchedMarketMetadata({
    symbol,
    filtersResult,
  })
  const metadataCapturedAt = readMetadataCaptureTimestamp({ now })
  const metadataVersion = source.metadataVersion ?? null
  return Object.freeze({
    ...source,
    metadataCapturedAt,
    metadataVersion,
  })
}

function storeDisabledMarketMetadata({ symbol, market, metadata, marketMetadata, logger } = {}) {
  marketMetadata.set(symbol, metadata)
  logSystem({
    logger,
    message: "Configured disabled market asset metadata loaded",
    symbol,
    baseAsset: market.baseAsset.code,
    quoteAsset: market.quoteAsset.code,
  })
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
  const receivedMetadata = createCapturedMarketMetadata({
    symbol,
    filtersResult: await broker.getSymbolFilters({ symbol }),
    now,
  })
  logReceivedMarketMetadata({
    logger,
    symbol,
    pairConfig,
    metadata: receivedMetadata,
  })
  const market = validateCanonicalMarketMetadata({
    symbol,
    metadata: receivedMetadata,
  })
  if (!pairConfig.enabled) {
    storeDisabledMarketMetadata({
      symbol,
      market,
      metadata: receivedMetadata,
      marketMetadata,
      logger,
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
    metadataCapturedAt: receivedMetadata.metadataCapturedAt,
    metadataVersion: receivedMetadata.metadataVersion,
  })
  marketMetadata.set(symbol, metadataSnapshot)
  publishValidatedMarketMetadata({
    eventPublisher,
    metadata: metadataSnapshot,
    logger,
    symbol,
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
