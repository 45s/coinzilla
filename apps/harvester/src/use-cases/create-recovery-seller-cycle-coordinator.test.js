import assert from "node:assert/strict"
import test from "node:test"
import { createPositionId } from "../domain/portfolio/position.js"
import { StrategyId } from "../domain/strategies/strategy-ids.js"
import { createRecoverySellerCycleCoordinator } from "./create-recovery-seller-cycle-coordinator.js"

function createCoordinator(ids = ["cycle-1", "cycle-2"]) {
  const sharedState = {
    recoverySellerCyclesByMarket: new Map(),
  }
  return {
    sharedState,
    coordinator: createRecoverySellerCycleCoordinator({
      sharedState,
      createId: () => ids.shift(),
    }),
  }
}

function createSellIdentity() {
  return {
    clientOrderId: "h-rs-sell-1",
    brokerOrderId: "broker-rs-sell-1",
  }
}

test("creates and reuses one cycle per market with the canonical RS Position identity", () => {
  const { coordinator } = createCoordinator()
  const first = coordinator.getOrCreateCycle({
    marketId: "binance:ZROUSDT",
  })
  const second = coordinator.getOrCreateCycle({
    marketId: "binance:ZROUSDT",
  })

  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  assert.equal(first.data.cycleId, "cycle-1")
  assert.equal(second.data.cycleId, "cycle-1")
  assert.equal(
    first.data.positionId,
    createPositionId({
      marketId: "binance:ZROUSDT",
      strategyId: StrategyId.RECOVERY_SELLER,
    }),
  )
})

test("fails closed when an RS Position or order exists without its cycle state", () => {
  const { coordinator } = createCoordinator()
  const result = coordinator.getOrCreateCycle({
    marketId: "binance:ZROUSDT",
    hasExistingRecoveryState: true,
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /existing RS Position or order has no cycle state/)
})

test("requires a durable submission intent before reserving the sole SELL", () => {
  const { coordinator } = createCoordinator()
  const cycle = coordinator.getOrCreateCycle({
    marketId: "binance:ZROUSDT",
  })
  const result = coordinator.reserveSell({
    marketId: "binance:ZROUSDT",
    cycleId: cycle.data.cycleId,
    orderIdentity: createSellIdentity(),
    durableSubmissionIntent: false,
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /durable submission intent/)
  assert.equal(coordinator.getCycleState({
    marketId: "binance:ZROUSDT",
  }).status, "ACCUMULATING")
})

test("reserves one SELL and preserves its identity through unknown and terminal underfill", () => {
  const { coordinator } = createCoordinator()
  const cycle = coordinator.getOrCreateCycle({
    marketId: "binance:ZROUSDT",
  })
  const reserved = coordinator.reserveSell({
    marketId: "binance:ZROUSDT",
    cycleId: cycle.data.cycleId,
    orderIdentity: createSellIdentity(),
    durableSubmissionIntent: true,
  })
  const duplicate = coordinator.reserveSell({
    marketId: "binance:ZROUSDT",
    cycleId: cycle.data.cycleId,
    orderIdentity: {
      clientOrderId: "h-rs-sell-2",
    },
    durableSubmissionIntent: true,
  })

  assert.equal(reserved.ok, true)
  assert.equal(reserved.data.status, "SELL_SUBMITTED")
  assert.equal(duplicate.ok, false)
  assert.equal(coordinator.markSellUnknown({
    marketId: "binance:ZROUSDT",
    cycleId: cycle.data.cycleId,
  }).data.status, "RECONCILIATION_REQUIRED")
  const terminal = coordinator.reconcileSell({
    marketId: "binance:ZROUSDT",
    cycleId: cycle.data.cycleId,
    orderIdentity: createSellIdentity(),
    terminalOrderStatus: "CANCELED",
    reconciliationComplete: true,
    profitabilityEligible: false,
  })

  assert.equal(terminal.ok, true)
  assert.equal(terminal.data.status, "UNRESOLVED")
  assert.equal(terminal.data.sellOrderIdentity.clientOrderId, "h-rs-sell-1")
  assert.equal(coordinator.startNextCycle({
    marketId: "binance:ZROUSDT",
  }).ok, false)
})

test("starts a new cycle only after a reconciled profitable FILLED SELL", () => {
  const { coordinator } = createCoordinator()
  const cycle = coordinator.getOrCreateCycle({
    marketId: "binance:ZROUSDT",
  })
  coordinator.reserveSell({
    marketId: "binance:ZROUSDT",
    cycleId: cycle.data.cycleId,
    orderIdentity: createSellIdentity(),
    durableSubmissionIntent: true,
  })
  const closed = coordinator.reconcileSell({
    marketId: "binance:ZROUSDT",
    cycleId: cycle.data.cycleId,
    orderIdentity: createSellIdentity(),
    terminalOrderStatus: "FILLED",
    reconciliationComplete: true,
    profitabilityEligible: true,
  })
  const next = coordinator.startNextCycle({
    marketId: "binance:ZROUSDT",
  })

  assert.equal(closed.data.status, "CLOSED")
  assert.equal(next.ok, true)
  assert.equal(next.data.cycleId, "cycle-2")
  assert.equal(next.data.positionId, cycle.data.positionId)
})
