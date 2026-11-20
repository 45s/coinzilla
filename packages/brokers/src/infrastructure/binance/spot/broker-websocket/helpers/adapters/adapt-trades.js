/**
 * Normalize a Binance aggregate-trade stream event.
 *
 * @param {object} message - Raw aggTrade event.
 * @returns {{eventType: string, eventTime: number, timestamp: number, symbol: string, price: string, quantity: string, isBuyerMaker: boolean, wasBestPrice: boolean, aggId: number, firstId: number, lastId: number}}
 */
export const adaptAggTrades = (message) => ({
  eventType: message.e,
  eventTime: message.E,
  timestamp: message.T,
  symbol: message.s,
  price: message.p,
  quantity: message.q,
  isBuyerMaker: message.m,
  wasBestPrice: message.M,
  aggId: message.a,
  firstId: message.f,
  lastId: message.l,
})
