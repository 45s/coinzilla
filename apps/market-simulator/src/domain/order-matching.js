import { compareDecimal } from "./decimal.js"

/** Deterministic full-fill candle matching. No partial fills or intrabar path inference. */
export function isLimitOrderTriggered({ side, limitPrice, candle }) {
  if (side === "BUY") return compareDecimal(candle.low, limitPrice) <= 0
  if (side === "SELL") return compareDecimal(candle.high, limitPrice) >= 0
  throw new TypeError(`Unsupported order side: ${side}`)
}

export function isLimitMakerImmediatelyMarketable({ side, limitPrice, marketPrice }) {
  if (side === "BUY") return compareDecimal(limitPrice, marketPrice) >= 0
  if (side === "SELL") return compareDecimal(limitPrice, marketPrice) <= 0
  throw new TypeError(`Unsupported order side: ${side}`)
}
