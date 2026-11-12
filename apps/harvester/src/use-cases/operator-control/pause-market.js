import { toResult } from "@coinzilla/utils"
import { authorizeOperatorActor } from "../../application/operator/authorize-operator-actor.js"
import { assertDurableFactsPort } from "../../application/ports/durable-facts.port.js"

/**
 * Create the transport-independent use case for pausing one configured market.
 *
 * The engine invokes the durable-fact callback inside its serialized transition,
 * before applying the operator-owned in-memory pause.
 *
 * @param {object} options
 * @param {object} options.engine - Conservative trading engine control boundary.
 * @param {object} options.durableFacts - ADR-0001 application-owned durable-facts port.
 * @returns {(request: object) => Promise<object>} Pause-market use case.
 */
export function createPauseMarket({ engine, durableFacts } = {}) {
  if (typeof engine?.pauseMarket !== "function") {
    throw new TypeError("createPauseMarket requires the trading engine pauseMarket boundary")
  }
  assertDurableFactsPort({ durableFacts })

  return async ({ actor, requestId, symbol } = {}) => {
    try {
      const authorizedActor = authorizeOperatorActor({ actor })
      if (typeof requestId !== "string" || requestId.trim() === "" || requestId.length > 256) {
        const error = new TypeError("Operator requestId must be a non-empty string of at most 256 characters")
        error.code = "INVALID_OPERATOR_REQUEST_ID"
        throw error
      }
      if (typeof symbol !== "string" || symbol.trim() === "") {
        const error = new TypeError("Operator pause requires a market symbol")
        error.code = "INVALID_OPERATOR_MARKET"
        throw error
      }
      const normalizedSymbol = symbol.trim()
      const normalizedRequestId = requestId.trim()
      return await engine.pauseMarket({
        symbol: normalizedSymbol,
        beforeApply: () => durableFacts.append({
          factId: "operator-control:" + normalizedRequestId,
          factType: "OPERATOR_MARKET_PAUSED",
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
