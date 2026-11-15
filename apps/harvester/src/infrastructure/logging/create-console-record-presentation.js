import { createShutdownPhaseConsolePresentation } from "./create-shutdown-phase-console-presentation.js"

const CONSOLE_DETAIL_KEYS = Object.freeze([
  "errorCode",
  "symbol",
  "inventory",
  "accounting",
  "sourceFilterTypes",
  "errorName",
  "errorMessage",
  "orderCount",
  "readiness",
  "symbol",
  "symbols",
  "enabledSymbols",
  "action",
  "side",
  "price",
  "quantity",
  "phase",
  "auditStatus",
  "balanceCount",
  "assetCount",
  "strategyMode",
  "broker",
  "reason",
])

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
  const details = Object.fromEntries(
    CONSOLE_DETAIL_KEYS
      .filter((key) => data[key] !== undefined && data[key] !== null)
      .map((key) => {
        const value = data[key]
        if (typeof value === "string") {
          const maxLength = key === "errorMessage" ? 72 : 100
          if (value.length > maxLength) {
            return [key, value.slice(0, maxLength - 3) + "..."]
          }
        }
        if (Array.isArray(value)) {
          return [key, value.slice(0, 3)]
        }
        return [key, value]
      }),
  )
  return { message, details }
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
    fingerprint,
  }
}