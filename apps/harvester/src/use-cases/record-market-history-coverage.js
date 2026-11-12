import { toResult } from "@coinzilla/utils"

/**
 * Persist an operator-verified market-history coverage fact.
 *
 * The evidence digest must identify the reviewed exchange-history/reconciliation
 * artifact. This use case never initializes a missing ledger and delegates the
 * append acknowledgement to the ADR-0001 durable-fact store.
 *
 * @param {object} options
 * @param {object} options.durableFactsStore - ADR-0001 durable-fact port.
 * @param {string} options.factId - Stable identity for this coverage confirmation.
 * @param {string} options.symbol - Canonical market symbol.
 * @param {number} options.coveredFromTime - Earliest verified history timestamp (Unix ms).
 * @param {number} options.verifiedAt - Operator verification timestamp (Unix ms).
 * @param {string} options.evidenceDigest - SHA-256 digest of the reviewed evidence artifact.
 * @param {string} options.verifiedBy - Stable, non-secret operator identity.
 * @returns {Promise<object>} Durable append result.
 */
export async function recordMarketHistoryCoverage({
  durableFactsStore,
  factId,
  symbol,
  coveredFromTime,
  verifiedAt,
  evidenceDigest,
  verifiedBy,
} = {}) {
  try {
    if (typeof durableFactsStore?.append !== "function") {
      throw new TypeError("recordMarketHistoryCoverage requires a durable-fact append port")
    }
    if (typeof symbol !== "string" || !/^[A-Z0-9]{3,30}$/.test(symbol)) {
      throw new TypeError("Market-history coverage symbol must be canonical uppercase alphanumeric")
    }
    if (!Number.isSafeInteger(coveredFromTime) || coveredFromTime < 0 ||
        !Number.isSafeInteger(verifiedAt) || verifiedAt < coveredFromTime) {
      throw new TypeError("Market-history coverage timestamps must be non-negative safe integers with verifiedAt >= coveredFromTime")
    }
    if (typeof evidenceDigest !== "string" || !/^[a-f0-9]{64}$/.test(evidenceDigest)) {
      throw new TypeError("Market-history coverage evidenceDigest must be a SHA-256 digest")
    }
    if (typeof verifiedBy !== "string" || !verifiedBy.trim() || verifiedBy !== verifiedBy.trim()) {
      throw new TypeError("Market-history coverage verifiedBy must be a canonical non-empty string")
    }
    return await durableFactsStore.append({
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
