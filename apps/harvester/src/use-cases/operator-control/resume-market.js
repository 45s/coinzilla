import { toResult } from "@coinzilla/utils"
import { authorizeOperatorActor } from "../../application/operator/authorize-operator-actor.js"
import { assertOperationalStatePort } from "../../application/ports/operational-state.port.js"

/**
 * Create the transport-independent use case for removing only an operator pause.
 *
 * The engine rejects this operation while any safety or recovery blocker is
 * active, before invoking the Operational State Store callback.
 *
 * @param {object} options
 * @param {object} options.engine - Conservative trading engine control boundary.
 * @param {object} options.operationalStateStore - ADR-0001 application-owned Operational State Store port.
 * @returns {(request: object) => Promise<object>} Resume-market use case.
 */
export function createResumeMarket({ engine, operationalStateStore } = {}) {
  if (typeof engine?.resumeMarket !== "function") {
    throw new TypeError("createResumeMarket requires the trading engine resumeMarket boundary")
  }
  assertOperationalStatePort({ operationalStateStore })

  return async ({ actor, requestId, symbol } = {}) => {
    try {
      const authorizedActor = authorizeOperatorActor({ actor })
      if (typeof requestId !== "string" || requestId.trim() === "" || requestId.length > 256) {
        const error = new TypeError("Operator requestId must be a non-empty string of at most 256 characters")
        error.code = "INVALID_OPERATOR_REQUEST_ID"
        throw error
      }
      if (typeof symbol !== "string" || symbol.trim() === "") {
        const error = new TypeError("Operator resume requires a market symbol")
        error.code = "INVALID_OPERATOR_MARKET"
        throw error
      }
      const normalizedSymbol = symbol.trim()
      const normalizedRequestId = requestId.trim()
      return await engine.resumeMarket({
        symbol: normalizedSymbol,
        beforeApply: () => operationalStateStore.append({
          factId: "operator-control:" + normalizedRequestId,
          factType: "OPERATOR_MARKET_RESUMED",
          data: {
            requestId: normalizedRequestId,
            actorId: authorizedActor.id,
            symbol: normalizedSymbol,
          },
        }),
      })
    } catch (error) {
      return toResult({ error })
    }
  }
}
