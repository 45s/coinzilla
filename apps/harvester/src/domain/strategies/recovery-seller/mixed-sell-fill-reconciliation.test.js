import test from "node:test"
import assert from "node:assert/strict"
import { Asset, CanonicalOrder, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { StrategyId } from "../strategy-ids.js"
import { createOrderOwnership } from "../../orders/order-ownership.js"
import { OrderRegistry } from "../../orders/order-registry.js"
import { createMixedSellFillAllocation } from "./mixed-sell-fill-allocation.js"
import {
  MixedSellFillReconciliationError,
  createMixedSellFillReconciliation,
  stageMixedSellFillAllocation,
} from "./mixed-sell-fill-reconciliation.js"

const baseAsset = new Asset({
  id: "binance:ZRO",
  code: "ZRO",
})
const quoteAsset = new Asset({
  id: "binance:USDT",
  code: "USDT",
})
const feeAsset = new Asset({
  id: "binance:BNB",
  code: "BNB",
})
const market = new Market({
  venue: "binance",
  symbol: "ZROUSDT",
  baseAsset,
  quoteAsset,
})

function makeFill({ tradeId = "trade-1", quantity = "5.01", quoteQuantity = "10.02" } = {}) {
  return new Fill({
    tradeId,
    brokerOrderId: "broker-1",
    clientOrderId: "harvester-rs-sell",
    market,
    side: "SELL",
    price: new Money({
      amount: "2",
      asset: quoteAsset,
    }),
    quantity: new Quantity({
      amount: quantity,
      asset: baseAsset,
    }),
    quoteQuantity: new Money({
      amount: quoteQuantity,
      asset: quoteAsset,
    }),
    liquidityRole: "MAKER",
    executedAt: 103,
    commissions: [
      new Commission({
        amount: new Money({
          amount: "0.005",
          asset: baseAsset,
        }),
      }),
      new Commission({
        amount: new Money({
          amount: "0.01",
          asset: quoteAsset,
        }),
      }),
      new Commission({
        amount: new Money({
          amount: "0.02",
          asset: feeAsset,
        }),
        quoteValue: new Money({
          amount: "0.05",
          asset: quoteAsset,
        }),
      }),
    ],
    commissionStatus: "COMPLETE",
  })
}

function makeOrder({ status = "OPEN", executedQuantity = "0", originalQuantity = "5.01" } = {}) {
  return new CanonicalOrder({
    clientOrderId: "harvester-rs-sell",
    brokerOrderId: "broker-1",
    market,
    side: "SELL",
    type: "LIMIT_MAKER",
    limitPrice: new Money({
      amount: "2",
      asset: quoteAsset,
    }),
    originalQuantity: new Quantity({
      amount: originalQuantity,
      asset: baseAsset,
    }),
    executedQuantity: new Quantity({
      amount: executedQuantity,
      asset: baseAsset,
    }),
    status,
    createdAt: 100,
    acknowledgedAt: 101,
    updatedAt: 102,
    ...(status === "OPEN" ? {} : {
      completedAt: 103,
    }),
  })
}

function makeOrderContext({ cycleId = "rs-cycle-1", status = "OPEN", executedQuantity = "0" } = {}) {
  const order = makeOrder({
    status,
    executedQuantity,
  })
  const ownership = createOrderOwnership({
    ownership: {
      strategyId: StrategyId.RECOVERY_SELLER,
      positionId: "rs-position-1",
      purpose: "RECOVERY_SELL",
      cycleId,
    },
    clientOrderId: order.clientOrderId,
    brokerOrderId: order.brokerOrderId,
  })
  return {
    order,
    orderRegistry: new OrderRegistry({
      orders: [order],
      ownerships: [ownership],
    }),
  }
}

function makeAllocation({ fill, orderRegistry, recoveryQuantity, legacyQuantity }) {
  return createMixedSellFillAllocation({
    fill,
    orderRegistry,
    recoveryQuantity,
    legacyQuantity,
  })
}

const hasCode = (expectedCode) => (error) => error instanceof MixedSellFillReconciliationError && error.code === expectedCode

test("creates an empty immutable reconciliation from registered Recovery Seller order ownership", () => {
  const { order, orderRegistry } = makeOrderContext()
  const state = createMixedSellFillReconciliation({
    order,
    orderRegistry,
  })
  assert.equal(state.status, "STAGING", "A new reconciliation must start in staging.")
  assert.equal(state.stagedQuantity, "0", "A new reconciliation must not assume unfilled order quantity has executed.")
  assert.equal(state.stagedFillCount, 0, "A new reconciliation must not invent execution records.")
  assert.equal(state.orderOwnership.cycleId, "rs-cycle-1", "Staging must retain the registered RS cycle identity.")
  assert.equal(state.order.originalQuantity, "5.01", "Staging must retain the canonical original order quantity.")
  assert.equal(Object.isFrozen(state), true, "Reconciliation snapshots must be immutable.")
})

test("stages multiple partial Fill allocations without mutating earlier snapshots", () => {
  const { order, orderRegistry } = makeOrderContext()
  const first = makeAllocation({
    fill: makeFill({
      quantity: "2.5",
      quoteQuantity: "5",
    }),
    orderRegistry,
    recoveryQuantity: "2.5",
    legacyQuantity: "0",
  })
  const second = makeAllocation({
    fill: makeFill({
      tradeId: "trade-2",
      quantity: "2.51",
      quoteQuantity: "5.02",
    }),
    orderRegistry,
    recoveryQuantity: "2.5",
    legacyQuantity: "0.01",
  })
  const initial = createMixedSellFillReconciliation({
    order,
    orderRegistry,
  })
  const one = stageMixedSellFillAllocation({
    reconciliation: initial,
    allocation: first,
  })
  const two = stageMixedSellFillAllocation({
    reconciliation: one.reconciliation,
    allocation: second,
  })
  assert.equal(one.applied, true, "The first partial Fill must be staged.")
  assert.equal(one.reconciliation.stagedQuantity, "2.5", "The first staged quantity must equal its canonical Fill.")
  assert.equal(two.applied, true, "A distinct second partial Fill must be staged.")
  assert.equal(two.reconciliation.stagedQuantity, "5.01", "Distinct partial quantities must aggregate exactly.")
  assert.equal(two.reconciliation.stagedFillCount, 2, "Both canonical allocations must be retained.")
  assert.equal(initial.stagedQuantity, "0", "A later stage must not mutate the initial snapshot.")
  assert.equal(one.reconciliation.stagedQuantity, "2.5", "A later stage must not mutate the earlier snapshot.")
  assert.equal(Object.isFrozen(two.reconciliation.allocations), true, "The allocation collection must be immutable.")
})

test("treats an identical staged Fill allocation as an exact no-op", () => {
  const { order, orderRegistry } = makeOrderContext()
  const fill = makeFill({
    quantity: "2.5",
    quoteQuantity: "5",
  })
  const allocation = makeAllocation({
    fill,
    orderRegistry,
    recoveryQuantity: "2.5",
    legacyQuantity: "0",
  })
  const first = stageMixedSellFillAllocation({
    reconciliation: createMixedSellFillReconciliation({
      order,
      orderRegistry,
    }),
    allocation,
  })
  const duplicate = stageMixedSellFillAllocation({
    reconciliation: first.reconciliation,
    allocation,
  })
  assert.equal(duplicate.reconciliation, first.reconciliation, "Identical replay must preserve the exact immutable state.")
  assert.equal(duplicate.applied, false, "Identical replay must not be applied twice.")
  assert.equal(duplicate.duplicate, true, "Identical replay must be explicitly classified.")
})

test("rejects a repeated Fill ID when its allocation split changes", () => {
  const { order, orderRegistry } = makeOrderContext()
  const fill = makeFill({
    quantity: "2.5",
    quoteQuantity: "5",
  })
  const first = makeAllocation({
    fill,
    orderRegistry,
    recoveryQuantity: "2.5",
    legacyQuantity: "0",
  })
  const conflict = makeAllocation({
    fill,
    orderRegistry,
    recoveryQuantity: "2.49",
    legacyQuantity: "0.01",
  })
  const state = stageMixedSellFillAllocation({
    reconciliation: createMixedSellFillReconciliation({
      order,
      orderRegistry,
    }),
    allocation: first,
  }).reconciliation
  assert.throws(
    () => stageMixedSellFillAllocation({
      reconciliation: state,
      allocation: conflict,
    }),
    (error) => hasCode("RS_MIXED_SELL_RECONCILIATION_ALLOCATION_CONFLICT")(error),
    "One canonical Fill ID cannot be staged with two different recovery/legacy splits.",
  )
})

test("rejects a staged allocation owned by another Recovery Seller cycle", () => {
  const firstContext = makeOrderContext()
  const otherContext = makeOrderContext({
    cycleId: "rs-cycle-2",
  })
  const first = makeAllocation({
    fill: makeFill({
      quantity: "2.5",
      quoteQuantity: "5",
    }),
    orderRegistry: firstContext.orderRegistry,
    recoveryQuantity: "2.5",
    legacyQuantity: "0",
  })
  const other = makeAllocation({
    fill: makeFill({
      tradeId: "trade-2",
      quantity: "2.5",
      quoteQuantity: "5",
    }),
    orderRegistry: otherContext.orderRegistry,
    recoveryQuantity: "2.5",
    legacyQuantity: "0",
  })
  const state = stageMixedSellFillAllocation({
    reconciliation: createMixedSellFillReconciliation(firstContext),
    allocation: first,
  }).reconciliation
  assert.throws(
    () => stageMixedSellFillAllocation({
      reconciliation: state,
      allocation: other,
    }),
    (error) => hasCode("RS_MIXED_SELL_RECONCILIATION_ORDER_OWNERSHIP_MISMATCH")(error),
    "A reconciliation must not mix fills from different RS cycles.",
  )
})

test("rejects aggregate staged quantity above the registered order quantity", () => {
  const { order, orderRegistry } = makeOrderContext()
  const first = makeAllocation({
    fill: makeFill({
      quantity: "2.5",
      quoteQuantity: "5",
    }),
    orderRegistry,
    recoveryQuantity: "2.5",
    legacyQuantity: "0",
  })
  const excess = makeAllocation({
    fill: makeFill({
      tradeId: "trade-2",
      quantity: "3",
      quoteQuantity: "6",
    }),
    orderRegistry,
    recoveryQuantity: "3",
    legacyQuantity: "0",
  })
  const state = stageMixedSellFillAllocation({
    reconciliation: createMixedSellFillReconciliation({
      order,
      orderRegistry,
    }),
    allocation: first,
  }).reconciliation
  assert.throws(
    () => stageMixedSellFillAllocation({
      reconciliation: state,
      allocation: excess,
    }),
    (error) => hasCode("RS_MIXED_SELL_RECONCILIATION_ORDER_QUANTITY_EXCEEDED")(error),
    "Staged distinct Fill quantity must not exceed registered original order quantity.",
  )
})

test("rejects an order without registered Recovery Seller ownership", () => {
  const order = makeOrder()
  const orderRegistry = new OrderRegistry({
    orders: [order],
    ownerships: [],
  })
  assert.throws(
    () => createMixedSellFillReconciliation({
      order,
      orderRegistry,
    }),
    (error) => hasCode("RS_MIXED_SELL_RECONCILIATION_ORDER_OWNERSHIP_MISMATCH")(error),
    "An unowned order must not receive Recovery Seller reconciliation state.",
  )
})


const terminalModule = await import("./mixed-sell-fill-reconciliation.js")
const reconcileMixedSellFillOrder = terminalModule.reconcileMixedSellFillOrder

if (typeof reconcileMixedSellFillOrder !== "function") {
  test("Recovery Seller exposes exact-once terminal mixed SELL reconciliation", () => {
    assert.equal(
      typeof reconcileMixedSellFillOrder,
      "function",
      "RS must reconcile complete canonical Fill history against the terminal broker order before accounting can commit.",
    )
  })
} else {
  test("reconciles a FILLED SELL only when complete canonical fills equal original order quantity", () => {
    const initial = makeOrderContext()
    const terminal = makeOrderContext({
      status: "FILLED",
      executedQuantity: "5.01",
    })
    const allocation = makeAllocation({
      fill: makeFill(),
      orderRegistry: terminal.orderRegistry,
      recoveryQuantity: "5.01",
      legacyQuantity: "0",
    })
    const staged = stageMixedSellFillAllocation({
      reconciliation: createMixedSellFillReconciliation(initial),
      allocation,
    }).reconciliation
    const result = reconcileMixedSellFillOrder({
      reconciliation: staged,
      terminalOrder: terminal.order,
      orderRegistry: terminal.orderRegistry,
      canonicalFillAllocations: [allocation],
    })
    assert.equal(result.reconciliation.status, "RECONCILED", "A fully reconciled terminal SELL must leave staging.")
    assert.equal(result.reconciliation.terminalOrderStatus, "FILLED", "The broker terminal status must be preserved.")
    assert.equal(result.reconciliation.terminalExecutedQuantity, "5.01", "The broker execution quantity must be preserved.")
    assert.equal(result.reconciliation.terminalFillCount, 1, "The complete canonical fill count must be preserved.")
    assert.equal(staged.status, "STAGING", "Terminal reconciliation must not mutate the earlier staging snapshot.")
  })

  test("reconciles a partially filled CANCELED SELL without treating it as fully filled", () => {
    const initial = makeOrderContext()
    const terminal = makeOrderContext({
      status: "CANCELED",
      executedQuantity: "2.5",
    })
    const allocation = makeAllocation({
      fill: makeFill({
        quantity: "2.5",
        quoteQuantity: "5",
      }),
      orderRegistry: terminal.orderRegistry,
      recoveryQuantity: "2.5",
      legacyQuantity: "0",
    })
    const staged = stageMixedSellFillAllocation({
      reconciliation: createMixedSellFillReconciliation(initial),
      allocation,
    }).reconciliation
    const result = reconcileMixedSellFillOrder({
      reconciliation: staged,
      terminalOrder: terminal.order,
      orderRegistry: terminal.orderRegistry,
      canonicalFillAllocations: [allocation],
    })
    assert.equal(result.reconciliation.status, "RECONCILED", "A canceled order can reconcile its confirmed partial fills.")
    assert.equal(result.reconciliation.terminalOrderStatus, "CANCELED", "Cancellation must not be mistaken for a filled order.")
    assert.equal(result.reconciliation.terminalExecutedQuantity, "2.5", "Only confirmed partial execution may be reconciled.")
  })

  test("rejects terminal reconciliation when canonical fill history is incomplete", () => {
    const initial = makeOrderContext()
    const terminal = makeOrderContext({
      status: "CANCELED",
      executedQuantity: "2.5",
    })
    const allocation = makeAllocation({
      fill: makeFill({
        quantity: "2.5",
        quoteQuantity: "5",
      }),
      orderRegistry: terminal.orderRegistry,
      recoveryQuantity: "2.5",
      legacyQuantity: "0",
    })
    const staged = stageMixedSellFillAllocation({
      reconciliation: createMixedSellFillReconciliation(initial),
      allocation,
    }).reconciliation
    assert.throws(
      () => reconcileMixedSellFillOrder({
        reconciliation: staged,
        terminalOrder: terminal.order,
        orderRegistry: terminal.orderRegistry,
        canonicalFillAllocations: [],
      }),
      hasCode("RS_MIXED_SELL_RECONCILIATION_FILL_HISTORY_MISMATCH"),
      "Every staged Fill must be present in the complete terminal canonical history.",
    )
  })

  test("rejects a terminal broker executed quantity that differs from distinct canonical fills", () => {
    const initial = makeOrderContext()
    const terminal = makeOrderContext({
      status: "CANCELED",
      executedQuantity: "2.6",
    })
    const allocation = makeAllocation({
      fill: makeFill({
        quantity: "2.5",
        quoteQuantity: "5",
      }),
      orderRegistry: terminal.orderRegistry,
      recoveryQuantity: "2.5",
      legacyQuantity: "0",
    })
    const staged = stageMixedSellFillAllocation({
      reconciliation: createMixedSellFillReconciliation(initial),
      allocation,
    }).reconciliation
    assert.throws(
      () => reconcileMixedSellFillOrder({
        reconciliation: staged,
        terminalOrder: terminal.order,
        orderRegistry: terminal.orderRegistry,
        canonicalFillAllocations: [allocation],
      }),
      hasCode("RS_MIXED_SELL_RECONCILIATION_EXECUTED_QUANTITY_MISMATCH"),
      "Broker cumulative execution must equal the sum of distinct canonical fills.",
    )
  })

  test("treats an identical terminal reconciliation replay as an exact no-op", () => {
    const initial = makeOrderContext()
    const terminal = makeOrderContext({
      status: "FILLED",
      executedQuantity: "5.01",
    })
    const allocation = makeAllocation({
      fill: makeFill(),
      orderRegistry: terminal.orderRegistry,
      recoveryQuantity: "5.01",
      legacyQuantity: "0",
    })
    const staged = stageMixedSellFillAllocation({
      reconciliation: createMixedSellFillReconciliation(initial),
      allocation,
    }).reconciliation
    const first = reconcileMixedSellFillOrder({
      reconciliation: staged,
      terminalOrder: terminal.order,
      orderRegistry: terminal.orderRegistry,
      canonicalFillAllocations: [allocation],
    })
    const replay = reconcileMixedSellFillOrder({
      reconciliation: first.reconciliation,
      terminalOrder: terminal.order,
      orderRegistry: terminal.orderRegistry,
      canonicalFillAllocations: [allocation],
    })
    assert.equal(replay.reconciliation, first.reconciliation, "An identical terminal replay must preserve the reconciled state reference.")
    assert.equal(replay.reconciled, false, "An identical terminal replay must not reconcile twice.")
    assert.equal(replay.duplicate, true, "An identical terminal replay must be explicitly classified.")
  })

  test("rejects a conflicting terminal status after an order was reconciled", () => {
    const initial = makeOrderContext()
    const canceled = makeOrderContext({
      status: "CANCELED",
      executedQuantity: "2.5",
    })
    const expired = makeOrderContext({
      status: "EXPIRED",
      executedQuantity: "2.5",
    })
    const allocation = makeAllocation({
      fill: makeFill({
        quantity: "2.5",
        quoteQuantity: "5",
      }),
      orderRegistry: canceled.orderRegistry,
      recoveryQuantity: "2.5",
      legacyQuantity: "0",
    })
    const staged = stageMixedSellFillAllocation({
      reconciliation: createMixedSellFillReconciliation(initial),
      allocation,
    }).reconciliation
    const first = reconcileMixedSellFillOrder({
      reconciliation: staged,
      terminalOrder: canceled.order,
      orderRegistry: canceled.orderRegistry,
      canonicalFillAllocations: [allocation],
    })
    assert.throws(
      () => reconcileMixedSellFillOrder({
        reconciliation: first.reconciliation,
        terminalOrder: expired.order,
        orderRegistry: expired.orderRegistry,
        canonicalFillAllocations: [allocation],
      }),
      hasCode("RS_MIXED_SELL_RECONCILIATION_TERMINAL_CONFLICT"),
      "A terminal order must not be reconciled again with a different terminal status.",
    )
  })

  test("reconciles a REJECTED order with no executions", () => {
    const initial = makeOrderContext()
    const terminal = makeOrderContext({
      status: "REJECTED",
      executedQuantity: "0",
    })
    const result = reconcileMixedSellFillOrder({
      reconciliation: createMixedSellFillReconciliation(initial),
      terminalOrder: terminal.order,
      orderRegistry: terminal.orderRegistry,
      canonicalFillAllocations: [],
    })
    assert.equal(result.reconciliation.status, "RECONCILED", "A rejected order with no executions can be safely reconciled.")
    assert.equal(result.reconciliation.terminalOrderStatus, "REJECTED", "The rejected broker status must be preserved.")
    assert.equal(result.reconciliation.terminalFillCount, 0, "A rejected order must not invent canonical fills.")
  })

  test("rejects a non-terminal order state during terminal reconciliation", () => {
    const initial = makeOrderContext()
    assert.throws(
      () => reconcileMixedSellFillOrder({
        reconciliation: createMixedSellFillReconciliation(initial),
        terminalOrder: initial.order,
        orderRegistry: initial.orderRegistry,
        canonicalFillAllocations: [],
      }),
      hasCode("RS_MIXED_SELL_RECONCILIATION_INVALID_TERMINAL_ORDER"),
      "OPEN orders must remain staged until the broker reports an authoritative terminal status.",
    )
  })

  test("rejects duplicate canonical Fill IDs in terminal history", () => {
    const initial = makeOrderContext()
    const terminal = makeOrderContext({
      status: "FILLED",
      executedQuantity: "5.01",
    })
    const allocation = makeAllocation({
      fill: makeFill(),
      orderRegistry: terminal.orderRegistry,
      recoveryQuantity: "5.01",
      legacyQuantity: "0",
    })
    const staged = stageMixedSellFillAllocation({
      reconciliation: createMixedSellFillReconciliation(initial),
      allocation,
    }).reconciliation
    assert.throws(
      () => reconcileMixedSellFillOrder({
        reconciliation: staged,
        terminalOrder: terminal.order,
        orderRegistry: terminal.orderRegistry,
        canonicalFillAllocations: [allocation, allocation],
      }),
      hasCode("RS_MIXED_SELL_RECONCILIATION_FILL_HISTORY_MISMATCH"),
      "Canonical terminal history must contain each Fill identity exactly once.",
    )
  })
}
