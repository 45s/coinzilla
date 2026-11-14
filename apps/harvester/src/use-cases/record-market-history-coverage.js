import { isCanonicalNonNegativeSafeInteger } from "../domain/time/is-canonical-non-negative-safe-integer.js"
import { toResult } from "@coinzilla/utils"

/**
 * Persist an operator-verified market-history coverage fact.
 *
 * The evidence digest must identify the reviewed exchange-history/reconciliation
 * artifact. This use case never initializes a missing ledger and delegates the
 * append acknowledgement to the ADR-0001 Operational State Store.
 *
 * @param {object} options
 * @param {object} options.operationalStateStore - ADR-0001 Operational State Store port.
 * @param {string} options.factId - Stable identity for this coverage confirmation.
 * @param {string} options.symbol - Canonical market symbol.
 * @param {number} options.coveredFromTime - Earliest verified history timestamp (Unix ms).
 * @param {number} options.verifiedAt - Operator verification timestamp (Unix ms).
 * @param {string} options.evidenceDigest - SHA-256 digest of the reviewed evidence artifact.
 * @param {string} options.verifiedBy - Stable, non-secret operator identity.
 * @returns {Promise<object>} Durable append result.
 */
export async function recordMarketHistoryCoverage({
  operationalStateStore,
  factId,
  symbol,
  coveredFromTime,
  verifiedAt,
  evidenceDigest,
  verifiedBy,
} = {}) {
  try {
    if (typeof operationalStateStore?.append !== "function") {
      throw new TypeError("recordMarketHistoryCoverage requires a Operational State Store append capability")
    }
    if (typeof symbol !== "string" || !/^[A-Z0-9]{3,30}$/.test(symbol)) {
      throw new TypeError("Market-history coverage symbol must be canonical uppercase alphanumeric")
    }
    if (!isCanonicalNonNegativeSafeInteger(coveredFromTime) ||
        !isCanonicalNonNegativeSafeInteger(verifiedAt) ||
        verifiedAt < coveredFromTime) {
      throw new TypeError("Market-history coverage timestamps must be non-negative safe integers other than negative zero with verifiedAt >= coveredFromTime")
    }
    if (typeof evidenceDigest !== "string" || !/^[a-f0-9]{64}$/.test(evidenceDigest)) {
      throw new TypeError("Market-history coverage evidenceDigest must be a SHA-256 digest")
    }
    if (typeof verifiedBy !== "string" || !verifiedBy.trim() || verifiedBy !== verifiedBy.trim()) {
      throw new TypeError("Market-history coverage verifiedBy must be a canonical non-empty string")
    }
    return await operationalStateStore.append({
      factId,
      factType: "MARKET_HISTORY_COVERAGE_CONFIRMED",
      data: {
        symbol,
        coveredFromTime,
        verifiedAt,
        evidenceDigest,
        verifiedBy,
      },
    })
  } catch (error) {
    return toResult({ error })
  }
}
