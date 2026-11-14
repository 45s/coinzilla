import { toResult } from "@coinzilla/utils"

function validateCoverageSequence({ records, symbol }) {
  let previous
  for (const record of records) {
    if (record.factType !== "MARKET_HISTORY_COVERAGE_CONFIRMED" || record.data?.symbol !== symbol) continue
    if (previous && record.data.coveredFromTime > previous.data.coveredFromTime) {
      throw new Error("Durable market-history coverage narrows the verified history window for " + symbol)
    }
    if (previous && record.data.verifiedAt < previous.data.verifiedAt) {
      throw new Error("Durable market-history coverage verification timestamp regresses for " + symbol)
    }
    previous = record
  }
  return previous
}

/**
 * Read and project the latest verified market-history coverage fact.
 *
 * readAll() validates the complete fact and committed-head streams before any
 * coverage record is trusted. The projection then enforces monotonic coverage
 * for the requested symbol and returns the shape consumed by the recovery audit.
 *
 * @param {object} options
 * @param {object} options.operationalStateStore - ADR-0001 durable-fact port.
 * @param {string} options.symbol - Canonical market symbol.
 * @returns {Promise<object>} Projected history-retention evidence.
 */
export async function readMarketHistoryCoverage({ operationalStateStore, symbol } = {}) {
  try {
    if (typeof operationalStateStore?.readAll !== "function") {
      throw new TypeError("readMarketHistoryCoverage requires a durable-fact read port")
    }
    if (typeof symbol !== "string" || !/^[A-Z0-9]{3,30}$/.test(symbol)) {
      throw new TypeError("Market-history coverage symbol must be canonical uppercase alphanumeric")
    }
    const result = await operationalStateStore.readAll()
    if (!result.ok) {
      return toResult({ errors: result.errors })
    }
    const records = result.data?.records
    if (!Array.isArray(records)) {
      throw new TypeError("Durable-fact read result must contain a records array")
    }
    const latest = validateCoverageSequence({ records, symbol })
    if (!latest) {
      throw new Error("No durable history-coverage fact exists for " + symbol)
    }
    return toResult({
      data: Object.freeze({
        factType: latest.factType,
        baselineFactId: latest.factId,
        symbol: latest.data.symbol,
        coveredFromTime: latest.data.coveredFromTime,
        verifiedAt: latest.data.verifiedAt,
        evidenceDigest: latest.data.evidenceDigest,
        verifiedBy: latest.data.verifiedBy,
      }),
    })
  } catch (error) {
    return toResult({ error })
  }
}
