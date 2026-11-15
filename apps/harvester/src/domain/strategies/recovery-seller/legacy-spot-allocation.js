import { compareDecimal } from "@coinzilla/utils"

export const LEGACY_SPOT_ALLOCATION_ERROR_CODES = Object.freeze({
  BALANCE_MISSING: "HARVESTER_LEGACY_SPOT_BALANCE_MISSING",
  PORTFOLIO_CUSTODY_SHORTFALL: "HARVESTER_LEGACY_SPOT_PORTFOLIO_CUSTODY_SHORTFALL",
})

export class LegacySpotAllocationError extends Error {
  constructor({ code, message, context } = {}) {
    super(message)
    this.name = "LegacySpotAllocationError"
    this.code = code
    this.context = Object.freeze({ ...context })
  }
}

/**
 * Calculate the authorized legacy quantity represented by verified Spot custody.
 *
 * @returns {Array<{assetId: string, amount: string}>} Separately tracked Spot allocations.
 */
export function calculateVerifiedLegacySpotAllocation() {
  return []
}
