import test from "node:test"
import assert from "node:assert/strict"
import {
  Asset,
  CanonicalOrder,
  Fill,
  Market,
  Money,
  Quantity,
} from "@coinzilla/entities"
import { OrderRegistry } from "../src/domain/orders/order-registry.js"
import {
  createCanonicalFill,
  createCanonicalOrder,
  reconcileOfflineOwnedOrders,
} from "./recovery-market-evidence.js"

const baseAsset = new Asset({ id: "binance:LINK", code: "LINK" })
const quoteAsset = new Asset({ id: "binance:USDT", code: "USDT" })
const feeAsset = new Asset({ id: "binance:BNB", code: "BNB" })
const market = new Market({
  venue: "BINANCE",
  symbol: "LINKUSDT",
  baseAsset,
  quoteAsset,
})
const marketsBySymbol = new Map([[market.symbol, market]])
const assetsByLookup = {
  require({ id, code, field }) {
    const asset = new Map([
      [baseAsset.id, baseAsset],
      [quoteAsset.id, quoteAsset],
      [feeAsset.id, feeAsset],
    ]).get(id)
    if (!asset || asset.code !== code) {
      throw new Error(field + " has no matching canonical asset ID/code")
    }
    return asset
  },
}

const orderEvidence = {
  clientOrderId: "h-LINKUSDT-001",
  brokerOrderId: "broker-001",
  symbol: "LINKUSDT",
  side: "BUY",
  type: "LIMIT_MAKER",
  status: "NEW",
  price: "10",
  originalQuantity: "1",
  executedQuantity: "0",
}

test("offline canonical order mapper normalizes NEW and preserves exact intent", () => {
  const order = createCanonicalOrder({
    input: orderEvidence,
    marketsBySymbol,
  })

  assert.ok(order instanceof CanonicalOrder)
  assert.equal(order.status, "OPEN")
  assert.equal(order.market.id, market.id)
  assert.equal(order.limitPrice.amount, "10")
  assert.equal(order.originalQuantity.amount, "1")
  assert.equal(order.executedQuantity.amount, "0")
})

test("offline owned-order reconciliation updates only an exact recovered client identity", () => {
  const unknownOrder = new CanonicalOrder({
    ...{
      clientOrderId: orderEvidence.clientOrderId,
      brokerOrderId: orderEvidence.brokerOrderId,
      market,
      side: "BUY",
      type: "LIMIT_MAKER",
      limitPrice: new Money({ amount: "10", asset: quoteAsset }),
      originalQuantity: new Quantity({ amount: "1", asset: baseAsset }),
      executedQuantity: new Quantity({ amount: "0", asset: baseAsset }),
      status: "UNKNOWN",
    },
  })
  const recoveredState = {
    portfolio: {},
    journalFills: [],
    orderRegistry: new OrderRegistry({ orders: [unknownOrder] }),
  }
  const result = reconcileOfflineOwnedOrders({
    recoveredState,
    orderHistory: [orderEvidence],
    marketsBySymbol,
  })

  assert.equal(result.reconciledOrders, 1)
  assert.equal(result.orderRegistry.getOrder({ clientOrderId: orderEvidence.clientOrderId }).status, "OPEN")
  assert.equal(recoveredState.orderRegistry.getOrder({ clientOrderId: orderEvidence.clientOrderId }).status, "UNKNOWN")
})

test("offline owned-order reconciliation rejects missing, extra and duplicate ownership evidence", () => {
  const emptyState = {
    portfolio: {},
    journalFills: [],
    orderRegistry: new OrderRegistry(),
  }

  assert.throws(
    () => reconcileOfflineOwnedOrders({
      recoveredState: emptyState,
      orderHistory: [orderEvidence],
      marketsBySymbol,
    }),
    /not owned by the recovered Journal projection/i,
  )
  assert.throws(
    () => reconcileOfflineOwnedOrders({
      recoveredState: {
        ...emptyState,
        orderRegistry: new OrderRegistry({
          orders: [new CanonicalOrder({
            clientOrderId: orderEvidence.clientOrderId,
            brokerOrderId: orderEvidence.brokerOrderId,
            market,
            side: "BUY",
            type: "LIMIT_MAKER",
            limitPrice: new Money({ amount: "10", asset: quoteAsset }),
            originalQuantity: new Quantity({ amount: "1", asset: baseAsset }),
            executedQuantity: new Quantity({ amount: "0", asset: baseAsset }),
            status: "UNKNOWN",
          })],
        }),
      },
      orderHistory: [],
      marketsBySymbol,
    }),
    /missing recovered owned order/i,
  )
  assert.throws(
    () => reconcileOfflineOwnedOrders({
      recoveredState: emptyState,
      orderHistory: [orderEvidence, orderEvidence],
      marketsBySymbol,
    }),
    /duplicate clientOrderId/i,
  )
})

test("offline owned-order reconciliation rejects unresolved and mismatched order evidence", () => {
  const unknownEvidence = { ...orderEvidence, status: "UNKNOWN" }
  const makeState = () => ({
    portfolio: {},
    journalFills: [],
    orderRegistry: new OrderRegistry({
      orders: [new CanonicalOrder({
        clientOrderId: orderEvidence.clientOrderId,
        brokerOrderId: orderEvidence.brokerOrderId,
        market,
        side: "BUY",
        type: "LIMIT_MAKER",
        limitPrice: new Money({ amount: "10", asset: quoteAsset }),
        originalQuantity: new Quantity({ amount: "1", asset: baseAsset }),
        executedQuantity: new Quantity({ amount: "0", asset: baseAsset }),
        status: "UNKNOWN",
      })],
    }),
  })

  assert.throws(
    () => reconcileOfflineOwnedOrders({
      recoveredState: makeState(),
      orderHistory: [unknownEvidence],
      marketsBySymbol,
    }),
    /leaves an owned order unresolved/i,
  )
  assert.throws(
    () => reconcileOfflineOwnedOrders({
      recoveredState: makeState(),
      orderHistory: [{ ...orderEvidence, side: "SELL" }],
      marketsBySymbol,
    }),
    /immutable order intent/i,
  )
})

test("offline canonical fill mapper preserves third-asset commission amount and quote valuation", () => {
  const fill = createCanonicalFill({
    input: {
      tradeId: "trade-001",
      brokerOrderId: "broker-001",
      clientOrderId: orderEvidence.clientOrderId,
      symbol: "LINKUSDT",
      side: "BUY",
      price: "10",
      quantity: "1",
      quoteQuantity: "10",
      liquidityRole: "MAKER",
      executedAt: 150,
      commissionStatus: "COMPLETE",
      commissions: [{
        assetId: feeAsset.id,
        asset: feeAsset.code,
        amount: "0.01",
        quoteValue: {
          assetId: quoteAsset.id,
          asset: quoteAsset.code,
          amount: "0.2",
        },
      }],
    },
    marketsBySymbol,
    assetsByLookup,
  })

  assert.ok(fill instanceof Fill)
  assert.equal(fill.id, "binance:LINKUSDT:trade-001")
  assert.equal(fill.commissions[0].amount.amount, "0.01")
  assert.equal(fill.commissions[0].amount.asset.id, feeAsset.id)
  assert.equal(fill.commissions[0].quoteValue.amount, "0.2")
  assert.equal(fill.commissions[0].quoteValue.asset.id, quoteAsset.id)
})

test("offline canonical fill mapper rejects unknown commission assets and malformed exact amounts", () => {
  const input = {
    tradeId: "trade-002",
    brokerOrderId: "broker-002",
    symbol: "LINKUSDT",
    side: "BUY",
    price: "10",
    quantity: "1",
    quoteQuantity: "10",
    commissionStatus: "COMPLETE",
    commissions: [{
      assetId: "binance:UNKNOWN",
      asset: "UNKNOWN",
      amount: "0.01",
    }],
  }
  assert.throws(
    () => createCanonicalFill({ input, marketsBySymbol, assetsByLookup }),
    /no matching canonical asset/i,
  )
  assert.throws(
    () => createCanonicalFill({
      input: { ...input, commissions: [], price: "1e-3" },
      marketsBySymbol,
      assetsByLookup,
    }),
    /exact decimal string/i,
  )
})
