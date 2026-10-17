export const adaptAggTrades = (m) => ({
  eventType: m.e,
  eventTime: m.E,
  timestamp: m.T,
  symbol: m.s,
  price: m.p,
  quantity: m.q,
  isBuyerMaker: m.m,
  wasBestPrice: m.M,
  aggId: m.a,
  firstId: m.f,
  lastId: m.l,
})
