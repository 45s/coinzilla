import {
  DEFAULT_DECIMAL_DIVISION_SCALE,
  addDecimal,
  assertDecimalString,
  compareDecimal,
  divideDecimal,
  multiplyDecimal,
  subtractDecimal,
} from "@coinzilla/utils"
import { CanonicalOrder, Fill } from "@coinzilla/entities"
import { StrategyId } from "../strategy-ids.js"
import { OrderRegistry } from "../../orders/order-registry.js"
import { createFillFingerprint } from "../../fills/fill-fingerprint.js"
import { validateFillCommissions } from "../../fills/validate-fill-commissions.js"

function assertPositiveDecimal({ value, field }) {
  assertDecimalString({
    value,
    field,
  })
  if (compareDecimal({
    left: value,
    right: "0",
  }) <= 0) {
    throw new RangeError(`${field} must be greater than zero`)
  }
}

function assertNonNegativeDecimal({ value, field }) {
  assertDecimalString({
    value,
    field,
  })
  if (compareDecimal({
    left: value,
    right: "0",
  }) < 0) {
    throw new RangeError(`${field} must be non-negative`)
  }
}

function resolveRegisteredOrderOwnership({ fill, orderRegistry }) {
  if (!(orderRegistry instanceof OrderRegistry)) {
    throw new TypeError("Mixed SELL allocation requires the canonical OrderRegistry")
  }
  if (typeof fill.brokerOrderId !== "string" || !fill.brokerOrderId.trim()) {
    throw new TypeError("Mixed SELL allocation requires a broker order identity")
  }

  const order = orderRegistry.getOrderByBrokerOrderId({
    brokerOrderId: fill.brokerOrderId,
  })
  if (!order) {
    throw new TypeError("Mixed SELL Fill broker order identity does not match a registered canonical order")
  }
  if (fill.clientOrderId !== undefined && fill.clientOrderId !== order.clientOrderId) {
    throw new TypeError("Mixed SELL Fill clientOrderId does not match registered order clientOrderId")
  }
  if (order.side !== "SELL") {
    throw new TypeError("Mixed SELL allocation requires a registered SELL order")
  }
  if (order.market.id !== fill.market.id) {
    throw new TypeError("Mixed SELL order market identity does not match canonical Fill market identity")
  }

  const orderOwnership = orderRegistry.getOwnership({
    clientOrderId: order.clientOrderId,
    brokerOrderId: order.brokerOrderId,
  })
  if (!orderOwnership) {
    throw new TypeError("Mixed SELL allocation requires registered order ownership")
  }
  if (orderOwnership.strategyId !== StrategyId.RECOVERY_SELLER) {
    throw new TypeError("Mixed SELL allocation requires Recovery Seller order ownership")
  }

  return Object.freeze({
    order,
    orderOwnership,
  })
}

function validateAllocationInput({
  fill,
  orderRegistry,
  recoveryQuantity,
  legacyQuantity,
}) {
  if (!(fill instanceof Fill)) {
    throw new TypeError("Mixed SELL allocation requires a canonical Fill")
  }
  if (fill.side !== "SELL") {
    throw new TypeError("Mixed SELL allocation requires a SELL canonical Fill")
  }

  const { order, orderOwnership } = resolveRegisteredOrderOwnership({
    fill,
    orderRegistry,
  })

  assertPositiveDecimal({
    value: fill.quantity.amount,
    field: "fill.quantity.amount",
  })
  assertPositiveDecimal({
    value: fill.quoteQuantity.amount,
    field: "fill.quoteQuantity.amount",
  })
  assertPositiveDecimal({
    value: order.originalQuantity.amount,
    field: "order.originalQuantity.amount",
  })
  if (compareDecimal({
    left: fill.quantity.amount,
    right: order.originalQuantity.amount,
  }) > 0) {
    throw new RangeError("Canonical Fill quantity exceeds registered order quantity")
  }

  assertPositiveDecimal({
    value: recoveryQuantity,
    field: "recoveryQuantity",
  })
  assertNonNegativeDecimal({
    value: legacyQuantity,
    field: "legacyQuantity",
  })
  const allocatedQuantity = addDecimal({
    left: recoveryQuantity,
    right: legacyQuantity,
  })
  if (compareDecimal({
    left: allocatedQuantity,
    right: fill.quantity.amount,
  }) !== 0) {
    throw new RangeError("Recovery and legacy allocations must sum to the canonical Fill quantity")
  }

  validateFillCommissions({
    market: fill.market,
    fill,
  })
  return Object.freeze({
    order,
    orderOwnership,
  })
}

function splitDecimalAmount({ amount, recoveryQuantity, fillQuantity }) {
  if (compareDecimal({
    left: recoveryQuantity,
    right: fillQuantity,
  }) === 0) {
    return Object.freeze({
      recovery: amount,
      legacy: "0",
    })
  }

  const recovery = divideDecimal({
    left: multiplyDecimal({
      left: amount,
      right: recoveryQuantity,
    }),
    right: fillQuantity,
    scale: DEFAULT_DECIMAL_DIVISION_SCALE,
    rounding: "toward-zero",
  })
  return Object.freeze({
    recovery,
    legacy: subtractDecimal({
      left: amount,
      right: recovery,
    }),
  })
}

function freezeCommissionAllocations(allocations) {
  const serializedAllocations = allocations
    .map((allocation) => JSON.stringify(allocation))
    .sort()
  return Object.freeze(
    serializedAllocations.map((serialized) => {
      const commission = JSON.parse(serialized)
      if (commission.quoteValue !== undefined) {
        Object.freeze(commission.quoteValue)
      }
      return Object.freeze(commission)
    }),
  )
}

function allocateCommissions({ fill, recoveryQuantity }) {
  const recovery = []
  const legacy = []
  for (const commission of fill.commissions) {
    const amount = splitDecimalAmount({
      amount: commission.amount.amount,
      recoveryQuantity,
      fillQuantity: fill.quantity.amount,
    })
    const quoteValue = commission.quoteValue === undefined
      ? undefined
      : splitDecimalAmount({
          amount: commission.quoteValue.amount,
          recoveryQuantity,
          fillQuantity: fill.quantity.amount,
        })
    const identity = {
      assetId: commission.amount.asset.id,
      assetCode: commission.amount.asset.code,
    }
    recovery.push({
      ...identity,
      amount: amount.recovery,
      ...(quoteValue === undefined
        ? {}
        : {
            quoteValue: {
              assetId: commission.quoteValue.asset.id,
              assetCode: commission.quoteValue.asset.code,
              amount: quoteValue.recovery,
            },
          }),
    })
    legacy.push({
      ...identity,
      amount: amount.legacy,
      ...(quoteValue === undefined
        ? {}
        : {
            quoteValue: {
              assetId: commission.quoteValue.asset.id,
              assetCode: commission.quoteValue.asset.code,
              amount: quoteValue.legacy,
            },
          }),
    })
  }
  return Object.freeze({
    recovery: freezeCommissionAllocations(recovery),
    legacy: freezeCommissionAllocations(legacy),
  })
}

function sumCommissionAmount({ commissions, assetId }) {
  let total = "0"
  for (const commission of commissions) {
    if (commission.assetId === assetId) {
      total = addDecimal({
        left: total,
        right: commission.amount,
      })
    }
  }
  return total
}

function createAllocationSide({ grossBaseQuantity, quoteProceeds, commissions, baseAssetId }) {
  const baseCommission = sumCommissionAmount({
    commissions,
    assetId: baseAssetId,
  })
  return Object.freeze({
    grossBaseQuantity,
    baseDebit: addDecimal({
      left: grossBaseQuantity,
      right: baseCommission,
    }),
    quoteProceeds,
    commissions,
  })
}

/**
 * Create immutable application-owned allocation metadata for one canonical
 * mixed SELL Fill. The original exchange Fill remains the sole execution fact.
 *
 * @param {object} input
 * @param {Fill} input.fill Canonical exchange execution.
 * @param {OrderRegistry} input.orderRegistry Immutable registry of acknowledged Harvester orders and ownership.
 * @param {string} input.recoveryQuantity Gross base quantity attributed to the RS recovery Position.
 * @param {string} input.legacyQuantity Gross base quantity attributed to the separate RS legacy projection.
 * @returns {object} Immutable allocation facts bound to the original Fill and order owner.
 * @throws {TypeError|RangeError|Error} If execution identity, ownership, commissions or split is invalid.
 */
export function createMixedSellFillAllocation({
  fill,
  orderRegistry,
  recoveryQuantity,
  legacyQuantity,
} = {}) {
  const { orderOwnership } = validateAllocationInput({
    fill,
    orderRegistry,
    recoveryQuantity,
    legacyQuantity,
  })
  const quoteProceeds = splitDecimalAmount({
    amount: fill.quoteQuantity.amount,
    recoveryQuantity,
    fillQuantity: fill.quantity.amount,
  })
  const commissions = allocateCommissions({
    fill,
    recoveryQuantity,
  })
  const recovery = createAllocationSide({
    grossBaseQuantity: recoveryQuantity,
    quoteProceeds: quoteProceeds.recovery,
    commissions: commissions.recovery,
    baseAssetId: fill.market.baseAsset.id,
  })
  const legacy = createAllocationSide({
    grossBaseQuantity: legacyQuantity,
    quoteProceeds: quoteProceeds.legacy,
    commissions: commissions.legacy,
    baseAssetId: fill.market.baseAsset.id,
  })
  const allocationFacts = {
    fillId: fill.id,
    fillFingerprint: createFillFingerprint({
      fill,
    }),
    marketId: fill.market.id,
    orderOwnership,
    recovery,
    legacy,
  }
  return Object.freeze({
    ...allocationFacts,
    allocationFingerprint: JSON.stringify(allocationFacts),
  })
}
