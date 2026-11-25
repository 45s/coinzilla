import { StrategyId } from "../domain/strategies/strategy-ids.js"

function resolveStrategyId({ symbol, strategyIdsBySymbol } = {}) {
  const strategyId = strategyIdsBySymbol?.[symbol]
  if (strategyId === StrategyId.COIN_GRABBER || strategyId === StrategyId.RECOVERY_SELLER) {
    return strategyId
  }
  return undefined
}

/** Report market-price failures with only a uniquely resolved execution strategy owner. */
export function createMarketPriceErrorHandler({ logger, strategyIdsBySymbol } = {}) {
  return ({ symbol, error, errors } = {}) => {
    const strategyId = resolveStrategyId({
      symbol,
      strategyIdsBySymbol,
    })
    const diagnostic = {
      message: "Market price processing failed",
      ...(strategyId === undefined ? {} : { strategyId }),
      symbol,
      error,
      errors,
    }
    logger.error?.(diagnostic)
  }
}
