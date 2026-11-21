const ORDER_PROBES = Object.freeze([
  Object.freeze({
    id: "limit-buy-1",
    symbol: "HYPEUSDT",
    side: "BUY",
    type: "LIMIT",
    quantity: "1",
    price: "30",
    amountAsset: "HYPE",
    quoteNotional: "30",
  }),
  Object.freeze({
    id: "limit-buy-2",
    symbol: "HYPEUSDT",
    side: "BUY",
    type: "LIMIT",
    quantity: "2",
    price: "30",
    amountAsset: "HYPE",
    quoteNotional: "60",
  }),
  Object.freeze({
    id: "limit-sell-1",
    symbol: "HYPEUSDT",
    side: "SELL",
    type: "LIMIT",
    quantity: "1",
    price: "30",
    amountAsset: "HYPE",
    quoteNotional: "30",
  }),
  Object.freeze({
    id: "limit-sell-2",
    symbol: "HYPEUSDT",
    side: "SELL",
    type: "LIMIT",
    quantity: "2",
    price: "30",
    amountAsset: "HYPE",
    quoteNotional: "60",
  }),
  Object.freeze({
    id: "market-buy-1",
    symbol: "HYPEUSDT",
    side: "BUY",
    type: "MARKET",
    quoteQuantity: "1",
    amountAsset: "USDT",
    quoteNotional: "1",
  }),
  Object.freeze({
    id: "market-buy-2",
    symbol: "HYPEUSDT",
    side: "BUY",
    type: "MARKET",
    quoteQuantity: "2",
    amountAsset: "USDT",
    quoteNotional: "2",
  }),
  Object.freeze({
    id: "market-sell-1",
    symbol: "HYPEUSDT",
    side: "SELL",
    type: "MARKET",
    quoteQuantity: "1",
    amountAsset: "USDT",
    quoteNotional: "1",
  }),
  Object.freeze({
    id: "market-sell-2",
    symbol: "HYPEUSDT",
    side: "SELL",
    type: "MARKET",
    quoteQuantity: "2",
    amountAsset: "USDT",
    quoteNotional: "2",
  }),
])

export const BITUNIX_ORDER_PROBE_IDS = Object.freeze(
  ORDER_PROBES.map(({ id }) => id),
)

/**
 * Return one immutable, reviewed LIVE probe definition.
 *
 * @param {{probeId: string}} input
 * @returns {Readonly<object>} Probe definition.
 * @throws {TypeError} When the probe identifier is invalid or unsupported.
 */
export function getBitunixOrderProbe({ probeId } = {}) {
  if (typeof probeId !== "string" || !probeId.trim()) {
    throw new TypeError("Bitunix order probe id must be a non-empty string")
  }
  const probe = ORDER_PROBES.find(({ id }) => id === probeId)
  if (!probe) {
    throw new TypeError(`Unsupported Bitunix order probe: ${probeId}`)
  }
  return probe
}

/**
 * Convert a reviewed probe into the exchange-neutral Broker.createOrder() input.
 *
 * @param {{probeId: string}} input
 * @returns {Readonly<object>} Common Broker order input.
 */
export function createBitunixOrderProbeInput({ probeId } = {}) {
  const probe = getBitunixOrderProbe({
    probeId,
  })
  return Object.freeze({
    symbol: probe.symbol,
    side: probe.side,
    type: probe.type,
    ...(probe.quantity === undefined ? {} : { quantity: probe.quantity }),
    ...(probe.quoteQuantity === undefined ? {} : { quoteQuantity: probe.quoteQuantity }),
    ...(probe.price === undefined ? {} : { price: probe.price }),
  })
}
