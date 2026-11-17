import { toResult } from "@coinzilla/utils"
import { authorizeOperatorActor } from "../../application/operator/authorize-operator-actor.js"

const ACTIONS = Object.freeze({
  pauseMarket: Object.freeze({
    engineMethod: "pauseBuys",
    action: "PAUSE_BUYS",
    marketFactType: "OPERATOR_MARKET_BUYS_PAUSED",
    globalFactType: "OPERATOR_ALL_BUYS_PAUSED",
    operation: "pause",
  }),
  resumeMarket: Object.freeze({
    engineMethod: "resumeBuys",
    action: "RESUME_BUYS",
    marketFactType: "OPERATOR_MARKET_BUYS_RESUMED",
    globalFactType: "OPERATOR_ALL_BUYS_RESUMED",
    operation: "resume",
  }),
})

function createBuyControl({ engine, operationalStateStore, action, requireSymbol } = {}) {
  if (operationalStateStore !== undefined && operationalStateStore !== null &&
      typeof operationalStateStore.append !== "function") {
    throw new TypeError("createBuyControl requires an Operational State Store append boundary when a store is supplied")
  }
  const configuration = ACTIONS[action]
  if (typeof engine?.[configuration.engineMethod] !== "function") {
    throw new TypeError(`createBuyControl requires the trading engine ${configuration.engineMethod} boundary`)
  }

  return async ({ actor, requestId, symbol } = {}) => {
    try {
      const authorizedActor = authorizeOperatorActor({ actor })
      if (typeof requestId !== "string" || requestId.trim() === "" || requestId.length > 256) {
        const error = new TypeError("Operator requestId must be a non-empty string of at most 256 characters")
        error.code = "INVALID_OPERATOR_REQUEST_ID"
        throw error
      }
      if (requireSymbol && (typeof symbol !== "string" || symbol.trim() === "")) {
        const error = new TypeError(`Operator ${configuration.operation}Buys requires a market symbol`)
        error.code = "INVALID_OPERATOR_MARKET"
        throw error
      }
      if (!requireSymbol && symbol !== undefined) {
        const error = new TypeError(`Global ${configuration.operation}AllBuys does not accept a market symbol`)
        error.code = "INVALID_OPERATOR_SCOPE"
        throw error
      }

      const normalizedSymbol = requireSymbol ? symbol.trim() : undefined
      const normalizedRequestId = requestId.trim()
      const factType = requireSymbol ? configuration.marketFactType : configuration.globalFactType
      const beforeApply = typeof operationalStateStore?.append === "function"
        ? () => operationalStateStore.append({
          factId: `operator-control:${normalizedRequestId}`,
          factType,
          data: {
            requestId: normalizedRequestId,
            actorId: authorizedActor.id,
            ...(requireSymbol ? { symbol: normalizedSymbol } : {}),
          },
        })
        : undefined

      return await engine[configuration.engineMethod]({
        ...(requireSymbol ? { symbol: normalizedSymbol } : {}),
        ...(beforeApply ? { beforeApply } : {}),
      })
    } catch (error) {
      return toResult({ error })
    }
  }
}

/** Create the transport-independent control for one configured market's BUY side. */
export function createPauseBuys(options = {}) {
  return createBuyControl({
    ...options,
    action: "pauseMarket",
    requireSymbol: true,
  })
}

/** Create the transport-independent control for all configured markets' BUY side. */
export function createPauseAllBuys(options = {}) {
  return createBuyControl({
    ...options,
    action: "pauseMarket",
    requireSymbol: false,
  })
}

/** Remove only one market's emergency BUY pause. */
export function createResumeBuys(options = {}) {
  return createBuyControl({
    ...options,
    action: "resumeMarket",
    requireSymbol: true,
  })
}

/** Remove only the global emergency BUY pause. */
export function createResumeAllBuys(options = {}) {
  return createBuyControl({
    ...options,
    action: "resumeMarket",
    requireSymbol: false,
  })
}
