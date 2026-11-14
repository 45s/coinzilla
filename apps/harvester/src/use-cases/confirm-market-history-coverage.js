import { isCanonicalNonNegativeSafeInteger } from "../domain/time/is-canonical-non-negative-safe-integer.js"
import { toResult } from "@coinzilla/utils"
import { readMarketHistoryCoverage } from "./read-market-history-coverage.js"
import { recordMarketHistoryCoverage } from "./record-market-history-coverage.js"

const SHA256_PATTERN = /^[a-f0-9]{64}$/

function createError(message, code) {
  const error = new Error(message)
  error.code = code
  return error
}

function matchesCoverage({ coverage, evidence }) {
  return coverage?.baselineFactId === evidence.factId &&
    coverage.symbol === evidence.symbol &&
    coverage.coveredFromTime === evidence.coveredFromTime &&
    coverage.verifiedAt === evidence.verifiedAt &&
    coverage.evidenceDigest === evidence.evidenceDigest &&
    coverage.verifiedBy === evidence.verifiedBy
}

/**
 * Confirm the first market-history baseline only after a complete one-market
 * recovery reconciliation succeeds.
 *
 * The fact identity is deterministic per symbol so concurrent attempts with
 * conflicting evidence collide at the durable store's idempotency boundary.
 * Existing coverage for the symbol is never silently replaced or narrowed.
 *
 * @param {object} options
 * @param {object} options.operationalStateStore - ADR-0001 durable-fact read/append port.
 * @param {string} options.symbol - Canonical uppercase target market symbol.
 * @param {number} options.coveredFromTime - Earliest operator-reviewed history timestamp (Unix ms).
 * @param {number} options.verifiedAt - Operator verification timestamp (Unix ms).
 * @param {string} options.evidenceDigest - SHA-256 digest of the reviewed evidence artifact.
 * @param {string} options.verifiedBy - Stable, non-secret operator identity.
 * @param {Function} options.reconcileMarketState - One-market read-only reconciliation use case.
 * @returns {Promise<object>} Confirmation outcome; no fact is appended unless reconciliation is ready.
 */
export async function confirmMarketHistoryCoverage({
  operationalStateStore,
  symbol,
  coveredFromTime,
  verifiedAt,
  evidenceDigest,
  verifiedBy,
  reconcileMarketState,
} = {}) {
  try {
    if (typeof operationalStateStore?.readAll !== "function" ||
        typeof operationalStateStore?.append !== "function") {
      throw new TypeError("confirmMarketHistoryCoverage requires the ADR-0001 durable-facts read/append port")
    }
    if (typeof symbol !== "string" || !/^[A-Z0-9]{3,30}$/.test(symbol)) {
      throw new TypeError("Market-history coverage symbol must be canonical uppercase alphanumeric")
    }
    if (!isCanonicalNonNegativeSafeInteger(coveredFromTime) ||
        !isCanonicalNonNegativeSafeInteger(verifiedAt) ||
        verifiedAt < coveredFromTime) {
      throw new TypeError("Market-history coverage timestamps must be non-negative safe integers other than negative zero with verifiedAt >= coveredFromTime")
    }
    if (typeof evidenceDigest !== "string" || !SHA256_PATTERN.test(evidenceDigest)) {
      throw new TypeError("Market-history coverage evidenceDigest must be a SHA-256 digest")
    }
    if (typeof verifiedBy !== "string" || !verifiedBy.trim() || verifiedBy !== verifiedBy.trim()) {
      throw new TypeError("Market-history coverage verifiedBy must be a canonical non-empty string")
    }
    if (typeof reconcileMarketState !== "function") {
      throw new TypeError("confirmMarketHistoryCoverage requires a one-market reconciliation callback")
    }

    const factId = "market-history-coverage:" + symbol + ":baseline"
    const evidence = {
      factId,
      symbol,
      coveredFromTime,
      verifiedAt,
      evidenceDigest,
      verifiedBy,
    }

    const ledgerResult = await operationalStateStore.readAll()
    if (ledgerResult?.ok !== true) {
      return toResult({
        errors: ledgerResult?.errors ?? [new Error("Durable-fact ledger could not be verified")],
      })
    }
    const records = ledgerResult.data?.records
    if (!Array.isArray(records)) {
      throw new TypeError("Durable-fact read result must contain a records array")
    }
    const existingCoverage = records.filter((record) =>
      record?.factType === "MARKET_HISTORY_COVERAGE_CONFIRMED" &&
      record.data?.symbol === symbol
    )
    if (existingCoverage.length > 0) {
      const currentResult = await readMarketHistoryCoverage({ operationalStateStore, symbol })
      if (currentResult?.ok !== true) {
        return toResult({
          errors: currentResult?.errors ?? [new Error("Existing market-history coverage could not be verified")],
        })
      }
      if (matchesCoverage({ coverage: currentResult.data, evidence })) {
        return toResult({
          data: Object.freeze({
            confirmed: true,
            alreadyConfirmed: true,
            coverage: currentResult.data,
          }),
        })
      }
      return toResult({
        error: createError(
          "A different market-history baseline is already confirmed for " + symbol,
          "MARKET_HISTORY_COVERAGE_ALREADY_CONFIRMED",
        ),
      })
    }

    const historyRetentionEvidence = {
      factType: "MARKET_HISTORY_COVERAGE_CONFIRMED",
      baselineFactId: factId,
      symbol,
      coveredFromTime,
      verifiedAt,
      evidenceDigest,
      verifiedBy,
    }
    const reconciliation = await reconcileMarketState({ historyRetentionEvidence })
    if (reconciliation?.ok !== true) {
      return toResult({
        errors: reconciliation?.errors ?? [new Error("One-market recovery reconciliation failed")],
      })
    }
    const result = reconciliation.data
    if (result?.symbol !== symbol) {
      throw new Error("One-market reconciliation returned evidence for a different market")
    }
    const audit = result.audit
    const auditReady = result.ready === true &&
      audit?.skipped !== true &&
      audit?.targetMarketBlocked !== true &&
      audit?.tradeHistory?.complete === true &&
      audit?.tradeHistory?.historyRetentionBaselineFactId === factId
    if (!auditReady) {
      return toResult({
        data: Object.freeze({
          confirmed: false,
          alreadyConfirmed: false,
          status: result.status ?? "BLOCKED",
          reason: result.reason ?? "RECOVERY_AUDIT_NOT_READY",
          audit,
        }),
      })
    }

    const appendResult = await recordMarketHistoryCoverage({
      operationalStateStore,
      factId,
      symbol,
      coveredFromTime,
      verifiedAt,
      evidenceDigest,
      verifiedBy,
    })
    if (appendResult?.ok !== true || appendResult.data?.durable !== true) {
      return appendResult?.ok === false
        ? appendResult
        : toResult({ error: new Error("Market-history coverage fact was not durably committed") })
    }

    const readback = await readMarketHistoryCoverage({ operationalStateStore, symbol })
    if (readback?.ok !== true) {
      return toResult({
        errors: readback?.errors ?? [new Error("Committed market-history coverage could not be read back")],
      })
    }
    if (!matchesCoverage({ coverage: readback.data, evidence })) {
      throw new Error("Committed market-history coverage does not match the reviewed evidence")
    }

    return toResult({
      data: Object.freeze({
        confirmed: true,
        alreadyConfirmed: false,
        audit,
        coverage: readback.data,
      }),
    })
  } catch (error) {
    return toResult({ error })
  }
}
