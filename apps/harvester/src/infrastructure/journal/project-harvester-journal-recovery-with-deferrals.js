import { toResult } from "@coinzilla/utils"
import {
  projectHarvesterJournalRecovery as projectHarvesterJournalRecoveryCore,
} from "./project-harvester-journal-recovery.js"

const DEFERRED_EVENT = "order.submission_deferred"
const SUBMISSION_REQUESTED_EVENT = "order.submission_requested"
const REASON_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/

function requireDeferralData({ payload } = {}) {
  const data = payload?.data
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new TypeError("Local submission deferral requires an object payload")
  }
  const reason = typeof data.reason === "string" ? data.reason.trim() : ""
  if (!REASON_PATTERN.test(reason)) {
    throw new TypeError("Local submission deferral reason must be a bounded uppercase code")
  }
  return {
    ...data,
    reason,
  }
}

function validateLocalDeferralTransitions({ records } = {}) {
  const states = new Map()
  for (const record of records) {
    const payload = record?.payload
    const name = payload?.name
    const clientOrderId = payload?.data?.clientOrderId
    if (typeof clientOrderId !== "string" || !clientOrderId.trim()) {
      continue
    }
    const state = states.get(clientOrderId)
    if (name === SUBMISSION_REQUESTED_EVENT) {
      if (state !== undefined && state !== "PENDING") {
        throw new Error("A terminal clientOrderId cannot be requested again")
      }
      states.set(clientOrderId, "PENDING")
      continue
    }
    if (name === DEFERRED_EVENT) {
      if (state !== "PENDING") {
        throw new Error("Local deferral must follow a durable pending submission request")
      }
      requireDeferralData({ payload })
      states.set(clientOrderId, "DEFERRED")
      continue
    }
    if (state === "DEFERRED") {
      throw new Error("A locally deferred submission cannot have later order lifecycle events")
    }
    if (state === "PENDING") {
      states.set(clientOrderId, "EXCHANGE_OR_TERMINAL_OUTCOME")
    }
  }
}

function normalizeSubmissionDeferralRecords({ records } = {}) {
  return records.map((record) => {
    if (record?.payload?.name !== DEFERRED_EVENT) {
      return record
    }
    const data = requireDeferralData({ payload: record.payload })
    return {
      ...record,
      payload: {
        ...record.payload,
        name: "order.submission_failed",
        data: {
          ...data,
          outcome: "REJECTED",
        },
      },
    }
  })
}

function projectDeferredSubmissions({ records } = {}) {
  const deferredSubmissions = []
  for (let sequence = 0; sequence < records.length; sequence += 1) {
    const record = records[sequence]
    if (record?.payload?.name !== DEFERRED_EVENT) {
      continue
    }
    const data = requireDeferralData({ payload: record.payload })
    const fileName = record.position?.fileName
    if (typeof fileName !== "string" || !fileName.trim()) {
      throw new TypeError("Deferred submission Journal record requires a file name")
    }
    deferredSubmissions.push(Object.freeze({
      fileName,
      sequence,
      clientOrderId: data.clientOrderId,
      symbol: data.symbol,
      side: data.side,
      type: data.type,
      price: data.price,
      quantity: data.quantity,
      reason: data.reason,
    }))
  }
  return Object.freeze(deferredSubmissions)
}

export function projectHarvesterJournalRecovery({ records } = {}) {
  if (!Array.isArray(records)) {
    return projectHarvesterJournalRecoveryCore({ records })
  }
  try {
    const hasDeferrals = records.some((record) => record?.payload?.name === DEFERRED_EVENT)
    if (!hasDeferrals) {
      return projectHarvesterJournalRecoveryCore({ records })
    }
    validateLocalDeferralTransitions({ records })
    const deferredSubmissions = projectDeferredSubmissions({ records })
    const deferredClientOrderIds = new Set(deferredSubmissions.map(({ clientOrderId }) => clientOrderId))
    const projection = projectHarvesterJournalRecoveryCore({
      records: normalizeSubmissionDeferralRecords({ records }),
    })
    if (projection?.ok !== true) {
      return projection
    }
    return {
      ...projection,
      data: {
        ...projection.data,
        orders: Object.freeze(projection.data.orders.filter(
          (order) => !deferredClientOrderIds.has(order.clientOrderId),
        )),
        deferredSubmissions,
      },
    }
  } catch (error) {
    return toResult({ error })
  }
}