import { compareDecimal } from "@coinzilla/utils"

/** Deterministic full-fill candle matching. No partial fills or intrabar path inference. */
export function isLimitOrderTriggered({ side, limitPrice, candle }) {
  if (side === "BUY") return compareDecimal({ left: String(candle.low), right: String(limitPrice) }) <= 0
  if (side === "SELL") return compareDecimal({ left: String(candle.high), right: String(limitPrice) }) >= 0
  throw new TypeError("Unsupported order side: " + side)
}

export function isLimitMakerImmediatelyMarketable({ side, limitPrice, marketPrice }) {
  if (side === "BUY") return compareDecimal({ left: String(limitPrice), right: String(marketPrice) }) >= 0
  if (side === "SELL") return compareDecimal({ left: String(limitPrice), right: String(marketPrice) }) <= 0
  throw new TypeError("Unsupported order side: " + side)
}
