import test from "node:test"
import assert from "node:assert/strict"

import { appendGridCycleSellOrder, createGridCycle } from "./grid-cycles.js"
import { buildGridOrderIndex, reconcileGridOpenOrders, resolveGridOrderOwner } from "./grid-order-mapping.js"

function createCycle({ buyOrderId = "buy-1", symbol = "DOGEFDUSD" } = {}) {
  const result = createGridCycle({
    symbol,
    baseAsset: "DOGE",
    quoteAsset: "FDUSD",
    buyOrderId,
    buyOrder: {
      id: buyOrderId,
      clientOrderId: `client-${buyOrderId}`,
      symbol,
      side: "BUY",
      type: "LIMIT_MAKER",
      quantity: "100",
      price: "0.1",
    },
    buyFillIds: [`trade-${buyOrderId}`],
    acquiredQuantity: "100",
    recoveryCost: "10",
  })
  assert.equal(result.ok, true)
  return result.data
}

function addSell(cycle, { orderId = "sell-1", clientOrderId = `client-${orderId}` } = {}) {
  const result = appendGridCycleSellOrder({
    cycle,
    orderId,
    clientOrderId,
    type: "LIMIT_MAKER",
    price: "0.102",
    quantity: "99",
    reservedQuantity: "99",
  })
  assert.equal(result.ok, true)
  return result.data
}

test("indexes each cycle BUY and every historical SELL attempt", () => {
  const first = addSell(createCycle())
  const second = addSell(createCycle({ buyOrderId: "buy-2" }), {
    orderId: "sell-2",
  })
  const result = buildGridOrderIndex({ cycles: [first, second] })

  assert.equal(result.ok, true)
  assert.equal(result.data.orders.length, 4)
  assert.equal(result.data.byOrderId["buy-1"].role, "BUY")
  assert.equal(result.data.byOrderId["sell-1"].cycleId, first.id)
  assert.equal(result.data.byOrderId["sell-2"].cycleId, second.id)
  assert.equal(result.data.byClientOrderId["client-sell-2"].orderId, "sell-2")
  assert.equal(Object.isFrozen(result.data.orders), true)
})

test("indexes the pending BUY separately from completed cycle orders", () => {
  const cycle = createCycle()
  const pendingBuyOrder = {
    id: "buy-pending",
    clientOrderId: "client-buy-pending",
    symbol: "DOGEFDUSD",
    side: "BUY",
    type: "LIMIT_MAKER",
    quantity: "100",
    price: "0.099",
    status: "NEW",
  }
  const result = buildGridOrderIndex({
    cycles: [cycle],
    pendingBuyOrder,
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.orders.length, 2)
  assert.equal(result.data.byOrderId["buy-pending"].role, "BUY")
  assert.equal(result.data.byOrderId["buy-pending"].cycleId, null)
  assert.equal(result.data.byClientOrderId["client-buy-pending"].symbol, "DOGEFDUSD")
  assert.equal(buildGridOrderIndex({
    cycles: [cycle],
    pendingBuyOrder: { ...pendingBuyOrder, symbol: "BTCUSDT" },
  }).ok, false)
})

test("resolves an order by either identity and validates both when supplied", () => {
  const cycle = addSell(createCycle())
  const index = buildGridOrderIndex({ cycles: [cycle] }).data

  const byOrder = resolveGridOrderOwner({
    orderIndex: index,
    orderId: "sell-1",
    symbol: "DOGEFDUSD",
    side: "SELL",
  })
  const byClient = resolveGridOrderOwner({
    orderIndex: index,
    clientOrderId: "client-sell-1",
  })
  const byBoth = resolveGridOrderOwner({
    orderIndex: index,
    orderId: "sell-1",
    clientOrderId: "client-sell-1",
  })

  assert.equal(byOrder.ok, true)
  assert.equal(byClient.ok, true)
  assert.equal(byBoth.ok, true)
  assert.equal(byBoth.data.owner.cycleId, cycle.id)
})

test("rejects unknown, conflicting, or mismatched order identities", () => {
  const cycle = addSell(createCycle())
  const other = addSell(createCycle({ buyOrderId: "buy-2" }), {
    orderId: "sell-2",
  })
  const index = buildGridOrderIndex({ cycles: [cycle, other] }).data

  assert.equal(resolveGridOrderOwner({ orderIndex: index, orderId: "unknown" }).ok, false)
  assert.equal(resolveGridOrderOwner({ orderIndex: index, clientOrderId: "unknown" }).ok, false)
  assert.equal(resolveGridOrderOwner({
    orderIndex: index,
    orderId: "sell-1",
    clientOrderId: "client-sell-2",
  }).ok, false)
  assert.equal(resolveGridOrderOwner({
    orderIndex: index,
    orderId: "sell-1",
    symbol: "BTCUSDT",
  }).ok, false)
  assert.equal(resolveGridOrderOwner({
    orderIndex: index,
    orderId: "sell-1",
    side: "BUY",
  }).ok, false)
  assert.equal(resolveGridOrderOwner({ orderIndex: index }).ok, false)
})

test("rejects invalid cycle collections before building an order index", () => {
  assert.equal(buildGridOrderIndex({ cycles: null }).ok, false)
  assert.equal(buildGridOrderIndex({ cycles: [createCycle(), createCycle()] }).ok, false)
})


test("reconciles multiple independent live SELL orders against exchange open orders", () => {
  const first = addSell(createCycle())
  const second = addSell(createCycle({ buyOrderId: "buy-2" }), {
    orderId: "sell-2",
  })
  const orderIndex = buildGridOrderIndex({ cycles: [first, second] }).data
  const result = reconcileGridOpenOrders({
    orderIndex,
    exchangeOpenOrders: [
      {
        id: "sell-1",
        clientOrderId: "client-sell-1",
        symbol: "DOGEFDUSD",
        side: "SELL",
        status: "NEW",
      },
      {
        id: "sell-2",
        clientOrderId: "client-sell-2",
        symbol: "DOGEFDUSD",
        side: "SELL",
        status: "PARTIALLY_FILLED",
      },
    ],
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.complete, true)
  assert.equal(result.data.matchedOrders.length, 2)
  assert.equal(result.data.missingOrders.length, 0)
})

test("returns missing persisted live orders for final history lookup without authorizing replacement", () => {
  const first = addSell(createCycle())
  const second = addSell(createCycle({ buyOrderId: "buy-2" }), {
    orderId: "sell-2",
  })
  const orderIndex = buildGridOrderIndex({ cycles: [first, second] }).data
  const result = reconcileGridOpenOrders({
    orderIndex,
    exchangeOpenOrders: [{
      id: "sell-1",
      clientOrderId: "client-sell-1",
      symbol: "DOGEFDUSD",
      side: "SELL",
      status: "NEW",
    }],
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.complete, false)
  assert.deepEqual(result.data.missingOrders.map((order) => order.orderId), ["sell-2"])
  assert.equal(result.data.missingOrders[0].cycleId, second.id)
})

test("fails closed on orphan, mismatched, or duplicate exchange open orders", () => {
  const cycle = addSell(createCycle())
  const orderIndex = buildGridOrderIndex({ cycles: [cycle] }).data
  const validOrder = {
    id: "sell-1",
    clientOrderId: "client-sell-1",
    symbol: "DOGEFDUSD",
    side: "SELL",
    status: "NEW",
  }

  assert.equal(reconcileGridOpenOrders({
    orderIndex,
    exchangeOpenOrders: [{ ...validOrder, id: "orphan-order", clientOrderId: "orphan-client" }],
  }).ok, false)
  assert.equal(reconcileGridOpenOrders({
    orderIndex,
    exchangeOpenOrders: [{ ...validOrder, side: "BUY" }],
  }).ok, false)
  assert.equal(reconcileGridOpenOrders({
    orderIndex,
    exchangeOpenOrders: [validOrder, validOrder],
  }).ok, false)
  assert.equal(reconcileGridOpenOrders({
    orderIndex,
    exchangeOpenOrders: [{ ...validOrder, status: "CANCELED" }],
  }).ok, false)
})

test("reports all persisted live orders missing when the exchange open-order list is empty", () => {
  const first = addSell(createCycle())
  const second = addSell(createCycle({ buyOrderId: "buy-2" }), {
    orderId: "sell-2",
  })
  const orderIndex = buildGridOrderIndex({ cycles: [first, second] }).data
  const result = reconcileGridOpenOrders({
    orderIndex,
    exchangeOpenOrders: [],
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.complete, false)
  assert.deepEqual(
    result.data.missingOrders.map((order) => order.orderId),
    ["sell-1", "sell-2"],
  )
})
