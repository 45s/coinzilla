import assert from "node:assert/strict"
import test from "node:test"

import { adaptUser } from "./user.js"

test("maps balance updates without converting exact decimal strings", () => {
  assert.deepEqual(adaptUser.balanceUpdate({
    a: "USDT",
    d: "-12.3400",
    T: 1_730_000_000_100,
    E: 1_730_000_000_200,
  }), {
    asset: "USDT",
    balanceDelta: "-12.3400",
    clearTime: 1_730_000_000_100,
    eventTime: 1_730_000_000_200,
    eventType: "balanceUpdate",
  })
})

test("maps legacy outbound account information and every balance", () => {
  assert.deepEqual(adaptUser.outboundAccountInfo({
    E: 101,
    m: 1,
    t: 2,
    b: 3,
    s: 4,
    T: true,
    W: false,
    D: true,
    u: 99,
    B: [
      { a: "BTC", f: "0.12500000", l: "0.01000000" },
      { a: "USDT", f: "20.50", l: "0" },
    ],
  }), {
    eventType: "account",
    eventTime: 101,
    makerCommissionRate: 1,
    takerCommissionRate: 2,
    buyerCommissionRate: 3,
    sellerCommissionRate: 4,
    canTrade: true,
    canWithdraw: false,
    canDeposit: true,
    lastAccountUpdate: 99,
    balances: {
      BTC: { available: "0.12500000", locked: "0.01000000" },
      USDT: { available: "20.50", locked: "0" },
    },
  })
  assert.deepEqual(adaptUser.outboundAccountInfo({ B: [] }).balances, {})
})

test("maps outbound account position as an ordered balance list", () => {
  assert.deepEqual(adaptUser.outboundAccountPosition({
    B: [
      { a: "ETH", f: "2.000", l: "0.25" },
      { a: "USDT", f: "0", l: "10.00" },
    ],
    E: 202,
    u: 201,
  }), {
    balances: [
      { asset: "ETH", free: "2.000", locked: "0.25" },
      { asset: "USDT", free: "0", locked: "10.00" },
    ],
    eventTime: 202,
    eventType: "outboundAccountPosition",
    lastAccountUpdate: 201,
  })
  assert.deepEqual(adaptUser.outboundAccountPosition({ B: [] }).balances, [])
})

test("maps the full Binance execution report without normalizing wire fields", () => {
  assert.deepEqual(adaptUser.executionReport({
    E: 1, s: "BTCUSDT", c: "new-client-id", C: "old-client-id",
    S: "BUY", o: "LIMIT", f: "GTC", q: "0.0100", p: "65000.00",
    x: "TRADE", P: "0", d: 5, F: "0", X: "PARTIALLY_FILLED",
    r: "NONE", i: 123, T: 2, l: "0.0040", z: "0.0040",
    L: "64999.50", n: "0.000004", N: "BTC", t: 456, w: true,
    m: true, O: 0, Z: "259.998", g: -1, Q: "650.00",
    Y: "259.998", D: -1,
  }), {
    eventType: "executionReport",
    eventTime: 1,
    symbol: "BTCUSDT",
    newClientOrderId: "new-client-id",
    originalClientOrderId: "old-client-id",
    side: "BUY",
    orderType: "LIMIT",
    timeInForce: "GTC",
    quantity: "0.0100",
    price: "65000.00",
    executionType: "TRADE",
    stopPrice: "0",
    trailingDelta: 5,
    icebergQuantity: "0",
    orderStatus: "PARTIALLY_FILLED",
    orderRejectReason: "NONE",
    orderId: 123,
    orderTime: 2,
    lastTradeQuantity: "0.0040",
    totalTradeQuantity: "0.0040",
    priceLastTrade: "64999.50",
    commission: "0.000004",
    commissionAsset: "BTC",
    tradeId: 456,
    isOrderWorking: true,
    isMaker: true,
    creationTime: 0,
    totalQuoteTradeQuantity: "259.998",
    orderListId: -1,
    quoteOrderQuantity: "650.00",
    lastQuoteTransacted: "259.998",
    trailingTime: -1,
  })
})

test("maps list status and each child order", () => {
  assert.deepEqual(adaptUser.listStatus({
    E: 301,
    s: "ETHUSDT",
    g: 77,
    c: "OCO",
    l: "EXEC_STARTED",
    L: "EXECUTING",
    r: "NONE",
    C: "list-client-id",
    T: 300,
    O: [
      { s: "ETHUSDT", i: 88, c: "take-profit" },
      { s: "ETHUSDT", i: 89, c: "stop-loss" },
    ],
  }), {
    eventType: "listStatus",
    eventTime: 301,
    symbol: "ETHUSDT",
    orderListId: 77,
    contingencyType: "OCO",
    listStatusType: "EXEC_STARTED",
    listOrderStatus: "EXECUTING",
    listRejectReason: "NONE",
    listClientOrderId: "list-client-id",
    transactionTime: 300,
    orders: [
      { symbol: "ETHUSDT", orderId: 88, clientOrderId: "take-profit" },
      { symbol: "ETHUSDT", orderId: 89, clientOrderId: "stop-loss" },
    ],
  })
  assert.deepEqual(adaptUser.listStatus({ O: [] }).orders, [])
})
