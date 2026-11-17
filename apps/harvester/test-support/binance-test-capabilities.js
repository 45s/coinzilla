export const TEST_BINANCE_CAPABILITIES = Object.freeze({
  contractVersion: 1,
  provider: "binance",
  marketData: Object.freeze({
    priceStream: Object.freeze({ status: "supported" }),
    bookTickerStream: Object.freeze({ status: "supported" }),
    candleHistory: Object.freeze({ status: "supported" }),
    candleStream: Object.freeze({ status: "supported" }),
  }),
  account: Object.freeze({
    snapshot: Object.freeze({ status: "supported" }),
  }),
  orders: Object.freeze({
    openOrders: Object.freeze({ status: "supported" }),
    placement: Object.freeze({ status: "environment-dependent" }),
    cancellation: Object.freeze({ status: "environment-dependent" }),
  }),
  fills: Object.freeze({
    canonicalHistory: Object.freeze({ status: "supported" }),
    executionUpdates: Object.freeze({ status: "supported" }),
  }),
  userData: Object.freeze({
    stream: Object.freeze({ status: "supported" }),
  }),
  recovery: Object.freeze({
    sameProcess: Object.freeze({ status: "supported" }),
  }),
})
