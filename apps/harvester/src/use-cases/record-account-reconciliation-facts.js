import { createHash } from "node:crypto"
import { toResult } from "@coinzilla/utils"

const requireAppendPort = ({ durableFactsStore, operation }) => {
  if (typeof durableFactsStore?.append !== "function") {
    throw new TypeError(operation + " requires a durable-fact append port")
  }
}

const requireDurableAppend = ({ result, operation }) => {
  if (result?.ok !== true || result.data?.durable !== true) {
    return toResult({
      errors: result?.errors?.length
        ? result.errors
        : [new Error(operation + " append did not confirm durable commitment")],
    })
  }
  return result
}

/**
 * Persist a complete account-balance reconciliation snapshot.
 *
 * The stable identity is scoped to phase, exchange source timestamp, and the
 * exact set of asset codes. Reusing that identity with changed balances is an
 * integrity conflict, not an update. The input must already be the sanitized
 * DTO produced by mapAccountSnapshotCapturedData.
 *
 * @param {object} options
 * @param {object} options.durableFactsStore Initialized ADR-0001 append port.
 * @param {object} options.data Sanitized account snapshot DTO.
 * @returns {Promise<object>} Durable append result.
 */
export async function recordAccountSnapshotCaptured({ durableFactsStore, data } = {}) {
  try {
    requireAppendPort({ durableFactsStore, operation: "recordAccountSnapshotCaptured" })
    if (!data || typeof data !== "object" || Array.isArray(data) ||
        typeof data.phase !== "string" || !Number.isSafeInteger(data.sourceTime) ||
        !Array.isArray(data.balances)) {
      throw new TypeError("recordAccountSnapshotCaptured requires a mapped account snapshot DTO")
    }
    const assets = data.balances.map((balance) => balance?.asset)
    if (assets.some((asset) => typeof asset !== "string" || !/^[A-Z0-9]{2,32}$/.test(asset)) ||
        new Set(assets).size !== assets.length) {
      throw new TypeError("recordAccountSnapshotCaptured requires unique canonical asset codes")
    }
    const assetSetDigest = createHash("sha256").update([...assets].sort().join("\\0")).digest("hex")
    const result = await durableFactsStore.append({
      factId: "account-snapshot:" + data.phase + ":" + data.sourceTime + ":" + assetSetDigest,
      factType: "ACCOUNT_SNAPSHOT_CAPTURED",
      data,
    })
    return requireDurableAppend({ result, operation: "Account snapshot" })
  } catch (error) {
    return toResult({ error })
  }
}

/**
 * Persist an account-wide open-order reconciliation snapshot.
 *
 * The phase/observation-time identity is immutable. An exact retry is
 * idempotent; a different order set at the same observation time is rejected.
 * The input must already be the sanitized DTO produced by
 * mapAccountOpenOrdersCapturedData.
 *
 * @param {object} options
 * @param {object} options.durableFactsStore Initialized ADR-0001 append port.
 * @param {object} options.data Sanitized account-wide open-order DTO.
 * @returns {Promise<object>} Durable append result.
 */
export async function recordAccountOpenOrdersCaptured({ durableFactsStore, data } = {}) {
  try {
    requireAppendPort({ durableFactsStore, operation: "recordAccountOpenOrdersCaptured" })
    if (!data || typeof data !== "object" || Array.isArray(data) ||
        typeof data.phase !== "string" || !Number.isSafeInteger(data.observedAt)) {
      throw new TypeError("recordAccountOpenOrdersCaptured requires a mapped account open-order DTO")
    }
    const result = await durableFactsStore.append({
      factId: "account-open-orders:" + data.phase + ":" + data.observedAt,
      factType: "ACCOUNT_OPEN_ORDERS_CAPTURED",
      data,
    })
    return requireDurableAppend({ result, operation: "Account open-orders snapshot" })
  } catch (error) {
    return toResult({ error })
  }
}
