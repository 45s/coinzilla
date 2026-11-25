import test from "node:test"
import assert from "node:assert/strict"
import { divideDecimal } from "@coinzilla/utils"
import { calculateRecoverySellerSellPlan } from "../../../src/domain/strategies/recovery-seller/calculate-sell-plan.js"
import {
  recoverySellerScenarioRegistry,
} from "./registry/index.js"
import { recoverySellerMixedSellPlanningScenarios } from "./scenarios/mixed-sell-planning.js"
import { runRecoverySellerDomainScenario } from "./runners/run-domain-scenario.js"

function calculatePlan({ input }) {
  const legacyAverageCost = divideDecimal({
    left: input.legacyInvested,
    right: input.originalLegacyQuantity,
    scale: 36,
    rounding: "toward-zero",
  })
  return calculateRecoverySellerSellPlan({
    recoveryQuantity: input.recoveryQuantity,
    configuredLegacyQuantity: input.configuredLegacyQuantity,
    legacyRemainingQuantity: input.legacyRemainingQuantity,
    verifiedUnreservedLegacyQuantity: input.verifiedUnreservedLegacyQuantity,
    recoveryCostBasis: input.recoveryCostBasis,
    legacyAverageCost,
    minProfit: input.minProfit,
    quoteFeeRate: input.quoteFeeRate,
    baseFeeRate: input.baseFeeRate,
    thirdAssetFeeQuoteValue: input.thirdAssetFeeQuoteValue,
    priceTickSize: input.priceTickSize,
    quantityStepSize: input.quantityStepSize,
  })
}

function selectPlan(plan) {
  return {
    recoveryQuantity: plan.recoveryQuantity,
    legacyQuantity: plan.legacyQuantity,
    quantity: plan.quantity,
    recoverySellQuantity: plan.recoverySellQuantity,
    legacySellQuantity: plan.legacySellQuantity,
    recoveryRequiredNetQuoteProceeds: plan.recoveryRequiredNetQuoteProceeds,
    legacyRequiredNetQuoteProceeds: plan.legacyRequiredNetQuoteProceeds,
    combinedRequiredNetQuoteProceeds: plan.combinedRequiredNetQuoteProceeds,
    requiredNetQuoteProceeds: plan.requiredNetQuoteProceeds,
    price: plan.price,
  }
}

async function assertRegisteredScenario({ id }) {
  const scenario = recoverySellerMixedSellPlanningScenarios.find((item) => item.id === id)
  assert.ok(scenario,
    `The business matrix scenario ${id} must exist as a declarative RS-003 registry record.`)
  assert.ok(recoverySellerScenarioRegistry.includes(scenario),
    `The shared RS registry must include ${id} so schema validation and reporting cannot omit it.`)

  const result = await runRecoverySellerDomainScenario({
    scenario,
    handlers: {
      "calculate-mixed-sell-plan": calculatePlan,
    },
  })
  assert.deepEqual(
    selectPlan(result.results[0]),
    scenario.then,
    `The real SELL planner output for ${id} must match the independently specified exact-decimal business oracle.`,
  )
}

test("RS-003-001: the mixed SELL adds the authorized legacy slice to canonical recovery inventory", async () => {
  await assertRegisteredScenario({ id: "RS-003-001" })
})

test("RS-003-002: the mixed SELL uses only the smaller authorized legacy remainder", async () => {
  await assertRegisteredScenario({ id: "RS-003-002" })
})

test("RS-003-003: exhausted legacy inventory produces a recovery-only SELL plan", async () => {
  await assertRegisteredScenario({ id: "RS-003-003" })
})

test("the shared RS registry includes the first three additive mixed SELL scenarios", () => {
  const actualIds = recoverySellerScenarioRegistry
    .filter((scenario) => scenario.family === "RS-003")
    .map((scenario) => scenario.id)
    .sort()
  assert.deepEqual(actualIds, [
    "RS-003-001",
    "RS-003-002",
    "RS-003-003",
  ], "The RS registry must expose each mapped RS-003 planning scenario exactly once.")
})
