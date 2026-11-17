import assert from "node:assert/strict"
import test from "node:test"
import { addDecimal } from "@coinzilla/utils"
import { sha256OperationalStateValue } from "../operational-state-canonical.js"
import {
  validateRecoveryCycleCompletedFact,
  validateRecoveryCycleNotCompletedFact,
} from "./validate-operational-state-recovery-facts.js"

const MARKET_ID = "binance:BTCUSDT"
const VENUE = "binance"
const SYMBOL = "BTCUSDT"
const BASE_ASSET_ID = "binance:BTC"
const QUOTE_ASSET_ID = "binance:USDT"

function makeCompletedFact({ inventoryDisposition = null, ...overrides } = {}) {
  const canonicalData = {
    marketId: MARKET_ID,
    venue: VENUE,
    symbol: SYMBOL,
    baseAssetId: BASE_ASSET_ID,
    quoteAssetId: QUOTE_ASSET_ID,
    appliedFillIds: ["fill-1", "fill-2"],
    sellOrderClientId: "sell-client-1",
    sellOrderBrokerOrderId: "sell-broker-1",
    buyCost: "10",
    spent: "10",
    netSellProceeds: "15",
    realizedNetProfit: "5",
    minProfit: "5",
    activeQuantity: inventoryDisposition === null ? "1" : "1",
    keepQuantity: inventoryDisposition === null ? "1" : "0.8",
    freeQuantity: "1",
    inventoryDisposition,
    ...overrides,
  }
  const cycleIdentity = JSON.stringify([
    canonicalData.marketId,
    canonicalData.sellOrderClientId,
    canonicalData.sellOrderBrokerOrderId,
    canonicalData.appliedFillIds,
    canonicalData.buyCost,
    canonicalData.spent,
    canonicalData.netSellProceeds,
    canonicalData.realizedNetProfit,
    canonicalData.minProfit,
    canonicalData.activeQuantity,
    canonicalData.keepQuantity,
    canonicalData.freeQuantity,
    canonicalData.inventoryDisposition,
  ])
  const cycleId = sha256OperationalStateValue(cycleIdentity)
  return {
    factType: "RECOVERY_CYCLE_COMPLETED",
    factId: `recovery-cycle-completed:${MARKET_ID}:${cycleId}`,
    canonicalData: {
      cycleId,
      ...canonicalData,
    },
  }
}

function makeNotCompletedFact({
  outcome = "BLOCKED",
  reason = "RECOVERY_SELL_FAILED_MIN_PROFIT",
  realizedNetProfit = "-2",
  minProfit = "5",
  activeQuantity = "1",
  keepQuantity = "0.5",
  ...overrides
} = {}) {
  const canonicalData = {
    marketId: MARKET_ID,
    venue: VENUE,
    symbol: SYMBOL,
    baseAssetId: BASE_ASSET_ID,
    quoteAssetId: QUOTE_ASSET_ID,
    appliedFillIds: ["fill-1", "fill-2"],
    sellOrderClientId: "sell-client-1",
    sellOrderBrokerOrderId: "sell-broker-1",
    buyCost: "10",
    spent: "10",
    netSellProceeds: addDecimal({
      left: "10",
      right: realizedNetProfit,
    }),
    realizedNetProfit,
    minProfit,
    activeQuantity,
    keepQuantity,
    outcome,
    reason,
    ...overrides,
  }
  const evaluationIdentity = JSON.stringify([
    canonicalData.marketId,
    canonicalData.sellOrderClientId,
    canonicalData.sellOrderBrokerOrderId,
    canonicalData.appliedFillIds,
    canonicalData.buyCost,
    canonicalData.spent,
    canonicalData.netSellProceeds,
    canonicalData.realizedNetProfit,
    canonicalData.minProfit,
    canonicalData.activeQuantity,
    canonicalData.keepQuantity,
    canonicalData.outcome,
    canonicalData.reason,
  ])
  const evaluationId = sha256OperationalStateValue(evaluationIdentity)
  return {
    factType: "RECOVERY_CYCLE_NOT_COMPLETED",
    factId: `recovery-cycle-not-completed:${MARKET_ID}:${evaluationId}`,
    canonicalData: {
      evaluationId,
      ...canonicalData,
    },
  }
}

function validateCompleted(fact) {
  return validateRecoveryCycleCompletedFact(fact)
}

function validateNotCompleted(fact) {
  return validateRecoveryCycleNotCompletedFact(fact)
}

test("accepts completed recovery facts with no dust and each supported dust evidence reason", () => {
  assert.doesNotThrow(
    () => validateCompleted(makeCompletedFact()),
    "A completed cycle with fully retained inventory and no dust must satisfy the exact accounting contract.",
  )

  const dustCases = [
    {
      reason: "MIN_QUANTITY",
      minimumQuantity: "0.1",
      evaluatedQuantity: "0.2",
    },
    {
      reason: "MIN_NOTIONAL",
      minimumQuantity: "0.1",
      minimumNotional: "10",
      evaluatedQuantity: "0.2",
      evaluatedNotional: "20",
    },
    {
      reason: "QUANTITY_INCREMENT",
      quantityStepSize: "0.1",
      evaluatedQuantity: "0",
    },
  ]

  for (const evidence of dustCases) {
    const inventoryDisposition = {
      status: "EXCHANGE_CONSTRAINED_DUST",
      quantity: "0.2",
      ...evidence,
    }
    assert.doesNotThrow(
      () => validateCompleted(makeCompletedFact({ inventoryDisposition })),
      `A ${evidence.reason} dust disposition with its required exact exchange evidence must validate.`,
    )
  }
})

test("rejects completed recovery identity, field allowlist, and applied-fill violations", () => {
  const valid = makeCompletedFact()
  assert.throws(
    () => validateCompleted({
      ...valid,
      canonicalData: {
        ...valid.canonicalData,
        unsupported: true,
      },
    }),
    /unsupported fields/,
    "A completed-cycle payload must reject fields outside its durable schema.",
  )
  assert.throws(
    () => validateCompleted({
      ...valid,
      factId: "recovery-cycle-completed:wrong-identity",
    }),
    /identity is not canonical/,
    "The fact ID must bind the exact market and derived recovery-cycle identity.",
  )
  assert.throws(
    () => validateCompleted({
      ...valid,
      canonicalData: {
        ...valid.canonicalData,
        appliedFillIds: ["fill-1", "fill-1"],
      },
    }),
    /unique applied fill identities/,
    "A completed cycle must not count the same applied fill twice.",
  )
  assert.throws(
    () => validateCompleted({
      ...valid,
      canonicalData: {
        ...valid.canonicalData,
        cycleId: "not-a-sha256-digest",
      },
    }),
    /identity is not canonical/,
    "A malformed cycle identity must be rejected before it can be persisted.",
  )
})

test("rejects completed recovery accounting that is inexact or internally inconsistent", () => {
  const valid = makeCompletedFact()
  const invalidCases = [
    ["buy cost differs from spent", { buyCost: "9" }],
    ["realized profit does not reconcile to proceeds less spent", { realizedNetProfit: "4" }],
    [
      "profit is below the configured minimum",
      { realizedNetProfit: "4", netSellProceeds: "14", minProfit: "5" },
    ],
    [
      "active inventory is below retained inventory",
      { activeQuantity: "0.5", keepQuantity: "1", freeQuantity: "0.5" },
    ],
    ["free inventory differs from active inventory", { freeQuantity: "0.9" }],
    ["minimum profit is below the supported floor", { minProfit: "0.001" }],
    ["amounts are not canonical decimals", { netSellProceeds: "1e2" }],
  ]

  for (const [description, changes] of invalidCases) {
    assert.throws(
      () => validateCompleted({
        ...valid,
        canonicalData: {
          ...valid.canonicalData,
          ...changes,
        },
      }),
      /accounting values|profit and inventory allocation/,
      `A completed recovery fact must reject when ${description}.`,
    )
  }
})

test("rejects invalid exchange dust metadata, missing evidence, and unreconciled dust quantities", () => {
  const valid = makeCompletedFact({
    inventoryDisposition: {
      status: "EXCHANGE_CONSTRAINED_DUST",
      quantity: "0.2",
      reason: "MIN_QUANTITY",
      minimumQuantity: "0.1",
      evaluatedQuantity: "0.2",
    },
  })

  const invalidDispositions = [
    [
      {
        ...valid.canonicalData.inventoryDisposition,
        status: "UNKNOWN",
      },
      /validated exchange-constrained dust/,
    ],
    [
      {
        ...valid.canonicalData.inventoryDisposition,
        reason: "UNKNOWN",
      },
      /validated exchange-constrained dust/,
    ],
    [
      {
        ...valid.canonicalData.inventoryDisposition,
        quantity: "0",
      },
      /validated exchange-constrained dust/,
    ],
    [
      {
        ...valid.canonicalData.inventoryDisposition,
        minimumQuantity: "01",
      },
      /exact decimal string/,
    ],
    [
      {
        ...valid.canonicalData.inventoryDisposition,
        evaluatedQuantity: undefined,
      },
      /MIN_QUANTITY dust requires/,
    ],
  ]

  for (const [inventoryDisposition, expectedError] of invalidDispositions) {
    const fact = makeCompletedFact({ inventoryDisposition })
    assert.throws(
      () => validateCompleted(fact),
      expectedError,
      `An invalid dust disposition must be rejected: ${expectedError}.`,
    )
  }

  const mismatchedQuantity = makeCompletedFact({
    inventoryDisposition: {
      status: "EXCHANGE_CONSTRAINED_DUST",
      quantity: "0.3",
      reason: "MIN_QUANTITY",
      minimumQuantity: "0.1",
      evaluatedQuantity: "0.2",
    },
  })
  assert.throws(
    () => validateCompleted(mismatchedQuantity),
    /dust quantity must exactly reconcile/,
    "The recorded dust quantity must exactly reconcile active and retained inventory.",
  )
})

test("accepts each supported recovery non-completion outcome and reason combination", () => {
  const validCases = [
    {
      outcome: "CONTINUE_SELL_THROUGH",
      reason: "RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH",
      realizedNetProfit: "5",
    },
    {
      outcome: "CONTINUE_SELL_THROUGH",
      reason: "RECOVERY_PROFIT_TARGET_NOT_MET_CONTINUE_RECOVERY",
      realizedNetProfit: "2",
    },
    {
      outcome: "BLOCKED",
      reason: "RECOVERY_SELL_FAILED_MIN_PROFIT",
      realizedNetProfit: "-2",
    },
    {
      outcome: "BLOCKED",
      reason: "EXTERNAL_ORDER_REQUIRES_REVIEW",
      realizedNetProfit: "2",
    },
  ]

  for (const options of validCases) {
    assert.doesNotThrow(
      () => validateNotCompleted(makeNotCompletedFact(options)),
      `The supported ${options.outcome} outcome with reason ${options.reason} must validate.`,
    )
  }
})

test("rejects recovery non-completion identity, accounting, and outcome contradictions", () => {
  const valid = makeNotCompletedFact()
  assert.throws(
    () => validateNotCompleted({
      ...valid,
      canonicalData: {
        ...valid.canonicalData,
        unsupported: true,
      },
    }),
    /unsupported fields/,
    "A non-completion payload must reject fields outside its durable schema.",
  )
  assert.throws(
    () => validateNotCompleted({
      ...valid,
      factId: "recovery-cycle-not-completed:wrong-identity",
    }),
    /identity or reason is not canonical/,
    "The non-completion fact ID must bind its market and evaluation identity.",
  )

  const invalidCases = [
    ["unapproved continuation reason", {
      outcome: "CONTINUE_SELL_THROUGH",
      reason: "EXTERNAL_ORDER_REQUIRES_REVIEW",
      realizedNetProfit: "5",
    }],
    ["continuation without residual inventory", {
      outcome: "CONTINUE_SELL_THROUGH",
      reason: "RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH",
      realizedNetProfit: "5",
      activeQuantity: "0.5",
      keepQuantity: "0.5",
    }],
    ["residual sell-through below minimum profit", {
      outcome: "CONTINUE_SELL_THROUGH",
      reason: "RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH",
      realizedNetProfit: "4",
    }],
    ["profit-target continuation after meeting minimum profit", {
      outcome: "CONTINUE_SELL_THROUGH",
      reason: "RECOVERY_PROFIT_TARGET_NOT_MET_CONTINUE_RECOVERY",
      realizedNetProfit: "5",
    }],
    ["blocked outcome with a continuation reason", {
      outcome: "BLOCKED",
      reason: "RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH",
      realizedNetProfit: "5",
    }],
    ["minimum-profit blocker after meeting minimum profit", {
      outcome: "BLOCKED",
      reason: "RECOVERY_SELL_FAILED_MIN_PROFIT",
      realizedNetProfit: "5",
    }],
    ["unsupported outcome", {
      outcome: "UNKNOWN",
      reason: "EXTERNAL_ORDER_REQUIRES_REVIEW",
      realizedNetProfit: "2",
    }],
  ]

  for (const [description, options] of invalidCases) {
    assert.throws(
      () => validateNotCompleted(makeNotCompletedFact(options)),
      /CONTINUE_SELL_THROUGH|BLOCKED|minimum profit|accounting values|internally consistent/,
      `A recovery non-completion fact must reject ${description}.`,
    )
  }
})

test("does not apply recovery validation to unrelated fact types", () => {
  assert.doesNotThrow(
    () => validateCompleted({
      factType: "PROCESS_STOPPED",
      factId: "process-stopped:session-1",
      canonicalData: {},
    }),
    "The recovery-cycle validator must leave unrelated fact families to their own validators.",
  )
  assert.doesNotThrow(
    () => validateNotCompleted({
      factType: "PROCESS_STOPPED",
      factId: "process-stopped:session-1",
      canonicalData: {},
    }),
    "The recovery non-completion validator must leave unrelated fact families unchanged.",
  )
})
