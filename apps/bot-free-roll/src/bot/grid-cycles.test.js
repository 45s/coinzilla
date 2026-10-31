import test from "node:test"
import assert from "node:assert/strict"

import {
  appendGridCycleSellOrder,
  closeGridCycleSellOrder,
  completeGridCycle,
  createGridCycle,
  projectGridCycles,
  recordGridCycleSellFill,
} from "./grid-cycles.js"

function createCycle(overrides = {}) {
  const result = createGridCycle({
    cycleId: "cycle-1",
    symbol: "DOGEFDUSD",
    buyOrderId: "buy-1",
    buyFillIds: ["buy-trade-1"],
    acquiredQuantity: "100",
    recoveryCost: "10",
    ...overrides,
  })
  assert.equal(result.ok, true, result.errors?.map((error) => error.message ?? error).join(", "))
  return result.data
}

function addSell(cycle, overrides = {}) {
  const result = appendGridCycleSellOrder({
    cycle,
    orderId: "sell-1",
    quantity: "99",
    reservedQuantity: "99",
    ...overrides,
  })
  assert.equal(result.ok, true, result.errors?.map((error) => error.message ?? error).join(", "))
  return result.data
}

function fillSell(cycle, overrides = {}) {
  const result = recordGridCycleSellFill({
    cycle,
    fill: {
      id: "sell-trade-1",
      orderId: "sell-1",
      side: "SELL",
      quantity: "99",
      ...overrides.fill,
    },
    accounting: {
      baseQuantity: "99",
      quoteQuantity: "10.02",
      ...overrides.accounting,
    },
  })
  assert.equal(result.ok, true, result.errors?.map((error) => error.message ?? error).join(", "))
  return result.data
}

test("creates one immutable cycle from a fully reconciled BUY", () => {
  const cycle = createCycle()

  assert.equal(cycle.id, "cycle-1")
  assert.equal(cycle.buyOrderId, "buy-1")
  assert.deepEqual(cycle.buyFillIds, ["buy-trade-1"])
  assert.equal(cycle.acquiredQuantity, "100")
  assert.equal(cycle.remainingQuantity, "100")
  assert.equal(cycle.recoveryCost, "10")
  assert.equal(cycle.status, "OPEN")
  assert.equal(Object.isFrozen(cycle), true)
  assert.equal(Object.isFrozen(cycle.buyFillIds), true)
})

test("rejects missing identity, empty fill history, duplicate fills, and invalid amounts", () => {
  const invalid = [
    { cycleId: "", symbol: "DOGEFDUSD", buyOrderId: "buy-1", buyFillIds: ["t1"], acquiredQuantity: "1", recoveryCost: "1" },
    { cycleId: "c1", symbol: "", buyOrderId: "buy-1", buyFillIds: ["t1"], acquiredQuantity: "1", recoveryCost: "1" },
    { cycleId: "c1", symbol: "DOGEFDUSD", buyOrderId: "buy-1", buyFillIds: [], acquiredQuantity: "1", recoveryCost: "1" },
    { cycleId: "c1", symbol: "DOGEFDUSD", buyOrderId: "buy-1", buyFillIds: ["t1", "t1"], acquiredQuantity: "1", recoveryCost: "1" },
    { cycleId: "c1", symbol: "DOGEFDUSD", buyOrderId: "buy-1", buyFillIds: ["t1"], acquiredQuantity: "0", recoveryCost: "1" },
    { cycleId: "c1", symbol: "DOGEFDUSD", buyOrderId: "buy-1", buyFillIds: ["t1"], acquiredQuantity: "1", recoveryCost: "-1" },
    { cycleId: "c1", symbol: "DOGEFDUSD", buyOrderId: "buy-1", buyFillIds: ["t1"], acquiredQuantity: 1, recoveryCost: "1" },
  ]

  for (const input of invalid) assert.equal(createGridCycle(input).ok, false)
})

test("adds one SELL order with an explicit inventory reservation", () => {
  const cycle = createCycle()
  const next = addSell(cycle)

  assert.equal(cycle.sellOrders.length, 0)
  assert.equal(next.sellOrders.length, 1)
  assert.equal(next.sellOrders[0].id, "sell-1")
  assert.equal(next.sellOrders[0].reservedQuantity, "99")
  assert.equal(next.currentSellOrderId, "sell-1")
  assert.equal(Object.isFrozen(next.sellOrders), true)
  assert.equal(Object.isFrozen(next.sellOrders[0]), true)
})

test("rejects overlapping live SELL orders, duplicate IDs, and unsafe reservations", () => {
  const cycle = addSell(createCycle())

  for (const input of [
    { orderId: "sell-2", quantity: "1", reservedQuantity: "1" },
    { orderId: "sell-1", quantity: "1", reservedQuantity: "1" },
    { orderId: "sell-2", quantity: "99", reservedQuantity: "98" },
    { orderId: "sell-2", quantity: "99", reservedQuantity: "101" },
    { orderId: "sell-2", quantity: "0", reservedQuantity: "0" },
  ]) {
    assert.equal(appendGridCycleSellOrder({ cycle, ...input }).ok, false)
  }
})

test("records a partial SELL fill using actual base debit and net quote proceeds", () => {
  const cycle = addSell(createCycle(), { quantity: "99", reservedQuantity: "99.1" })
  const result = recordGridCycleSellFill({
    cycle,
    fill: { id: "sell-trade-1", orderId: "sell-1", side: "SELL", quantity: "50" },
    accounting: { baseQuantity: "50.05", quoteQuantity: "5.2" },
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.remainingQuantity, "49.95")
  assert.equal(result.data.soldBaseQuantity, "50.05")
  assert.equal(result.data.saleProceeds, "5.2")
  assert.equal(result.data.sellOrders[0].filledQuantity, "50")
  assert.equal(result.data.sellOrders[0].reservedQuantity, "49.05")
  assert.equal(result.data.sellOrders[0].status, "PARTIALLY_FILLED")
  assert.equal(result.data.currentSellOrderId, "sell-1")
})

test("replays an identical SELL fill idempotently and rejects conflicting reuse", () => {
  const cycle = fillSell(addSell(createCycle()))
  const repeated = recordGridCycleSellFill({
    cycle,
    fill: { id: "sell-trade-1", orderId: "sell-1", side: "SELL", quantity: "99" },
    accounting: { baseQuantity: "99", quoteQuantity: "10.02" },
  })
  const conflict = recordGridCycleSellFill({
    cycle,
    fill: { id: "sell-trade-1", orderId: "sell-1", side: "SELL", quantity: "98" },
    accounting: { baseQuantity: "98", quoteQuantity: "10.02" },
  })

  assert.equal(repeated.ok, true)
  assert.equal(repeated.duplicate, true)
  assert.strictEqual(repeated.data, cycle)
  assert.equal(conflict.ok, false)
})

test("rejects fills for unknown orders, non-SELL fills, overfills, and excess base debits", () => {
  const cycle = addSell(createCycle())
  const cases = [
    { fill: { id: "t1", orderId: "other", side: "SELL", quantity: "1" }, accounting: { baseQuantity: "1", quoteQuantity: "1" } },
    { fill: { id: "t1", orderId: "sell-1", side: "BUY", quantity: "1" }, accounting: { baseQuantity: "1", quoteQuantity: "1" } },
    { fill: { id: "t1", orderId: "sell-1", side: "SELL", quantity: "100" }, accounting: { baseQuantity: "100", quoteQuantity: "1" } },
    { fill: { id: "t1", orderId: "sell-1", side: "SELL", quantity: "1" }, accounting: { baseQuantity: "100", quoteQuantity: "1" } },
  ]

  for (const input of cases) {
    assert.equal(recordGridCycleSellFill({ cycle, ...input }).ok, false)
  }
})

test("closes a canceled SELL only after reconciliation and preserves its accounting", () => {
  const partiallyFilled = recordGridCycleSellFill({
    cycle: addSell(createCycle(), { quantity: "99", reservedQuantity: "99.1" }),
    fill: { id: "trade-1", orderId: "sell-1", side: "SELL", quantity: "50" },
    accounting: { baseQuantity: "50.05", quoteQuantity: "5.2" },
  })
  const unsafe = closeGridCycleSellOrder({
    cycle: partiallyFilled.data,
    orderId: "sell-1",
    status: "CANCELED",
    reconciled: false,
  })
  const closed = closeGridCycleSellOrder({
    cycle: partiallyFilled.data,
    orderId: "sell-1",
    status: "CANCELED",
    reconciled: true,
  })

  assert.equal(unsafe.ok, false)
  assert.equal(closed.ok, true)
  assert.equal(closed.data.currentSellOrderId, null)
  assert.equal(closed.data.sellOrders[0].status, "CANCELED")
  assert.equal(closed.data.sellOrders[0].reservedQuantity, "0")
  assert.equal(closed.data.remainingQuantity, "49.95")
  assert.equal(closed.data.saleProceeds, "5.2")
})

test("completes a cycle only after terminal SELLs, net profit, and keep allocation are proven", () => {
  const filled = fillSell(addSell(createCycle()))
  const completed = completeGridCycle({
    cycle: filled,
    keepQuantity: "1",
    minProfit: "0.01",
  })

  assert.equal(completed.ok, true)
  assert.equal(completed.data.status, "COMPLETED")
  assert.equal(completed.data.freeQuantityAllocated, "1")
  assert.equal(completed.data.remainingQuantity, "0")
  assert.equal(completed.data.residualQuantity, "0")
  assert.equal(completed.data.realizedProfit, "0.02")
})

test("keeps residual inventory separate from the exact free allocation", () => {
  const cycle = createCycle({ acquiredQuantity: "101" })
  const sold = fillSell(addSell(cycle))
  const completed = completeGridCycle({
    cycle: sold,
    keepQuantity: "1",
    minProfit: "0.01",
  })

  assert.equal(completed.ok, true)
  assert.equal(completed.data.freeQuantityAllocated, "1")
  assert.equal(completed.data.residualQuantity, "1")
  assert.equal(completed.data.remainingQuantity, "0")
})

test("does not complete cycles with live orders, insufficient profit, or insufficient keep inventory", () => {
  const open = addSell(createCycle())
  const filled = fillSell(open)
  const belowProfit = completeGridCycle({
    cycle: { ...filled, saleProceeds: "10" },
    keepQuantity: "1",
    minProfit: "0.01",
  })
  const insufficientKeep = completeGridCycle({
    cycle: { ...filled, remainingQuantity: "0.5" },
    keepQuantity: "1",
    minProfit: "0.01",
  })

  assert.equal(completeGridCycle({ cycle: open, keepQuantity: "1", minProfit: "0.01" }).ok, false)
  assert.equal(belowProfit.ok, false)
  assert.equal(insufficientKeep.ok, false)
})

test("projects pair totals from independent cycles without mutating them", () => {
  const first = completeGridCycle({
    cycle: fillSell(addSell(createCycle())),
    keepQuantity: "1",
    minProfit: "0.01",
  }).data
  const second = createCycle({
    cycleId: "cycle-2",
    buyOrderId: "buy-2",
    buyFillIds: ["buy-trade-2"],
    acquiredQuantity: "100",
    recoveryCost: "9.9",
  })
  const secondWithSell = addSell(second, {
    orderId: "sell-2",
    quantity: "99",
    reservedQuantity: "99",
  })
  const projected = projectGridCycles({ cycles: [first, secondWithSell] })

  assert.equal(projected.ok, true)
  assert.deepEqual(projected.data, {
    symbol: "DOGEFDUSD",
    activeQuantity: "100",
    freeQuantity: "1",
    reservedQuantity: "99",
    recoveryCost: "9.9",
    saleProceeds: "0",
    realizedProfit: "0.02",
    residualQuantity: "0",
    openCycles: 1,
    completedCycles: 1,
  })
})

test("cycle projections are independent of input ordering", () => {
  const first = createCycle()
  const second = createCycle({
    cycleId: "cycle-2",
    buyOrderId: "buy-2",
    buyFillIds: ["buy-trade-2"],
    acquiredQuantity: "10",
    recoveryCost: "1",
  })

  assert.deepEqual(
    projectGridCycles({ cycles: [first, second] }),
    projectGridCycles({ cycles: [second, first] }),
  )
})

test("rejects duplicate cycle IDs and mixed-symbol pair projections", () => {
  const cycle = createCycle()

  assert.equal(projectGridCycles({ cycles: [cycle, cycle] }).ok, false)
  assert.equal(projectGridCycles({
    cycles: [cycle, createCycle({ cycleId: "cycle-2", symbol: "BTCUSDT" })],
  }).ok, false)
  assert.equal(projectGridCycles({ cycles: null }).ok, false)
})
