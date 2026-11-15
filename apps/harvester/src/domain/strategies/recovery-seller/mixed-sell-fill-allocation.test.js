import test from "node:test"
import assert from "node:assert/strict"
import { Asset, CanonicalOrder, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { addDecimal } from "@coinzilla/utils"
import { StrategyId } from "../strategy-ids.js"
import { createOrderOwnership } from "../../orders/order-ownership.js"
import { OrderRegistry } from "../../orders/order-registry.js"
import { createFillFingerprint } from "../../fills/fill-fingerprint.js"
import { createMixedSellFillAllocation } from "./mixed-sell-fill-allocation.js"

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

function makeFill(overrides = {}) {
  return new Fill({
    tradeId: "trade-1",
    brokerOrderId: "broker-1",
    clientOrderId: "harvester-rs-sell",
    market,
    side: "SELL",
    price: new Money({
      amount: "2",
      asset: quoteAsset,
    }),
    quantity: new Quantity({
      amount: "5.01",
      asset: baseAsset,
    }),
    quoteQuantity: new Money({
      amount: "10.02",
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
    ...overrides,
  })
}

function makeOrder(overrides = {}) {
  const quantity = overrides.quantity ?? "5.01"
  const brokerOrderId = overrides.brokerOrderId ?? "broker-1"
  return new CanonicalOrder({
    clientOrderId: overrides.clientOrderId ?? "harvester-rs-sell",
    brokerOrderId,
    market: overrides.market ?? market,
    side: overrides.side ?? "SELL",
    type: "LIMIT_MAKER",
    limitPrice: new Money({
      amount: "2",
      asset: quoteAsset,
    }),
    originalQuantity: new Quantity({
      amount: quantity,
      asset: baseAsset,
    }),
    executedQuantity: new Quantity({
      amount: overrides.executedQuantity ?? quantity,
      asset: baseAsset,
    }),
    status: overrides.status ?? "FILLED",
    createdAt: 100,
    acknowledgedAt: 101,
    updatedAt: 102,
    completedAt: 103,
  })
}

function makeOwnership(overrides = {}) {
  const ownership = {
    strategyId: overrides.strategyId ?? StrategyId.RECOVERY_SELLER,
    positionId: overrides.positionId ?? "rs-position-1",
    purpose: overrides.purpose ?? "RECOVERY_SELL",
  }
  if (overrides.cycleId !== null) {
    ownership.cycleId = overrides.cycleId ?? "rs-cycle-1"
  }
  return createOrderOwnership({
    ownership,
    clientOrderId: overrides.clientOrderId ?? "harvester-rs-sell",
    brokerOrderId: overrides.brokerOrderId ?? "broker-1",
  })
}

function makeInput(overrides = {}) {
  const fill = overrides.fill ?? makeFill()
  const order = overrides.order ?? makeOrder()
  const ownership = overrides.ownership ?? makeOwnership()
  const orderRegistry = overrides.orderRegistry ?? new OrderRegistry({
    orders: [order],
    ownerships: [ownership],
  })
  return {
    fill,
    ownership,
    orderRegistry,
    recoveryQuantity: overrides.recoveryQuantity ?? "5",
    legacyQuantity: overrides.legacyQuantity ?? "0.01",
  }
}

function sum({ left, right }) {
  return addDecimal({
    left,
    right,
  })
}

test("allocates one canonical mixed SELL Fill across recovery and legacy without synthetic fills", () => {
  const input = makeInput()
  const allocation = createMixedSellFillAllocation(input)

  assert.equal(allocation.fillId, input.fill.id, "Allocation must reference the original canonical Fill ID.")
  assert.equal(allocation.fillFingerprint, createFillFingerprint({ fill: input.fill }), "Allocation must bind the complete canonical execution facts.")
  assert.equal(allocation.marketId, market.id, "Allocation must retain the canonical market identity.")
  assert.equal(allocation.orderOwnership.clientOrderId, "harvester-rs-sell", "Allocation must retain the original Harvester client order identity.")
  assert.equal(allocation.orderOwnership.brokerOrderId, "broker-1", "Allocation must retain the acknowledged broker order identity.")
  assert.equal(allocation.orderOwnership.positionId, "rs-position-1", "Recovery allocation must retain its registered Position owner.")
  assert.equal(allocation.orderOwnership.purpose, input.ownership.purpose, "Allocation must preserve the registered order purpose without inventing a new purpose enum.")
  assert.equal(allocation.recovery.grossBaseQuantity, "5", "Recovery receives only its explicitly allocated gross base quantity.")
  assert.equal(allocation.legacy.grossBaseQuantity, "0.01", "Legacy receives only its explicitly allocated gross base quantity.")
  assert.equal(allocation.recovery.quoteProceeds, "10", "Recovery proceeds must be split from actual canonical quote proceeds.")
  assert.equal(allocation.legacy.quoteProceeds, "0.02", "Legacy proceeds must be split from actual canonical quote proceeds.")
  assert.equal(sum({
    left: allocation.recovery.grossBaseQuantity,
    right: allocation.legacy.grossBaseQuantity,
  }), input.fill.quantity.amount, "Recovery and legacy gross quantities must conserve the canonical Fill exactly.")
  assert.equal(sum({
    left: allocation.recovery.quoteProceeds,
    right: allocation.legacy.quoteProceeds,
  }), input.fill.quoteQuantity.amount, "Recovery and legacy quote proceeds must conserve the canonical Fill exactly.")
})

test("allocates every actual commission amount and quote valuation without losing canonical facts", () => {
  const input = makeInput()
  const allocation = createMixedSellFillAllocation(input)

  for (const commission of input.fill.commissions) {
    const recovery = allocation.recovery.commissions.find((item) => item.assetId === commission.amount.asset.id)
    const legacy = allocation.legacy.commissions.find((item) => item.assetId === commission.amount.asset.id)
    assert.ok(recovery, "Recovery allocation must retain each canonical commission asset.")
    assert.ok(legacy, "Legacy allocation must retain each canonical commission asset.")
    assert.equal(sum({
      left: recovery.amount,
      right: legacy.amount,
    }), commission.amount.amount, "Allocated commission amounts must sum exactly to the canonical amount.")
    if (commission.quoteValue) {
      assert.equal(sum({
        left: recovery.quoteValue.amount,
        right: legacy.quoteValue.amount,
      }), commission.quoteValue.amount, "Allocated quote valuations must sum exactly to the canonical valuation.")
    }
  }

  const baseCommission = input.fill.commissions.find((item) => item.amount.asset.id === baseAsset.id)
  assert.equal(
    sum({
      left: allocation.recovery.baseDebit,
      right: allocation.legacy.baseDebit,
    }),
    sum({
      left: input.fill.quantity.amount,
      right: baseCommission.amount.amount,
    }),
    "Recovery and legacy base debits together must equal executed base plus actual base commission exactly once.",
  )
})

test("creates deterministic deeply immutable allocation metadata", () => {
  const input = makeInput()
  const first = createMixedSellFillAllocation(input)
  const second = createMixedSellFillAllocation(input)

  assert.equal(first.allocationFingerprint, second.allocationFingerprint, "Identical Fill, ownership and split facts must produce the same allocation fingerprint.")
  assert.equal(Object.isFrozen(first), true, "The allocation root must be immutable.")
  assert.equal(Object.isFrozen(first.orderOwnership), true, "The registered order ownership snapshot must be immutable.")
  assert.equal(Object.isFrozen(first.recovery), true, "The recovery allocation must be immutable.")
  assert.equal(Object.isFrozen(first.legacy), true, "The legacy allocation must be immutable.")
  assert.equal(Object.isFrozen(first.recovery.commissions), true, "Recovery commission allocations must be immutable.")
  assert.equal(Object.isFrozen(first.recovery.commissions[0]), true, "Each recovery commission allocation must be immutable.")
})

test("supports a recovery-only SELL after legacy quantity is exhausted", () => {
  const fill = makeFill({
    quantity: new Quantity({
      amount: "5",
      asset: baseAsset,
    }),
    quoteQuantity: new Money({
      amount: "10",
      asset: quoteAsset,
    }),
    commissions: [],
  })
  const order = makeOrder({
    quantity: "5",
    executedQuantity: "5",
  })
  const orderRegistry = new OrderRegistry({
    orders: [order],
    ownerships: [makeOwnership()],
  })
  const allocation = createMixedSellFillAllocation({
    fill,
    orderRegistry,
    recoveryQuantity: "5",
    legacyQuantity: "0",
  })

  assert.equal(allocation.recovery.grossBaseQuantity, "5", "Recovery-only SELL must allocate the complete gross quantity to recovery.")
  assert.equal(allocation.legacy.grossBaseQuantity, "0", "An exhausted legacy position must receive no new quantity.")
  assert.equal(allocation.recovery.quoteProceeds, "10", "Recovery-only SELL must allocate all actual quote proceeds to recovery.")
  assert.equal(allocation.legacy.quoteProceeds, "0", "An exhausted legacy position must receive no quote proceeds.")
  assert.equal(allocation.recovery.baseDebit, "5", "Recovery base debit must equal the gross quantity when no base commission is charged.")
  assert.equal(allocation.legacy.baseDebit, "0", "An exhausted legacy position must receive no base debit.")
})

test("rejects legacy-only SELL allocation and quantity splits that do not conserve the Fill", () => {
  assert.throws(
    () => createMixedSellFillAllocation(makeInput({
      recoveryQuantity: "0",
      legacyQuantity: "5.01",
    })),
    /recoveryQuantity must be greater than zero/i,
    "A mixed SELL allocation must contain a positive recovery tranche.",
  )
  assert.throws(
    () => createMixedSellFillAllocation(makeInput({
      recoveryQuantity: "4",
      legacyQuantity: "0.01",
    })),
    /sum to the canonical Fill quantity/i,
    "Recovery and legacy allocations must exactly conserve the canonical Fill quantity.",
  )
})

test("requires SELL-side registered ownership that matches the canonical order and Fill", () => {
  assert.throws(
    () => createMixedSellFillAllocation(makeInput({
      order: makeOrder({
        side: "BUY",
      }),
    })),
    /SELL/i,
    "A BUY order cannot own a mixed SELL allocation.",
  )
  assert.throws(
    () => createMixedSellFillAllocation(makeInput({
      fill: makeFill({
        side: "BUY",
      }),
    })),
    /SELL/i,
    "A BUY Fill cannot be allocated as a mixed SELL.",
  )
  assert.throws(
    () => createMixedSellFillAllocation(makeInput({ fill: makeFill({
      brokerOrderId: "other-broker",
    }) })),
    /broker order identity/i,
    "A Fill must resolve to the registered broker order identity.",
  )
  assert.throws(
    () => createMixedSellFillAllocation(makeInput({
      ownership: makeOwnership({
        strategyId: StrategyId.COIN_GRABBER,
      }),
    })),
    /Recovery Seller/i,
    "A non-RS order owner cannot receive Recovery Seller allocation.",
  )
})

test("rejects incomplete commissions and third-asset fees without quote valuation", () => {
  assert.throws(
    () => createMixedSellFillAllocation(makeInput({ fill: makeFill({
      commissionStatus: "UNKNOWN",
    }) })),
    /commission/i,
    "Incomplete commission facts must block mixed SELL allocation.",
  )
  const missingThirdAssetValue = makeFill({
    commissions: [new Commission({
      amount: new Money({
        amount: "0.02",
        asset: feeAsset,
      }),
    })],
  })
  assert.throws(
    () => createMixedSellFillAllocation(makeInput({
      fill: missingThirdAssetValue,
    })),
    /quote-currency valuation/i,
    "A third-asset commission without historical quote valuation must fail closed.",
  )
})


test("allocation fingerprint is stable when canonical commission entries are reordered", () => {
  const input = makeInput()
  const reorderedFill = makeFill({
    commissions: [...input.fill.commissions].reverse(),
  })
  const first = createMixedSellFillAllocation(input)
  const reordered = createMixedSellFillAllocation({
    ...input,
    fill: reorderedFill,
  })

  assert.equal(first.fillFingerprint, reordered.fillFingerprint, "Canonical Fill fingerprint must be independent of commission entry order.")
  assert.equal(first.allocationFingerprint, reordered.allocationFingerprint, "Allocation fingerprint must be independent of commission entry order.")
})

test("rejects an order from another market or a Fill larger than its registered order", () => {
  const otherMarket = new Market({
    venue: "other",
    symbol: "ZROUSDT",
    baseAsset,
    quoteAsset,
  })
  assert.throws(
    () => createMixedSellFillAllocation(makeInput({ order: makeOrder({
      market: otherMarket,
    }) })),
    /market identity/i,
    "A registered order from another market cannot own this Fill allocation.",
  )
  assert.throws(
    () => createMixedSellFillAllocation(makeInput({ order: makeOrder({
    quantity: "5",
    executedQuantity: "5",
  }) })),
    /exceeds registered order quantity/i,
    "A canonical Fill cannot exceed the registered order quantity.",
  )
})


test("resolves immutable Recovery Seller ownership from the registered order registry", () => {
  const input = makeInput()
  const allocation = createMixedSellFillAllocation(input)

  assert.equal(
    allocation.orderOwnership.clientOrderId,
    "harvester-rs-sell",
    "Mixed SELL allocation must retain the Harvester client identity resolved from OrderRegistry.",
  )
  assert.equal(
    allocation.orderOwnership.brokerOrderId,
    "broker-1",
    "Mixed SELL allocation must retain the broker identity linked to the registered order.",
  )
  assert.equal(
    allocation.orderOwnership.strategyId,
    StrategyId.RECOVERY_SELLER,
    "Mixed SELL allocation must derive its Recovery Seller attribution from the immutable registered ownership record.",
  )
})

test("rejects a canonical Fill whose client order identity differs from its registered order", () => {
  const input = makeInput({
    fill: makeFill({
      clientOrderId: "different-harvester-order",
    }),
  })

  assert.throws(
    () => createMixedSellFillAllocation(input),
    /clientOrderId/i,
    "A Fill must not be attributed to an order with a different Harvester client identity.",
  )
})

test("rejects a registry order without a registered ownership record", () => {
  const order = makeOrder()
  const input = makeInput({
    orderRegistry: new OrderRegistry({
      orders: [order],
      ownerships: [],
    }),
  })

  assert.throws(
    () => createMixedSellFillAllocation(input),
    /ownership/i,
    "A canonical order without immutable OrderRegistry ownership must never receive RS allocation.",
  )
})

test("rejects an order registry that is not the canonical OrderRegistry", () => {
  const input = makeInput({
    orderRegistry: {
      getOrderByBrokerOrderId: () => makeOrder(),
      getOwnership: () => makeOwnership(),
    },
  })

  assert.throws(
    () => createMixedSellFillAllocation(input),
    /OrderRegistry/i,
    "Mixed SELL allocation must resolve attribution only through the immutable application OrderRegistry.",
  )
})


test("requires Recovery Seller SELL ownership to identify its cycle and purpose", () => {
  const missingCycle = makeInput({
    ownership: makeOwnership({
      cycleId: null,
    }),
  })
  const wrongPurpose = makeInput({
    ownership: makeOwnership({
      purpose: "INITIAL_BUY",
    }),
  })

  assert.throws(
    () => createMixedSellFillAllocation(missingCycle),
    /cycleId/i,
    "A mixed SELL allocation must retain the registered Recovery Seller cycle identity.",
  )
  assert.throws(
    () => createMixedSellFillAllocation(wrongPurpose),
    /RECOVERY_SELL/i,
    "A mixed SELL allocation must come from a registered Recovery Seller recovery-SELL order.",
  )
})
