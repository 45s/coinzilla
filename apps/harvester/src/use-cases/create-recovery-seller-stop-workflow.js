import { createHash } from "node:crypto"
import { toResult } from "@coinzilla/utils"
import {
  createRecoverySellerStopDecision,
  createRecoverySellerStopState,
  latchRecoverySellerStop,
} from "../domain/strategies/recovery-seller/stop-decision.js"
import { recordSafetyBlockerRaised } from "./record-safety-control-facts.js"
import { resolveRecoverySellerStop } from "./resolve-recovery-seller-stop.js"

const RECOVERY_SELLER_STOP_REASON = "RECOVERY_SELLER_UNEXPECTED_CONDITION"

function validateOperationalStateStore({ operationalStateStore } = {}) {
  if (typeof operationalStateStore?.append !== "function" ||
      typeof operationalStateStore?.readAll !== "function") {
    throw new TypeError("Recovery Seller STOP workflow requires Operational State Store append/read capabilities")
  }
}

function resolveActiveRecoverySellerBlocker({ records } = {}) {
  if (!Array.isArray(records)) {
    throw new TypeError("Operational State Store records must be an array")
  }
  const resolvedBlockerIds = new Set(records
    .filter((record) => record.factType === "SAFETY_BLOCKER_RESOLVED")
    .map((record) => record.data?.blockerId))
  const activeBlockers = records.filter((record) =>
    record.factType === "SAFETY_BLOCKER_RAISED" &&
    record.data?.scope === "ACCOUNT" &&
    record.data?.reason === RECOVERY_SELLER_STOP_REASON &&
    !resolvedBlockerIds.has(record.data?.blockerId)
  )
  if (activeBlockers.length > 1) {
    throw new Error("Multiple unresolved Recovery Seller STOP blockers require manual reconciliation")
  }
  return activeBlockers[0]
}

function createRestoredStopState({ blocker } = {}) {
  if (!blocker) {
    return createRecoverySellerStopState()
  }
  const decision = createRecoverySellerStopDecision({
    explanation: "A persisted Recovery Seller safety blocker requires reconciliation and operator review",
  })
  return latchRecoverySellerStop({
    state: createRecoverySellerStopState(),
    decision,
  })
}

function normalizeOrderIdentity({ orderIdentity } = {}) {
  if (orderIdentity === undefined) {
    return null
  }
  if (!orderIdentity || typeof orderIdentity !== "object" ||
      typeof orderIdentity.clientOrderId !== "string" ||
      !orderIdentity.clientOrderId.trim() ||
      (orderIdentity.brokerOrderId !== undefined &&
       (typeof orderIdentity.brokerOrderId !== "string" || !orderIdentity.brokerOrderId.trim()))) {
    throw new TypeError("Recovery Seller STOP evidence requires a canonical order identity")
  }
  return Object.freeze({
    clientOrderId: orderIdentity.clientOrderId,
    ...(orderIdentity.brokerOrderId === undefined
      ? {}
      : { brokerOrderId: orderIdentity.brokerOrderId }),
  })
}

function createStopEvidenceDigest({ explanation, orderIdentity } = {}) {
  return createHash("sha256")
    .update(JSON.stringify({
      reason: RECOVERY_SELLER_STOP_REASON,
      explanation,
      orderIdentity,
    }))
    .digest("hex")
}

async function persistRecoverySellerBlocker({
  operationalStateStore,
  explanation,
  orderIdentity,
} = {}) {
  const evidenceDigest = createStopEvidenceDigest({
    explanation,
    orderIdentity,
  })
  return recordSafetyBlockerRaised({
    operationalStateStore,
    scope: "ACCOUNT",
    reason: RECOVERY_SELLER_STOP_REASON,
    evidenceDigest,
  })
}

function createStopLatch({
  operationalStateStore,
  getStopSnapshot,
  setStopSnapshot,
} = {}) {
  return async ({ explanation, orderIdentity } = {}) => {
    const current = getStopSnapshot()
    if (current.stopState.status === "STOPPED") {
      return toResult({
        data: {
          durable: true,
          duplicate: true,
          stopState: current.stopState,
          blockerId: current.blockerId,
        },
      })
    }
    const decision = createRecoverySellerStopDecision({
      explanation,
    })
    const normalizedIdentity = normalizeOrderIdentity({
      orderIdentity,
    })
    const persisted = await persistRecoverySellerBlocker({
      operationalStateStore,
      explanation,
      orderIdentity: normalizedIdentity,
    })
    if (persisted?.ok !== true || persisted.data?.durable !== true) {
      return persisted?.ok === false
        ? persisted
        : toResult({ error: new Error("Recovery Seller STOP blocker was not durably acknowledged") })
    }
    const stopState = latchRecoverySellerStop({
      state: current.stopState,
      decision,
    })
    const { blockerId } = persisted.data.record.data
    setStopSnapshot({
      stopState,
      blockerId,
    })
    return toResult({
      data: {
        durable: true,
        duplicate: persisted.data.duplicate === true,
        stopState,
        blockerId,
        record: persisted.data.record,
      },
    })
  }
}

function createStopResolver({
  operationalStateStore,
  getStopSnapshot,
  setStopSnapshot,
} = {}) {
  return async (evidence = {}) => {
    const current = getStopSnapshot()
    if (current.stopState.status !== "STOPPED" || !current.blockerId) {
      return toResult({ error: new Error("Recovery Seller has no persisted STOP blocker to resolve") })
    }
    const result = await resolveRecoverySellerStop({
      operationalStateStore,
      blockerId: current.blockerId,
      stopState: current.stopState,
      ...evidence,
    })
    if (result.ok) {
      setStopSnapshot({
        stopState: result.data.stopState,
        blockerId: null,
      })
    }
    return result
  }
}

export async function createRecoverySellerStopWorkflow({ operationalStateStore } = {}) {
  try {
    validateOperationalStateStore({
      operationalStateStore,
    })
    const read = await operationalStateStore.readAll()
    if (read?.ok !== true || !Array.isArray(read.data?.records)) {
      return read?.ok === false
        ? read
        : toResult({ error: new Error("Recovery Seller STOP startup requires a verified Operational State Store snapshot") })
    }
    const blocker = resolveActiveRecoverySellerBlocker({
      records: read.data.records,
    })
    let snapshot = {
      stopState: createRestoredStopState({ blocker }),
      blockerId: blocker?.data?.blockerId ?? null,
    }
    const getStopSnapshot = () => snapshot
    const setStopSnapshot = (next) => {
      snapshot = Object.freeze(next)
    }
    return toResult({
      data: Object.freeze({
        latch: createStopLatch({
          operationalStateStore,
          getStopSnapshot,
          setStopSnapshot,
        }),
        resolve: createStopResolver({
          operationalStateStore,
          getStopSnapshot,
          setStopSnapshot,
        }),
        getStopState: () => snapshot.stopState,
        getBlockerId: () => snapshot.blockerId,
      }),
    })
  } catch (error) {
    return toResult({ error })
  }
}
