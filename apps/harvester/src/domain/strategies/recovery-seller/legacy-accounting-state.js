import { Market } from "@coinzilla/entities"
import { addDecimal, assertDecimalString, compareDecimal, ensure, subtractDecimal } from "@coinzilla/utils"
import { Portfolio } from "../../portfolio/portfolio.js"
import { calculateVerifiedLegacySpotAllocation } from "./legacy-spot-allocation.js"
import { createLegacyPosition } from "./legacy-position.js"

function assertLegacyPositionAmounts(position) {
  for (const field of ["invested", "originalQuantity", "averageCost", "remainingQuantity"]) {
    assertDecimalString({
      value: position[field],
      field: `legacyPosition.${field}`,
    })
  }
  for (const field of ["invested", "originalQuantity", "averageCost"]) {
    if (compareDecimal({
      left: position[field],
      right: "0",
    }) <= 0) {
      throw new RangeError(`legacyPosition.${field} must be greater than zero`)
    }
  }
  if (compareDecimal({
    left: position.remainingQuantity,
    right: "0",
  }) < 0 || compareDecimal({
    left: position.remainingQuantity,
    right: position.originalQuantity,
  }) > 0) {
    throw new RangeError("Recovery Seller legacy remaining quantity must be within its original authorized quantity")
  }
  const originalPosition = createLegacyPosition({
    invested: position.invested,
    quantity: position.originalQuantity,
  })
  if (compareDecimal({
    left: position.averageCost,
    right: originalPosition.averageCost,
  }) !== 0) {
    throw new RangeError("Recovery Seller legacy average cost must remain the original invested/quantity basis")
  }
}

function assertLegacyAccountingFillIdentityShape(accounting) {
  ensure.array({
    value: accounting.appliedFillIds,
    name: "legacyAccounting.appliedFillIds",
    errMsg: "Recovery Seller legacy Fill identity history is invalid",
  })
  ensure.array({
    value: accounting.appliedFillFingerprints,
    name: "legacyAccounting.appliedFillFingerprints",
    errMsg: "Recovery Seller legacy Fill identity history is invalid",
  })
  if (accounting.appliedFillIds.length !== accounting.appliedFillFingerprints.length) {
    throw new TypeError("Recovery Seller legacy Fill identity history is invalid")
  }
}

function assertLegacyAccountingFillIdentityRecords(accounting) {
  const seenFillIds = new Set()
  for (const [index, item] of accounting.appliedFillFingerprints.entries()) {
    ensure.object({
      value: item,
      name: "legacyAccounting.appliedFillFingerprints[]",
      errMsg: "Recovery Seller legacy Fill identity history is invalid",
    })
    ensure.nonEmptyString({
      value: item.id,
      name: "legacyAccounting.appliedFillFingerprints[].id",
      errMsg: "Recovery Seller legacy Fill identity history is invalid",
    })
    ensure.nonEmptyString({
      value: item.fillFingerprint,
      name: "legacyAccounting.appliedFillFingerprints[].fillFingerprint",
      errMsg: "Recovery Seller legacy Fill identity history is invalid",
    })
    ensure.nonEmptyString({
      value: item.allocationFingerprint,
      name: "legacyAccounting.appliedFillFingerprints[].allocationFingerprint",
      errMsg: "Recovery Seller legacy Fill identity history is invalid",
    })
    if (item.id !== accounting.appliedFillIds[index] || seenFillIds.has(item.id)) {
      throw new TypeError("Recovery Seller legacy Fill identity history is invalid")
    }
    seenFillIds.add(item.id)
  }
}

function assertLegacyAccountingState(accounting) {
  for (const field of ["realizedQuoteProceeds", "realizedCostBasis", "realizedProfit"]) {
    assertDecimalString({
      value: accounting[field],
      field: `legacyAccounting.${field}`,
    })
  }
  assertLegacyAccountingFillIdentityShape(accounting)
  if (compareDecimal({
    left: accounting.realizedQuoteProceeds,
    right: "0",
  }) < 0 || compareDecimal({
    left: accounting.realizedCostBasis,
    right: "0",
  }) < 0) {
    throw new RangeError("Recovery Seller legacy proceeds and cost basis must be non-negative")
  }
  const expectedProfit = subtractDecimal({
    left: accounting.realizedQuoteProceeds,
    right: accounting.realizedCostBasis,
  })
  if (compareDecimal({
    left: accounting.realizedProfit,
    right: expectedProfit,
  }) !== 0) {
    throw new RangeError("Recovery Seller legacy realized profit does not match its proceeds and cost basis")
  }
  assertLegacyAccountingFillIdentityRecords(accounting)
}

function assertLegacyPositionRecord(record) {
  ensure.object({
    value: record,
    name: "initialLegacyPositions[]",
    errMsg: "Recovery Seller initialLegacyPositions must contain market, position and accounting records",
  })
  if (!(record.market instanceof Market)) {
    throw new TypeError("Recovery Seller initialLegacyPositions must contain market, position and accounting records")
  }
  ensure.object({
    value: record.position,
    name: "initialLegacyPositions[].position",
    errMsg: "Recovery Seller initialLegacyPositions must contain market, position and accounting records",
  })
  ensure.object({
    value: record.accounting,
    name: "initialLegacyPositions[].accounting",
    errMsg: "Recovery Seller initialLegacyPositions must contain market, position and accounting records",
  })
  assertLegacyPositionAmounts(record.position)
  assertLegacyAccountingState(record.accounting)
}

export function createLegacyPositionMap(records) {
  ensure.array({
    value: records,
    name: "initialLegacyPositions",
  })
  const positions = new Map()
  for (const record of records) {
    assertLegacyPositionRecord(record)
    if (positions.has(record.market.id)) {
      throw new TypeError(`Recovery Seller legacy Position already exists for market ${record.market.id}`)
    }
    positions.set(record.market.id, Object.freeze({
      market: record.market,
      position: record.position,
      accounting: record.accounting,
    }))
  }
  return positions
}

export function initializeLegacyPositionsTransition({ state, records } = {}) {
  ensure.array({
    value: records,
    name: "records",
    errMsg: "Recovery Seller legacy Position initialization requires a records array",
  })
  const nextLegacyPositions = new Map(state.legacyPositions)
  for (const record of records) {
    assertLegacyPositionRecord(record)
    if (nextLegacyPositions.has(record.market.id)) {
      throw new TypeError(`Recovery Seller legacy Position already exists for market ${record.market.id}`)
    }
    nextLegacyPositions.set(record.market.id, Object.freeze({
      market: record.market,
      position: record.position,
      accounting: record.accounting,
    }))
  }
  state.legacyPositions = nextLegacyPositions
  return Object.freeze({
    initialized: records.length,
  })
}

export function getLegacyPositionRecord({ state, marketId }) {
  ensure.nonEmptyString({
    value: marketId,
    name: "marketId",
    errMsg: "Recovery Seller legacy Position lookup requires marketId",
  })
  const record = state.legacyPositions.get(marketId)
  if (!record) {
    throw new TypeError(`Recovery Seller legacy Position is not configured for market ${marketId}`)
  }
  return record
}


export function createLegacySpotPositions({ legacyPositions }) {
  return [...legacyPositions.values()].map(({ market, position }) => ({
    market,
    originalQuantity: position.originalQuantity,
    remainingQuantity: position.remainingQuantity,
  }))
}

export function createAdditionalTrackedQuoteCashFlow({ legacyPositions }) {
  const totals = new Map()
  for (const { market, accounting } of legacyPositions.values()) {
    const assetId = market.quoteAsset.id
    totals.set(assetId, addDecimal({
      left: totals.get(assetId) ?? "0",
      right: accounting.realizedQuoteProceeds,
    }))
  }
  return Object.freeze([...totals.keys()].sort().map((assetId) => Object.freeze({
    assetId,
    amount: totals.get(assetId),
  })))
}

export function createAdditionalTrackedBaseQuantity({ state, balances, portfolio }) {
  if (portfolio !== state.portfolio) {
    throw new Error("Recovery Seller Spot allocation requires the current shared Portfolio snapshot")
  }
  return calculateVerifiedLegacySpotAllocation({
    balances,
    portfolio,
    legacyPositions: createLegacySpotPositions({
      legacyPositions: state.legacyPositions,
    }),
  })
}

