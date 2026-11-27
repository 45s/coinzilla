import { createHash } from "node:crypto"
import { ensure, toResult } from "@coinzilla/utils"
import {
  createRecoverySellerStopDecision,
  createRecoverySellerStopState,
  latchRecoverySellerStop,
} from "../domain/strategies/recovery-seller/stop-decision.js"
import { recordSafetyBlockerRaised } from "./record-safety-control-facts.js"
import { resolveRecoverySellerStop } from "./resolve-recovery-seller-stop.js"

const RECOVERY_SELLER_STOP_REASON = "RECOVERY_SELLER_UNEXPECTED_CONDITION"
const RECOVERY_SELLER_STOP_RESTART_PENDING_REASON = "RECOVERY_SELLER_STOP_RESTART_PENDING"

function validateOperationalStateStore({ operationalStateStore } = {}) {
  ensure.object({
    value: operationalStateStore,
    name: "operationalStateStore",
    errMsg: "Recovery Seller STOP workflow requires Operational State Store append/read capabilities",
  })
  ensure.function({
    value: operationalStateStore.append,
    name: "operationalStateStore.append",
    errMsg: "Recovery Seller STOP workflow requires Operational State Store append/read capabilities",
  })
  ensure.function({
    value: operationalStateStore.readAll,
    name: "operationalStateStore.readAll",
    errMsg: "Recovery Seller STOP workflow requires Operational State Store append/read capabilities",
  })
}

function resolveActiveRecoverySellerBlocker({ records } = {}) {
  ensure.array({
    value: records,
    name: "records",
    errMsg: "Operational State Store records must be an array",
  })
  const resolvedBlockerIds = new Set(records
    .filter((record) => record.factType === "SAFETY_BLOCKER_RESOLVED")
    .map((record) => record.data?.blockerId))
  const isRecoverySellerStopReason = (reason) => [
    RECOVERY_SELLER_STOP_REASON,
    RECOVERY_SELLER_STOP_RESTART_PENDING_REASON,
  ].includes(reason)
  const isRecoverySellerStopBlocker = (record) =>
    record.factType === "SAFETY_BLOCKER_RAISED" &&
    (record.data?.producer === "RECOVERY_SELLER_STOP_WORKFLOW" ||
      record.data?.producer === undefined) &&
    record.data?.scope === "ACCOUNT" &&
    isRecoverySellerStopReason(record.data?.reason)
  const activeBlockers = records.filter((record) =>
    isRecoverySellerStopBlocker(record) &&
    !resolvedBlockerIds.has(record.data?.blockerId)
  )
  const pendingBlockers = activeBlockers.filter((record) =>
    record.data?.reason === RECOVERY_SELLER_STOP_RESTART_PENDING_REASON
  )
  if (pendingBlockers.length > 1) {
    throw new Error("Multiple pending Recovery Seller controlled restarts require manual reconciliation")
  }
  if (pendingBlockers.length === 1) {
    return pendingBlockers[0]
  }
  if (activeBlockers.length > 1) {
    throw new Error("Multiple unresolved Recovery Seller STOP blockers require manual reconciliation")
  }
  if (activeBlockers.length === 1) {
    return activeBlockers[0]
  }
  const previouslyResolvedStop = records.filter((record) =>
    isRecoverySellerStopBlocker(record) &&
    record.data?.reason === RECOVERY_SELLER_STOP_REASON &&
    resolvedBlockerIds.has(record.data?.blockerId)
  ).at(-1)
  return previouslyResolvedStop
    ? { ...previouslyResolvedStop, resolutionPendingRestart: true }
    : undefined
}

function createRestoredStopState({ blocker } = {}) {
  if (!blocker) {
    return createRecoverySellerStopState()
  }
  const explanation = blocker.resolutionPendingRestart === true ||
    blocker.data?.reason === RECOVERY_SELLER_STOP_RESTART_PENDING_REASON
    ? "Recovery Seller STOP was durably resolved; controlled restart acceptance and fresh PREFLIGHT are still required"
    : "A persisted Recovery Seller safety blocker requires reconciliation and operator review"
  const decision = createRecoverySellerStopDecision({ explanation })
  return latchRecoverySellerStop({
    state: createRecoverySellerStopState(),
    decision,
  })
}

function normalizeOrderIdentity({ orderIdentity } = {}) {
  if (orderIdentity === undefined) {
    return null
  }
  ensure.object({
    value: orderIdentity,
    name: "orderIdentity",
    errMsg: "Recovery Seller STOP evidence requires a canonical order identity",
  })
  ensure.nonEmptyString({
    value: orderIdentity.clientOrderId,
    name: "orderIdentity.clientOrderId",
    errMsg: "Recovery Seller STOP evidence requires a canonical order identity",
  })
  if (orderIdentity.brokerOrderId !== undefined) {
    ensure.nonEmptyString({
      value: orderIdentity.brokerOrderId,
      name: "orderIdentity.brokerOrderId",
      errMsg: "Recovery Seller STOP evidence requires a canonical order identity",
    })
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
    producer: "RECOVERY_SELLER_STOP_WORKFLOW",
    scope: "ACCOUNT",
    reason: RECOVERY_SELLER_STOP_REASON,
    evidenceDigest,
  })
}

async function persistStopLatch({
  operationalStateStore,
  explanation,
  orderIdentity,
  current,
  setStopSnapshot,
  setSellAdmissionBlocked,
} = {}) {
  const decision = createRecoverySellerStopDecision({ explanation })
  const normalizedIdentity = normalizeOrderIdentity({ orderIdentity })
  const persisted = await persistRecoverySellerBlocker({
    operationalStateStore,
    explanation,
    orderIdentity: normalizedIdentity,
  })
  if (persisted?.ok !== true || persisted.data?.durable !== true) {
    return persisted?.ok === false
      ? persisted
      : toResult({
          error: new Error("Recovery Seller STOP blocker was not durably acknowledged"),
        })
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
  setSellAdmissionBlocked(false)
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

function createStopLatch({
  operationalStateStore,
  getStopSnapshot,
  setStopSnapshot,
  setBuyAdmissionBlocked,
  setSellAdmissionBlocked,
} = {}) {
  let pendingLatch = null
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
    if (pendingLatch) {
      return pendingLatch
    }
    setBuyAdmissionBlocked(true)
    setSellAdmissionBlocked(true)
    pendingLatch = persistStopLatch({
      operationalStateStore,
      explanation,
      orderIdentity,
      current,
      setStopSnapshot,
      setSellAdmissionBlocked,
    })
    try {
      return await pendingLatch
    } finally {
      pendingLatch = null
    }
  }
}

function createStopResolver({
  operationalStateStore,
  getStopSnapshot,
  setStopSnapshot,
  setBuyAdmissionBlocked,
  setSellAdmissionBlocked,
} = {}) {
  return async (evidence = {}) => {
    const current = getStopSnapshot()
    if (current.resolutionPendingRestart === true) {
      return toResult({
        error: new Error("Recovery Seller STOP requires explicit controlled restart acceptance and fresh PREFLIGHT"),
      })
    }
    if (current.stopState.status !== "STOPPED" || !current.blockerId) {
      return toResult({ error: new Error("Recovery Seller has no persisted STOP blocker to resolve") })
    }
    const result = await resolveRecoverySellerStop({
      operationalStateStore,
      blockerId: current.blockerId,
      stopState: current.stopState,
      operatorIdentity: evidence.operatorIdentity,
      operatorId: evidence.operatorId,
      actionId: evidence.actionId,
      resolutionReason: evidence.resolutionReason,
      causeFixed: evidence.causeFixed,
      reconciliation: evidence.reconciliation,
      accounting: evidence.accounting,
    })
    const pendingRestartBlockerId = result.data?.pendingRestartBlockerId
    if (pendingRestartBlockerId) {
      setStopSnapshot({
        stopState: current.stopState,
        blockerId: pendingRestartBlockerId,
        resolutionPendingRestart: true,
      })
      setBuyAdmissionBlocked(true)
      setSellAdmissionBlocked(true)
    }
    if (!result.ok) {
      return result
    }
    return toResult({
      data: {
        ...result.data,
        stopState: current.stopState,
        controlledRestartRequired: true,
      },
    })
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
      resolutionPendingRestart: blocker?.resolutionPendingRestart === true ||
        blocker?.data?.reason === RECOVERY_SELLER_STOP_RESTART_PENDING_REASON,
    }
    let buyAdmissionBlocked = Boolean(blocker)
    let sellAdmissionBlocked = snapshot.resolutionPendingRestart
    const getStopSnapshot = () => snapshot
    const setStopSnapshot = (next) => {
      snapshot = Object.freeze(next)
    }
    const setBuyAdmissionBlocked = (blocked) => {
      buyAdmissionBlocked = blocked === true
    }
    const setSellAdmissionBlocked = (blocked) => {
      sellAdmissionBlocked = blocked === true
    }
    return toResult({
      data: Object.freeze({
        latch: createStopLatch({
          operationalStateStore,
          getStopSnapshot,
          setStopSnapshot,
          setBuyAdmissionBlocked,
          setSellAdmissionBlocked,
        }),
        resolve: createStopResolver({
          operationalStateStore,
          getStopSnapshot,
          setStopSnapshot,
          setBuyAdmissionBlocked,
          setSellAdmissionBlocked,
        }),
        getStopState: () => snapshot.stopState,
        getState: () => snapshot.stopState,
        getBlockerId: () => snapshot.blockerId,
        isResolutionPendingRestart: () => snapshot.resolutionPendingRestart === true,
        isBuyAdmissionBlocked: () => buyAdmissionBlocked,
        isSellAdmissionBlocked: () => sellAdmissionBlocked,
      }),
    })
  } catch (error) {
    return toResult({ error })
  }
}
