import test from "node:test"
import assert from "node:assert/strict"
import { calculateRecoverySellerProfitability } from "../../src/domain/strategies/recovery-seller/calculate-profitability.js"
import {
  createRecoverySellerCycleState,
  recordRecoverySellerCycleSellSubmission,
  reconcileRecoverySellerCycleSell,
  startNextRecoverySellerCycle,
} from "../../src/domain/strategies/recovery-seller/cycle-state.js"

const cycleOrderIdentity = {
  clientOrderId: "rs-scenario-mixed-sell-001",
}

function reconcileFilledCycle({
  recoveryNetQuoteProceeds,
  legacyNetQuoteProceeds,
  legacyBaseDebit = "0.1",
}) {
  const profitability = calculateRecoverySellerProfitability({
    recoveryCostBasis: "10",
    recoveryNetQuoteProceeds,
    minProfit: "0.01",
    legacyAverageCost: "2",
    legacyBaseDebit,
    legacyNetQuoteProceeds,
  })
  const submitted = recordRecoverySellerCycleSellSubmission({
    state: createRecoverySellerCycleState({
      cycleId: "rs-scenario-cycle-001",
      positionId: "rs-scenario-position-001",
    }),
    orderIdentity: cycleOrderIdentity,
  })
  const reconciled = reconcileRecoverySellerCycleSell({
    state: submitted,
    orderIdentity: cycleOrderIdentity,
    terminalOrderStatus: "FILLED",
    reconciliationComplete: true,
    profitabilityEligible: profitability.eligible,
  })

  return Object.freeze({
    profitability,
    cycle: reconciled,
  })
}

test("a profitable recovery allocation cannot subsidize a legacy loss", () => {
  // Approved contract example: recovery earns 0.15 USDT, while the 0.1 ZRO
  // legacy slice loses 0.01 USDT against its fixed 2 USDT/ZRO historical basis.
  const result = reconcileFilledCycle({
    recoveryNetQuoteProceeds: "10.15",
    legacyNetQuoteProceeds: "0.19",
  })

  assert.equal(result.profitability.recovery.netProfit, "0.15",
    "The recovery allocation must retain its independently realized 0.15 USDT profit.")
  assert.equal(result.profitability.recovery.eligible, true,
    "Recovery must pass its 0.01 USDT minimum-profit gate in this scenario.")
  assert.equal(result.profitability.legacy.costBasis, "0.2",
    "The legacy cost basis must remain 0.1 ZRO multiplied by its fixed 2 USDT/ZRO historical average.")
  assert.equal(result.profitability.legacy.netProfit, "-0.01",
    "The legacy allocation must expose its 0.01 USDT realized loss without netting recovery profit.")
  assert.equal(result.profitability.legacy.eligible, false,
    "A loss-making legacy allocation must fail its independent non-loss gate.")
  assert.equal(result.profitability.cycle.netProfit, "0.14",
    "The combined cycle must still report its independently calculated 0.14 USDT profit.")
  assert.equal(result.profitability.cycle.eligible, true,
    "The combined cycle can pass even though the legacy allocation fails.")
  assert.equal(result.profitability.eligible, false,
    "Overall mixed-SELL eligibility must reject the failed legacy gate despite positive recovery and combined profit.")
  assert.equal(result.cycle.status, "UNRESOLVED",
    "A fully reconciled FILLED SELL with a failed profitability gate must leave its recovery cycle unresolved.")
  assert.equal(result.cycle.sellOrderIdentity.clientOrderId, cycleOrderIdentity.clientOrderId,
    "The unresolved cycle must retain the identity of the one SELL that actually filled.")
  assert.throws(
    () => startNextRecoverySellerCycle({
      previousState: result.cycle,
      nextCycleId: "rs-scenario-cycle-002",
    }),
    /only from a closed profitable and reconciled cycle/,
    "A failed legacy profitability gate must not permit the next recovery cycle to start.",
  )
})

test("profitable legacy proceeds cannot subsidize a recovery loss", () => {
  // The recovery allocation loses 0.005 USDT, while legacy earns 0.10 USDT.
  // Combined profit is positive, but recovery independently misses minProfit.
  const result = reconcileFilledCycle({
    recoveryNetQuoteProceeds: "9.995",
    legacyNetQuoteProceeds: "0.30",
  })

  assert.equal(result.profitability.recovery.netProfit, "-0.005",
    "The recovery allocation must expose its 0.005 USDT loss independently.")
  assert.equal(result.profitability.recovery.eligible, false,
    "Recovery must fail when its realized net profit is below the 0.01 USDT minimum.")
  assert.equal(result.profitability.legacy.netProfit, "0.1",
    "The legacy allocation must retain its independently realized 0.10 USDT profit.")
  assert.equal(result.profitability.legacy.eligible, true,
    "Legacy must pass its independent non-loss gate in this scenario.")
  assert.equal(result.profitability.cycle.netProfit, "0.095",
    "The combined cycle must still report its positive 0.095 USDT result.")
  assert.equal(result.profitability.cycle.eligible, true,
    "The combined cycle can pass even though the recovery allocation fails.")
  assert.equal(result.profitability.eligible, false,
    "Overall mixed-SELL eligibility must reject the failed recovery gate despite positive legacy and combined profit.")
  assert.equal(result.cycle.status, "UNRESOLVED",
    "A FILLED SELL with a failed recovery gate must remain unresolved after complete reconciliation.")
  assert.throws(
    () => recordRecoverySellerCycleSellSubmission({
      state: result.cycle,
      orderIdentity: {
        clientOrderId: "rs-scenario-mixed-sell-002",
      },
    }),
    /only one SELL order lifecycle/,
    "An unresolved cycle must never accept a replacement or second SELL lifecycle.",
  )
})

test("a mixed recovery and legacy cycle closes at exact profitability thresholds when every gate passes", () => {
  const result = reconcileFilledCycle({
    recoveryNetQuoteProceeds: "10.01",
    legacyNetQuoteProceeds: "0.2",
  })

  assert.equal(result.profitability.recovery.netProfit, "0.01",
    "Recovery profit exactly equal to minProfit must satisfy the inclusive recovery threshold.")
  assert.equal(result.profitability.recovery.eligible, true,
    "The recovery gate must accept exact equality with minProfit.")
  assert.equal(result.profitability.legacy.netProfit, "0",
    "Legacy proceeds exactly equal to historical cost must produce break-even net profit.")
  assert.equal(result.profitability.legacy.eligible, true,
    "The legacy gate must accept exact break-even rather than requiring positive profit.")
  assert.equal(result.profitability.cycle.netProfit, "0.01",
    "Combined cycle profit exactly equal to minProfit must satisfy the inclusive cycle threshold.")
  assert.equal(result.profitability.cycle.eligible, true,
    "The combined gate must accept exact equality with minProfit.")
  assert.equal(result.profitability.eligible, true,
    "A mixed SELL is eligible only because recovery, legacy, and combined gates all pass.")
  assert.equal(result.cycle.status, "CLOSED",
    "A FILLED and fully reconciled cycle may close when every applicable profitability gate passes.")
  const nextCycle = startNextRecoverySellerCycle({
    previousState: result.cycle,
    nextCycleId: "rs-scenario-cycle-002",
  })
  assert.equal(nextCycle.status, "ACCUMULATING",
    "A new recovery cycle may start after the prior cycle is closed profitably and reconciled.")
  assert.equal(nextCycle.positionId, "rs-scenario-position-001",
    "The next cycle must retain the existing Position identity when no replacement Position is supplied.")
})

test("recovery-only operation still requires recovery and combined profit after legacy exhaustion", () => {
  const result = reconcileFilledCycle({
    recoveryNetQuoteProceeds: "10.01",
    legacyBaseDebit: "0",
    legacyNetQuoteProceeds: "0",
  })

  assert.equal(result.profitability.legacy.applicable, false,
    "An exhausted legacy allocation must be marked inapplicable rather than treated as an active zero-cost slice.")
  assert.equal(result.profitability.legacy.eligible, true,
    "An inapplicable legacy gate must not block a recovery-only cycle.")
  assert.equal(result.profitability.recovery.eligible, true,
    "Recovery-only operation must still pass the recovery minProfit gate.")
  assert.equal(result.profitability.cycle.eligible, true,
    "Recovery-only operation must still pass the combined-cycle minProfit gate.")
  assert.equal(result.profitability.eligible, true,
    "Recovery-only eligibility must require both remaining gates and omit only the exhausted legacy gate.")
  assert.equal(result.cycle.status, "CLOSED",
    "A recovery-only cycle may close only after a fully reconciled FILLED SELL passes both applicable gates.")
})
