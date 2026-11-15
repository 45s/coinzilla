import {
  assertDecimalString,
  addDecimal,
  compareDecimal,
  subtractDecimal,
} from "@coinzilla/utils"
import { Balance, Market } from "@coinzilla/entities"
import { Portfolio } from "../../portfolio/portfolio.js"

export const LEGACY_SPOT_ALLOCATION_ERROR_CODES = Object.freeze({
  BALANCE_MISSING: "HARVESTER_LEGACY_SPOT_BALANCE_MISSING",
  PORTFOLIO_CUSTODY_SHORTFALL: "HARVESTER_LEGACY_SPOT_PORTFOLIO_CUSTODY_SHORTFALL",
})

/**
 * A fail-closed error raised when legacy Spot custody cannot be verified.
 */
export class LegacySpotAllocationError extends Error {
  /**
   * @param {object} options
   * @param {string} options.code Stable allocation failure code.
   * @param {string} options.message Actionable diagnostic message.
   * @param {object} options.context Safe asset and quantity facts.
   */
  constructor({ code, message, context } = {}) {
    super(message)
    this.name = "LegacySpotAllocationError"
    this.code = code
    this.context = Object.freeze({ ...context })
  }
}

/**
 * @typedef {object} LegacySpotPosition
 * @property {Market} market Canonical market whose base asset is authorized.
 * @property {string} originalQuantity Original operator-authorized legacy quantity.
 * @property {string} remainingQuantity Remaining quantity; must not exceed originalQuantity.
 */

/**
 * Assert that a quantity is a non-negative decimal string.
 *
 * @param {object} options
 * @param {string} options.value Decimal quantity.
 * @param {string} options.field Diagnostic field name.
 */
function assertNonNegativeQuantity({ value, field }) {
  assertDecimalString({ value, field })
  if (compareDecimal({ left: value, right: "0" }) < 0) {
    throw new RangeError(field + " must be non-negative")
  }
}

/**
 * Index and validate one authoritative account snapshot's Spot balances.
 *
 * @param {object} options
 * @param {Balance[]} options.balances Canonical balances from the broker.
 * @returns {Map<string, Balance>} Balance by canonical asset ID.
 */
function createBalanceByAssetId({ balances }) {
  if (!Array.isArray(balances)) {
    throw new TypeError("balances must be an array of canonical Balance values")
  }

  const balanceByAssetId = new Map()
  for (const balance of balances) {
    if (!(balance instanceof Balance)) {
      throw new TypeError("Every account balance must be a canonical Balance")
    }
    const assetId = balance.total.asset.id
    if (balanceByAssetId.has(assetId)) {
      throw new TypeError(`Account snapshot contains duplicate balances for asset ${assetId}`)
    }
    assertNonNegativeQuantity({
      value: balance.free.amount,
      field: "balance.free.amount",
    })
    assertNonNegativeQuantity({
      value: balance.locked.amount,
      field: "balance.locked.amount",
    })
    balanceByAssetId.set(assetId, balance)
  }
  return balanceByAssetId
}

/**
 * Aggregate all strategy-owned Portfolio base quantities by canonical asset ID.
 *
 * @param {object} options
 * @param {Portfolio} options.portfolio Shared Portfolio.
 * @returns {Map<string, string>} Aggregate base quantity by asset ID.
 */
function aggregatePortfolioBaseByAssetId({ portfolio }) {
  if (!(portfolio instanceof Portfolio)) {
    throw new TypeError("portfolio must be a Portfolio")
  }

  const portfolioBaseByAssetId = new Map()
  for (const position of portfolio.positions) {
    const assetId = position.market.baseAsset.id
    const quantity = position.totalBaseQuantity.amount
    assertNonNegativeQuantity({
      value: quantity,
      field: "portfolio.position.totalBaseQuantity",
    })
    const current = portfolioBaseByAssetId.get(assetId) ?? "0"
    portfolioBaseByAssetId.set(assetId, addDecimal({
      left: current,
      right: quantity,
    }))
  }
  return portfolioBaseByAssetId
}

/**
 * Validate an authorized legacy position and return its remaining quantity.
 *
 * @param {object} options
 * @param {LegacySpotPosition} options.legacyPosition Legacy authorization and remainder.
 * @returns {string} Validated remaining legacy quantity.
 */
function validateLegacyPosition({ legacyPosition }) {
  if (!legacyPosition || typeof legacyPosition !== "object" || Array.isArray(legacyPosition)) {
    throw new TypeError("Every legacy position allocation must be an object")
  }
  if (!(legacyPosition.market instanceof Market)) {
    throw new TypeError("Every legacy position allocation requires a canonical Market")
  }

  assertDecimalString({
    value: legacyPosition.originalQuantity,
    field: "legacyPosition.originalQuantity",
  })
  assertNonNegativeQuantity({
    value: legacyPosition.remainingQuantity,
    field: "legacyPosition.remainingQuantity",
  })
  if (compareDecimal({
    left: legacyPosition.originalQuantity,
    right: "0",
  }) <= 0) {
    throw new RangeError("legacyPosition.originalQuantity must be greater than zero")
  }
  if (compareDecimal({
    left: legacyPosition.remainingQuantity,
    right: legacyPosition.originalQuantity,
  }) > 0) {
    throw new RangeError("legacyPosition.remainingQuantity cannot exceed originalQuantity")
  }
  return legacyPosition.remainingQuantity
}

/**
 * Aggregate operator-authorized legacy remainders by canonical base asset.
 *
 * @param {object} options
 * @param {LegacySpotPosition[]} options.legacyPositions Authorized legacy positions.
 * @returns {Map<string, string>} Authorized remaining quantity by asset ID.
 */
function aggregateAuthorizedLegacyByAssetId({ legacyPositions }) {
  if (!Array.isArray(legacyPositions)) {
    throw new TypeError("legacyPositions must be an array")
  }

  const authorizedLegacyByAssetId = new Map()
  for (const legacyPosition of legacyPositions) {
    const remainingQuantity = validateLegacyPosition({ legacyPosition })
    if (compareDecimal({
      left: remainingQuantity,
      right: "0",
    }) === 0) {
      continue
    }

    const assetId = legacyPosition.market.baseAsset.id
    const current = authorizedLegacyByAssetId.get(assetId) ?? "0"
    authorizedLegacyByAssetId.set(assetId, addDecimal({
      left: current,
      right: remainingQuantity,
    }))
  }
  return authorizedLegacyByAssetId
}

/**
 * Calculate the verified additional Spot quantity for one base asset.
 *
 * @param {object} options
 * @param {string} options.assetId Canonical base asset ID.
 * @param {Balance|undefined} options.balance Authoritative Spot balance.
 * @param {string} options.portfolioBaseQuantity Aggregate Portfolio quantity.
 * @param {string} options.authorizedQuantity Authorized remaining legacy quantity.
 * @returns {string|undefined} Verified allocation, or undefined when it is zero.
 */
function calculateAssetAllocation({
  assetId,
  balance,
  portfolioBaseQuantity,
  authorizedQuantity,
}) {
  if (!balance) {
    throw new LegacySpotAllocationError({
      code: LEGACY_SPOT_ALLOCATION_ERROR_CODES.BALANCE_MISSING,
      message: "Cannot verify legacy Spot custody because the account snapshot omits an authorized base asset",
      context: { assetId },
    })
  }

  const accountTotalQuantity = balance.total.amount
  if (compareDecimal({
    left: accountTotalQuantity,
    right: portfolioBaseQuantity,
  }) < 0) {
    throw new LegacySpotAllocationError({
      code: LEGACY_SPOT_ALLOCATION_ERROR_CODES.PORTFOLIO_CUSTODY_SHORTFALL,
      message: "Account Spot custody is below aggregate Portfolio base inventory",
      context: {
        assetId,
        accountTotalQuantity,
        portfolioBaseQuantity,
      },
    })
  }

  const untrackedSpotQuantity = subtractDecimal({
    left: accountTotalQuantity,
    right: portfolioBaseQuantity,
  })
  const allocatedQuantity = compareDecimal({
    left: authorizedQuantity,
    right: untrackedSpotQuantity,
  }) <= 0
    ? authorizedQuantity
    : untrackedSpotQuantity

  return compareDecimal({
    left: allocatedQuantity,
    right: "0",
  }) > 0
    ? allocatedQuantity
    : undefined
}

/**
 * Calculate the portion of authorized legacy inventory verified in Spot custody.
 *
 * The calculation aggregates every Portfolio Position by canonical base-asset ID,
 * subtracts that aggregate from the broker's total Spot balance, and caps the
 * remainder at the combined authorized legacy quantity. The returned quantities
 * remain outside Portfolio and do not include EARN/off-Spot inventory.
 *
 * @param {object} options
 * @param {Balance[]} options.balances Canonical balances from one broker account snapshot.
 * @param {Portfolio} options.portfolio Current shared Portfolio.
 * @param {LegacySpotPosition[]} [options.legacyPositions=[]] Active authorized legacy positions.
 * @returns {Array<{assetId: string, amount: string}>} Immutable additional Spot allocations by asset.
 * @throws {TypeError|RangeError|LegacySpotAllocationError} If inputs or Spot custody cannot be verified.
 */
export function calculateVerifiedLegacySpotAllocation({
  balances,
  portfolio,
  legacyPositions = [],
} = {}) {
  const balanceByAssetId = createBalanceByAssetId({ balances })
  const portfolioBaseByAssetId = aggregatePortfolioBaseByAssetId({ portfolio })
  const authorizedLegacyByAssetId = aggregateAuthorizedLegacyByAssetId({ legacyPositions })

  const allocations = []
  for (const assetId of [...authorizedLegacyByAssetId.keys()].sort()) {
    const amount = calculateAssetAllocation({
      assetId,
      balance: balanceByAssetId.get(assetId),
      portfolioBaseQuantity: portfolioBaseByAssetId.get(assetId) ?? "0",
      authorizedQuantity: authorizedLegacyByAssetId.get(assetId),
    })
    if (amount !== undefined) {
      allocations.push(Object.freeze({
        assetId,
        amount,
      }))
    }
  }

  return Object.freeze(allocations)
}
