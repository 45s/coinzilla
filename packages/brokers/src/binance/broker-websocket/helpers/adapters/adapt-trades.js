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
