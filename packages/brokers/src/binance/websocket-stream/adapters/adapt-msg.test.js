import assert from 'node:assert'
import { describe, it } from 'node:test'
import { adaptMsg as adapt } from './adapt-msg.js'

const mockedExecutionReport = {
  e: 'executionReport',
  E: 1728174911074,
  s: 'ZKFDUSD',
  c: 'and_a2c05f9d6e234891951e60c4341c5101',
  S: 'BUY',
  o: 'LIMIT',
  f: 'GTC',
  q: '415.00000000',
  p: '0.11600000',
  P: '0.00000000',
  F: '0.00000000',
  g: -1,
  C: 'and_56c250ef42d2430bb924e3e56db443c8',
  x: 'CANCELED',
  X: 'CANCELED',
  r: 'NONE',
  i: 15895182,
  l: '0.00000000',
  z: '0.00000000',
  L: '0.00000000',
  n: '0',
  N: null,
  T: 1728174911074,
  t: -1,
  I: 32143036,
  w: false,
  m: false,
  M: false,
  O: 1728148308978,
  Z: '0.00000000',
  Y: '0.00000000',
  Q: '0.00000000',
  W: 1728148308978,
  V: 'EXPIRE_MAKER',
}

const mockedOutboundAccountPosition = {
  e: 'outboundAccountPosition',
  E: 1728174911074,
  u: 1728174911074,
  B: [
    { a: 'BNB', f: '0.00000000', l: '0.00000000' },
    { a: 'FDUSD', f: '48.14000000', l: '397.20000000' },
    { a: 'ZK', f: '0.00000000', l: '0.00000000' },
  ],
}

describe(`binance/websocket/${adapt.name}`, () => {
  it('should adapt "executionReport"', () => {
    const r = adapt(mockedExecutionReport)
    assert.deepStrictEqual(r, {
      eventType: 'executionReport',
      executionType: 'CANCELED',
      executedOrder: {
        id: '15895182',
        symbol: 'ZKFDUSD',
        type: 'LIMIT',
        side: 'BUY',
        quantity: '415.00000000',
        price: '0.11600000',
        status: 'CANCELED',
        clientOrderId: 'and_a2c05f9d6e234891951e60c4341c5101',
      },
    })
  })


  it('preserves exact per-trade quantity, quote value, commission, and liquidity role', () => {
    const r = adapt({
      ...mockedExecutionReport,
      x: 'TRADE',
      X: 'PARTIALLY_FILLED',
      l: '12.34000000',
      z: '12.34000000',
      L: '0.05000000',
      n: '0.00925500',
      N: 'DOGE',
      t: 12345,
      m: true,
      Y: '0.61700000',
    })

    assert.deepStrictEqual(r.fill, {
      id: '12345',
      orderId: '15895182',
      symbol: 'ZKFDUSD',
      side: 'BUY',
      price: '0.05000000',
      quantity: '12.34000000',
      quoteQuantity: '0.61700000',
      commissionAmount: '0.00925500',
      commissionAsset: 'DOGE',
      isMaker: true,
      time: 1728174911074,
    })
    assert.equal(r.executionType, 'TRADE')
  })

  it('should adapt "outboundAccountPosition"', () => {
    const r = adapt(mockedOutboundAccountPosition)
    assert.deepStrictEqual(r, {
      balances: [
        { asset: 'BNB', free: '0.00000000', locked: '0.00000000' },
        { asset: 'FDUSD', free: '48.14000000', locked: '397.20000000' },
        { asset: 'ZK', free: '0.00000000', locked: '0.00000000' },
      ],
      eventTime: 1728174911074,
      eventType: 'outboundAccountPosition',
      lastAccountUpdate: 1728174911074,
    })
  })

  it("adapts aggregate trade messages", () => {
    assert.deepStrictEqual(adapt({
      e: "aggTrade", E: 100, T: 99, s: "BTCUSDT", p: "65000.10", q: "0.25",
      m: true, M: false, a: 123, f: 120, l: 124,
    }), {
      eventType: "aggTrade", eventTime: 100, timestamp: 99, symbol: "BTCUSDT",
      price: "65000.10", quantity: "0.25", isBuyerMaker: true,
      wasBestPrice: false, aggId: 123, firstId: 120, lastId: 124,
    })
  })

  it("adapts balance updates", () => {
    assert.deepStrictEqual(adapt({
      e: "balanceUpdate", a: "USDT", d: "12.50", T: 200, E: 201,
    }), {
      asset: "USDT", balanceDelta: "12.50", clearTime: 200,
      eventTime: 201, eventType: "balanceUpdate",
    })
  })

  it("adapts account information and indexes balances by asset", () => {
    assert.deepStrictEqual(adapt({
      e: "account", E: 10, m: 1, t: 2, b: 3, s: 4, T: true, W: false,
      D: true, u: 9, B: [{ a: "BTC", f: "0.5", l: "0.1" }, { a: "USDT", f: "10", l: "2" }],
    }), {
      eventType: "account", eventTime: 10, makerCommissionRate: 1,
      takerCommissionRate: 2, buyerCommissionRate: 3, sellerCommissionRate: 4,
      canTrade: true, canWithdraw: false, canDeposit: true, lastAccountUpdate: 9,
      balances: { BTC: { available: "0.5", locked: "0.1" }, USDT: { available: "10", locked: "2" } },
    })
  })

  it("adapts order-list status and nested orders", () => {
    assert.deepStrictEqual(adapt({
      e: "listStatus", E: 1, s: "BTCUSDT", g: 22, c: "OCO", l: "EXEC_STARTED",
      L: "EXECUTING", r: "NONE", C: "client-list", T: 2,
      O: [{ s: "BTCUSDT", i: 11, c: "client-buy" }, { s: "BTCUSDT", i: 12, c: "client-sell" }],
    }), {
      eventType: "listStatus", eventTime: 1, symbol: "BTCUSDT", orderListId: 22,
      contingencyType: "OCO", listStatusType: "EXEC_STARTED", listOrderStatus: "EXECUTING",
      listRejectReason: "NONE", listClientOrderId: "client-list", transactionTime: 2,
      orders: [
        { symbol: "BTCUSDT", orderId: 11, clientOrderId: "client-buy" },
        { symbol: "BTCUSDT", orderId: 12, clientOrderId: "client-sell" },
      ],
    })
  })

  it("returns unknown messages unchanged", () => {
    const message = { e: "newFutureEvent", payload: { value: 1 } }
    assert.strictEqual(adapt(message), message)
  })
})
