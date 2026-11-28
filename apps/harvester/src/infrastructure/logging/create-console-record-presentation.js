import { createShutdownPhaseConsolePresentation } from "./create-shutdown-phase-console-presentation.js"
import { resolveHarvesterErrorDiagnostic } from "./harvester-error-catalog.js"

const ORDER_HISTORY_FAILURE_DETAIL_LIMITS = Object.freeze({
  field: 64,
  symbol: 16,
  clientOrderId: 48,
  errorCode: 64,
})

const CONSOLE_DETAIL_KEYS = Object.freeze([
  "diagnosticId",
  "stage",
  "operatorAction",
  "correlationId",
  "interactionType",
  "action",
  "symbol",
  "sourceFilterTypes",
  "operation",
  "stage",
  "failureClassification",
  "errorCode",
  "errorName",
  "applicationOperationInvoked",
  "applicationOperationCompleted",
  "stateChanged",
  "durationMs",
  "reason",
  "errorMessage",
  "inventory",
  "accounting",
  "orderCount",
  "readiness",
  "symbols",
  "enabledSymbols",
  "side",
  "price",
  "quantity",
  "phase",
  "auditStatus",
  "balanceCount",
  "assetCount",
  "strategyMode",
  "broker",
])

function summarizeOrderHistoryProjectionFailure({ data, message } = {}) {
  const details = {}
  for (const [key, maxLength] of Object.entries(ORDER_HISTORY_FAILURE_DETAIL_LIMITS)) {
    const value = data[key]
    if (typeof value !== "string" || value.trim() === "") {
      continue
    }
    if (value.length > maxLength) {
      details[key] = `${value.slice(0, maxLength - 3)}...`
      continue
    }
    details[key] = value
  }
  return {
    message,
    details,
  }
}

function summarizeCataloguedFailure({ data } = {}) {
  const nativeCauseCode = data.harvesterErrorCode
    ? (data.errorCode !== data.harvesterErrorCode ? data.errorCode : undefined)
    : (data.causeCode !== data.errorCode ? data.causeCode : undefined)
  const messageAlreadyIdentifiesNativeCode = typeof data.errorMessage === "string" && (
    data.errorMessage.startsWith(`${nativeCauseCode}:`) ||
    (nativeCauseCode === "ERR_SQLITE_ERROR" && data.errorMessage.startsWith("SQLITE_ERROR:"))
  )
  const causeMessage = messageAlreadyIdentifiesNativeCode
    ? data.errorMessage
    : [
      nativeCauseCode,
      data.errorMessage,
    ].filter((value) => typeof value === "string" && value.length > 0).join(": ")
  const sourceFilterTypes = Array.isArray(data.sourceFilterTypes)
    ? data.sourceFilterTypes.filter((value) => typeof value === "string" && value.length > 0)
    : []
  const errorMessage = sourceFilterTypes.length > 0
    ? `${causeMessage}; source filters: ${sourceFilterTypes.join(", ")}`
    : causeMessage
  const diagnostic = resolveHarvesterErrorDiagnostic({
    errorCode: data.harvesterErrorCode ?? data.errorCode,
    stage: data.errorStage ?? data.stage,
    errorMessage,
  })
  if (!diagnostic) {
    return null
  }
  return {
    message: diagnostic.title,
    diagnostic,
    details: {
      diagnosticId: diagnostic.diagnosticId,
      stage: diagnostic.stage,
      cause: diagnostic.cause,
      action: diagnostic.operatorAction,
    },
  }
}

function summarizeConsoleData({ data, shutdownPresentation } = {}) {
  if (shutdownPresentation) {
    return {
      message: shutdownPresentation.message,
      details: {},
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { message: String(data ?? "") }
  }

  const message = String(data.message ?? "Harvester event")
    .replace(/[\r\n]+/g, " ")
  if (message === "Order history projection failed") {
    return summarizeOrderHistoryProjectionFailure({
      data,
      message,
    })
  }
  if (
    message === "Harvester recovery SELL cancellation requested"
    && typeof data.symbol === "string"
    && typeof data.reason === "string"
  ) {
    return {
      message: `recovery SELL cancellation requested: ${data.symbol}, reason ${data.reason}`,
      details: {},
    }
  }
  const cataloguedFailure = summarizeCataloguedFailure({ data })
  if (cataloguedFailure) {
    return cataloguedFailure
  }
  const details = Object.fromEntries(
    CONSOLE_DETAIL_KEYS
      .filter((key) => data[key] !== undefined && data[key] !== null)
      .map((key) => {
        const value = data[key]
        if (typeof value === "string") {
          const maxLength = key === "errorMessage" ? 72 : 100
          if (value.length > maxLength) {
            return [key, `${value.slice(0, maxLength - 3)}...`]
          }
        }
        if (Array.isArray(value)) {
          return [key, key === "enabledSymbols" ? value : value.slice(0, 3)]
        }
        return [key, value]
      }),
  )
  return {
    message,
    details,
  }
}

export function createConsoleRecordPresentation({ timestamp, level, method, data } = {}) {
  const isOrderLifecycle = data?.orderLifecycle === true
  const shutdownPresentation = createShutdownPhaseConsolePresentation({
    timestamp,
    data,
  })
  const summary = isOrderLifecycle
    ? {
      message: "Order lifecycle",
      details: data,
    }
    : summarizeConsoleData({
      data,
      shutdownPresentation,
    })
  const fingerprint = JSON.stringify({
    level,
    method,
    summary,
    shutdownPhase: shutdownPresentation?.phase,
    phaseStatus: shutdownPresentation?.status,
  })

  return {
    isOrderLifecycle,
    shutdownPresentation,
    summary,
    fingerprint,
  }
}