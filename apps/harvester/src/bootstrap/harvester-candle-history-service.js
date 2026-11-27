function resolveCandleHistoryBroker({
  broker,
  getMarketDataBroker,
  symbol,
}) {
  const sourceBroker = typeof getMarketDataBroker === "function"
    ? getMarketDataBroker({ symbol })
    : broker
  if (
    !sourceBroker ||
    typeof sourceBroker.getCandles !== "function" ||
    typeof sourceBroker.subscribeForCandles !== "function"
  ) {
    throw new TypeError(`Candle market-data source for ${symbol} does not expose the required BrokerPort methods`)
  }
  return sourceBroker
}

function createCandleHistoryBroker({ broker,
  getMarketDataBroker }) {
  return Object.freeze({
    getCandles: (input = {}) => resolveCandleHistoryBroker({
      broker,
      getMarketDataBroker,
      symbol: input.symbol,
    }).getCandles(input),
    subscribeForCandles: (input = {}) => resolveCandleHistoryBroker({
      broker,
      getMarketDataBroker,
      symbol: input.symbol,
    }).subscribeForCandles(input),
  })
}

function attachMarketDataIdentityToSnapshot({
  snapshot,
  symbol,
  marketDataProviderIdentities,
}) {
  const sourceIdentity = marketDataProviderIdentities[symbol]
  if (!snapshot?.ok || !snapshot.data || !sourceIdentity) {
    return snapshot
  }
  return {
    ...snapshot,
    data: Object.freeze({
      ...snapshot.data,
      ...sourceIdentity,
    }),
  }
}

export function createHarvesterCandleHistoryService({
  createCandleHistoryService,
  broker,
  logger,
  now,
  getTradingEngine,
  getMarketDataBroker,
  marketDataProviderIdentities = {},
} = {}) {
  const service = createCandleHistoryService({
    broker: createCandleHistoryBroker({ broker,
  getMarketDataBroker }),
    logger,
    now,
    onSnapshot: async ({ symbol,
  snapshot } = {}) => {
      const sourceAwareSnapshot = attachMarketDataIdentityToSnapshot({
        snapshot,
        symbol,
        marketDataProviderIdentities,
      })
      const result = await getTradingEngine()?.processVolatilitySnapshot({
        symbol,
        snapshot: sourceAwareSnapshot,
      })
      if (result && !result.ok) {
        logger?.error?.({
          message: "Harvester volatility protection update failed",
          symbol,
          error: result.error,
          errors: result.errors,
        })
      }
    },
  })
  return Object.freeze({
    ...service,
    getSnapshot: ({ symbol } = {}) => attachMarketDataIdentityToSnapshot({
      snapshot: service.getSnapshot({ symbol }),
      symbol,
      marketDataProviderIdentities,
    }),
  })
}
