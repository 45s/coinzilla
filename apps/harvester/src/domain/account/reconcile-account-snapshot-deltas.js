import {
  addDecimal,
  assertDecimalString,
  compareDecimal,
  subtractDecimal,
  toResult,
} from "@coinzilla/utils"

const validateSnapshot = ({ snapshot, phase }) => {
  if (!snapshot || snapshot.phase !== phase) {
    throw new TypeError("Expected an " + phase + " account snapshot event")
  }
  if (!["COMPLETE", "INCOMPLETE"].includes(snapshot.auditStatus)) {
    throw new TypeError(phase + " snapshot auditStatus is invalid")
  }
  if (!Number.isSafeInteger(snapshot.sourceTime) || !Array.isArray(snapshot.balances)) {
    throw new TypeError(phase + " snapshot requires sourceTime and balances")
  }
  if (!Array.isArray(snapshot.auditReasons)) {
    throw new TypeError(phase + " snapshot auditReasons must be an array")
  }
  const balances = new Map()
  for (const [index, balance] of snapshot.balances.entries()) {
    const asset = balance?.asset
    if (typeof asset !== "string" || !asset.trim()) {
      throw new TypeError(phase + " snapshot asset " + index + " must have a non-empty code")
    }
    if (balances.has(asset)) throw new TypeError(phase + " snapshot contains duplicate asset " + asset)
    for (const field of ["free", "locked", "total"]) {
      assertDecimalString({ value: balance[field], field: phase + "." + asset + "." + field })
      if (compareDecimal({ left: balance[field], right: "0" }) < 0) {
        throw new RangeError(phase + " snapshot balance cannot be negative: " + asset + "." + field)
      }
    }
    if (compareDecimal({
      left: addDecimal({ left: balance.free, right: balance.locked }),
      right: balance.total,
    }) !== 0) {
      throw new TypeError(phase + " snapshot total does not equal free plus locked for " + asset)
    }
    balances.set(asset, balance)
  }
  return balances
}

/**
 * Compare two durable account snapshot events without mislabelling wallet
 * movement as strategy profit. Missing assets on either side are treated as
 * zero; each asset remains a separate reconciliation dimension.
 */
export function reconcileAccountSnapshotDeltas({ openingSnapshot, closingSnapshot } = {}) {
  try {
    const opening = validateSnapshot({ snapshot: openingSnapshot, phase: "OPENING" })
    const closing = validateSnapshot({ snapshot: closingSnapshot, phase: "CLOSING" })
    if (closingSnapshot.sourceTime < openingSnapshot.sourceTime) {
      throw new RangeError("CLOSING account snapshot predates OPENING snapshot")
    }
    const assets = [...new Set([...opening.keys(), ...closing.keys()])].sort()
    const assetDeltas = assets.map((asset) => {
      const before = opening.get(asset) ?? { free: "0", locked: "0", total: "0" }
      const after = closing.get(asset) ?? { free: "0", locked: "0", total: "0" }
      return {
        asset,
        opening: { free: before.free, locked: before.locked, total: before.total },
        closing: { free: after.free, locked: after.locked, total: after.total },
        delta: {
          free: subtractDecimal({ left: after.free, right: before.free }),
          locked: subtractDecimal({ left: after.locked, right: before.locked }),
          total: subtractDecimal({ left: after.total, right: before.total }),
        },
      }
    })
    const auditReasons = [
      ...(openingSnapshot.auditReasons ?? []).map((reason) => "OPENING:" + reason),
      ...(closingSnapshot.auditReasons ?? []).map((reason) => "CLOSING:" + reason),
    ]
    const auditStatus = openingSnapshot.auditStatus === "COMPLETE" &&
      closingSnapshot.auditStatus === "COMPLETE" ? "COMPLETE" : "INCOMPLETE"
    return toResult({
      data: {
        auditStatus,
        openingSourceTime: openingSnapshot.sourceTime,
        closingSourceTime: closingSnapshot.sourceTime,
        assetDeltas,
        auditReasons,
        profitAssessment: "NOT_DETERMINABLE_FROM_BALANCE_DELTAS_ALONE",
      },
    })
  } catch (error) {
    return toResult({ error })
  }
}
